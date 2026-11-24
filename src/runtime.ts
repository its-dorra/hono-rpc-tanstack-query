import { skipToken, type QueryClient, type QueryKey } from '@tanstack/query-core'
import type { ClientRequestOptions } from 'hono/client'
import { HonoRPCClientError, HonoRPCError, type HonoRPCClientErrorReason } from './errors'
import type { CallContext, HonoMethodKey, HonoQueryUtils, HonoQueryUtilsOptions, HttpMethod } from './types'

const METHODS: ReadonlySet<string> = new Set<HonoMethodKey>(['$get', '$post', '$put', '$patch', '$delete', '$head', '$options'])
/** Hono's own URL helpers, passed through to the underlying client untouched. */
const PASSTHROUGH: ReadonlySet<string> = new Set(['$url', '$path'])

type Settings = HonoQueryUtilsOptions<unknown>
type KeyMeta = { type?: string; input?: unknown }
type Headers_ = ClientRequestOptions['headers']
type HeaderRecord = Record<string, string>

/** `[path]` or `[path, { type?, input? }]` — undefined fields are omitted so partial matching works. */
function buildKey(path: readonly string[], meta?: KeyMeta): QueryKey {
  const extra: Record<string, unknown> = {}
  if (meta?.type !== undefined) extra.type = meta.type
  if (meta?.input !== undefined) extra.input = meta.input
  return Object.keys(extra).length > 0 ? [path, extra] : [path]
}

/* -------------------------------------------------------------------------- */
/*  Response handling                                                         */
/* -------------------------------------------------------------------------- */

async function readBody(res: Response): Promise<unknown> {
  if (res.status === 204 || res.status === 205) return undefined
  const isJson = (res.headers.get('content-type') ?? '').includes('json')

  if (res.ok) {
    try {
      return await (isJson ? res.json() : res.text())
    } catch (cause) {
      throw new HonoRPCClientError(reasonOf(cause, 'parse'), cause)
    }
  }

  // Error bodies are best-effort: a malformed body must never hide the HTTP status.
  const text = await res.text().catch(() => '')
  if (!isJson || text === '') return text || undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

/** Aborts and timeouts are recognised by name; anything else gets the caller's fallback reason. */
function reasonOf(cause: unknown, fallback: 'network' | 'parse'): HonoRPCClientErrorReason {
  if (cause instanceof Error) {
    if (cause.name === 'AbortError') return 'abort'
    if (cause.name === 'TimeoutError') return 'timeout'
  }
  return fallback
}

/** Resolves with the parsed 2xx body; rejects with `HonoRPCError` or `HonoRPCClientError` only. */
async function unwrap(pending: () => Promise<Response>): Promise<unknown> {
  let res: Response
  try {
    res = await pending()
  } catch (cause) {
    throw new HonoRPCClientError(reasonOf(cause, 'network'), cause)
  }
  const body = await readBody(res)
  if (!res.ok) throw new HonoRPCError(res.status, body, res)
  return body
}

/* -------------------------------------------------------------------------- */
/*  Request options                                                           */
/* -------------------------------------------------------------------------- */

function withSignal(options: ClientRequestOptions | undefined, signal: AbortSignal | undefined) {
  if (!signal) return options
  const existing = options?.init?.signal
  if (!existing) return { ...options, init: { ...options?.init, signal } }
  if (typeof AbortSignal.any === 'function') {
    try {
      return { ...options, init: { ...options?.init, signal: AbortSignal.any([existing, signal]) } }
    } catch {
      // AbortSignal.any may throw in environments where signals cross realms (e.g. jsdom + Node).
    }
  }
  return { ...options, init: { ...options?.init, signal } }
}

/** Case-insensitive merge; later wins. */
function combineHeaders(a: HeaderRecord, b: HeaderRecord): HeaderRecord {
  const merged = new Headers(a)
  for (const [name, value] of Object.entries(b)) merged.set(name, value)
  return Object.fromEntries(merged.entries())
}

/** Static + static stays static; if either side is a function the result is one (Hono resolves it per request). */
function mergeHeaders(base: Headers_, over: Headers_): Headers_ {
  if (!base) return over
  if (!over) return base
  if (typeof base !== 'function' && typeof over !== 'function') return combineHeaders(base, over)
  return async () =>
    combineHeaders(typeof base === 'function' ? await base() : base, typeof over === 'function' ? await over() : over)
}

/** `over` wins; `headers` are merged and `init` is shallow-merged instead of replaced. */
function mergeClientOptions(base: ClientRequestOptions | undefined, over: ClientRequestOptions | undefined) {
  if (!base) return over
  if (!over) return base
  const headers = mergeHeaders(base.headers, over.headers)
  const init = base.init || over.init ? { ...base.init, ...over.init } : undefined
  return { ...base, ...over, ...(headers && { headers }), ...(init && { init }) } as ClientRequestOptions
}

/* -------------------------------------------------------------------------- */
/*  Endpoint utils                                                            */
/* -------------------------------------------------------------------------- */

function resolvePath(root: any, path: readonly string[]) {
  return path.reduce((node, key) => node[key], root)
}

function createEndpointUtils(root: any, path: readonly string[], settings: Settings) {
  const context: CallContext = { route: path.slice(0, -1), method: path[path.length - 1]!.slice(1) as HttpMethod }
  const { defaults, mapError } = settings

  const clientDefaults = () => (typeof defaults?.client === 'function' ? defaults.client(context) : defaults?.client)

  const call = async (input?: unknown, options?: ClientRequestOptions) => {
    const merged = mergeClientOptions(clientDefaults(), options)
    try {
      return await unwrap(() => resolvePath(root, path)(input, merged))
    } catch (error) {
      throw mapError ? mapError(error as HonoRPCError | HonoRPCClientError, context) : error
    }
  }

  const safeCall = (input?: unknown, options?: ClientRequestOptions) =>
    call(input, options).then(
      (data) => ({ ok: true as const, data }),
      (error) => ({ ok: false as const, error }),
    )

  const key = (opts?: KeyMeta) => buildKey(path, opts)
  const queryKey = (opts?: { input?: unknown }) => buildKey(path, { type: 'query', input: opts?.input })

  const queryOptions = (opts: any = {}) => {
    const { input, client, ...rest } = opts
    const skipped = input === skipToken
    return {
      ...defaults?.query,
      ...rest,
      queryKey: buildKey(path, { type: 'query', input: skipped ? undefined : input }),
      queryFn: skipped ? skipToken : ({ signal }: { signal: AbortSignal }) => call(input, withSignal(client, signal)),
    }
  }

  return {
    call,
    safeCall,
    key,
    queryKey,
    queryOptions,

    infiniteOptions: (opts: any) => {
      const { input, initialPageParam, client, ...rest } = opts
      const skipped = input === skipToken
      return {
        ...defaults?.query,
        ...rest,
        initialPageParam,
        queryKey: buildKey(path, { type: 'infinite', input: skipped ? undefined : input(initialPageParam) }),
        queryFn: skipped
          ? skipToken
          : ({ pageParam, signal }: { pageParam: unknown; signal: AbortSignal }) =>
              call(input(pageParam), withSignal(client, signal)),
      }
    },

    mutationKey: () => buildKey(path, { type: 'mutation' }),

    mutationOptions: (opts: any = {}) => {
      const { client, ...rest } = opts
      return {
        ...defaults?.mutation,
        ...rest,
        mutationKey: buildKey(path, { type: 'mutation' }),
        mutationFn: (input: unknown) => call(input, client),
      }
    },

    // ---- cache helpers ----
    getData: (qc: QueryClient, opts?: { input?: unknown }) => qc.getQueryData(queryKey(opts)),

    setData: (qc: QueryClient, { input, updater }: { input?: unknown; updater: any }) =>
      qc.setQueryData(queryKey({ input }), updater),

    cancel: (qc: QueryClient, opts?: { input?: unknown }) => qc.cancelQueries({ queryKey: queryKey(opts), exact: true }),

    invalidate: (qc: QueryClient, opts: { input?: unknown; keyType?: string } = {}) => {
      const { input, keyType, ...filters } = opts
      return qc.invalidateQueries({ ...filters, queryKey: key({ type: keyType, input }) })
    },

    fetch: (qc: QueryClient, opts?: any) => qc.fetchQuery(queryOptions(opts)),
    prefetch: (qc: QueryClient, opts?: any) => qc.prefetchQuery(queryOptions(opts)),
    ensureData: (qc: QueryClient, opts?: any) => qc.ensureQueryData(queryOptions(opts)),
  }
}

/* -------------------------------------------------------------------------- */
/*  Proxy tree                                                                */
/* -------------------------------------------------------------------------- */

function createNode(root: any, path: readonly string[], settings: Settings): any {
  // Children are cached so `api.posts === api.posts` (stable identity, safe in dependency arrays).
  // The cache is bounded by the number of distinct routes that are actually accessed.
  const children = new Map<string, unknown>()
  const $key = (opts?: KeyMeta) => buildKey(path, opts)
  const $invalidate = (qc: QueryClient, opts: { keyType?: string } = {}) => {
    const { keyType, ...filters } = opts
    return qc.invalidateQueries({ ...filters, queryKey: buildKey(path, { type: keyType }) })
  }

  return new Proxy(Object.create(null), {
    get(_target, prop) {
      // Symbols and `then` must stay undefined so the proxy is never mistaken for a thenable.
      if (typeof prop !== 'string' || prop === 'then') return undefined
      if (prop === '$key') return $key
      if (prop === '$invalidate') return $invalidate

      const isMethod = METHODS.has(prop)
      const isPassthrough = PASSTHROUGH.has(prop)
      // `$ws`, ... are deliberately not part of the utils surface.
      if (prop.startsWith('$') && !isMethod && !isPassthrough) return undefined

      let child = children.get(prop)
      if (child === undefined) {
        child = isMethod
          ? createEndpointUtils(root, [...path, prop], settings)
          : isPassthrough
            ? (...args: unknown[]) => resolvePath(root, path)[prop](...args)
            : createNode(root, [...path, prop], settings)
        children.set(prop, child)
      }
      return child
    },
  })
}

/**
 * Wrap a Hono RPC client (`hc<AppType>(url)`) in type-safe TanStack Query helpers.
 *
 * @example
 * const api = createHonoQueryUtils(hc<AppType>('/api'))
 * useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
 */
export function createHonoQueryUtils<T extends object, TMapped = never>(
  client: T,
  options: HonoQueryUtilsOptions<TMapped> = {},
): HonoQueryUtils<T, TMapped> {
  return createNode(client, [], options as Settings)
}
