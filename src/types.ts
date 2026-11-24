import type {
  DataTag,
  EnsureQueryDataOptions,
  FetchQueryOptions,
  InfiniteData,
  InfiniteQueryObserverOptions,
  InvalidateQueryFilters,
  MutationObserverOptions,
  QueryClient,
  QueryFunction,
  QueryKey,
  QueryObserverOptions,
  SkipToken,
  Updater,
} from '@tanstack/query-core'
import type { ClientRequestOptions, ClientResponse } from 'hono/client'
import type { StatusCode, SuccessStatusCode } from 'hono/utils/http-status'
import type { HonoRPCClientError, HonoRPCError } from './errors'

export type HonoMethodKey = '$get' | '$post' | '$put' | '$patch' | '$delete' | '$head' | '$options'

export type AnyEndpoint = (args: any, options?: ClientRequestOptions) => Promise<ClientResponse<any, any, any>>

type ResponseOf<Fn extends AnyEndpoint> = Awaited<ReturnType<Fn>>
export type InputOf<Fn extends AnyEndpoint> = Parameters<Fn>[0]

type NoContentStatus = 204 | 205
type ErrorStatus = Exclude<StatusCode, SuccessStatusCode>

/**
 * A response whose status union contains any 2xx status is a *success* response.
 *
 * This is deliberately not decided per status: when a route has middleware that
 * declares extra responses (e.g. a validator hook returning a typed 400), Hono types
 * the handler's own `c.json(x)` with a wide status union such as `ContentfulStatusCode`.
 * At runtime that response is a 200, so it must not spawn bogus error members.
 */
type IsSuccess<S> = [Extract<S, SuccessStatusCode>] extends [never] ? false : true

/** Parsed body of the 2xx responses (`undefined` for 204 / 205). */
export type OutputOf<Fn extends AnyEndpoint> =
  ResponseOf<Fn> extends infer R
    ? R extends ClientResponse<infer T, infer S, infer F>
      ? IsSuccess<S> extends true
        ? [S] extends [NoContentStatus]
          ? undefined
          : F extends 'json'
            ? Awaited<ReturnType<R['json']>>
            : F extends 'text'
              ? string
              : unknown
        : never
      : never
    : never

/** Statuses the route declares for non-2xx responses. */
type DeclaredErrorStatus<Fn extends AnyEndpoint> =
  ResponseOf<Fn> extends infer R
    ? R extends ClientResponse<infer _T, infer S, infer _F>
      ? IsSuccess<S> extends true
        ? never
        : S
      : never
    : never

/** `HonoRPCError<status, body>` for each non-2xx response the route declares. */
type DeclaredErrorOf<Fn extends AnyEndpoint> =
  ResponseOf<Fn> extends infer R
    ? R extends ClientResponse<infer _T, infer S, infer _F>
      ? IsSuccess<S> extends true
        ? never
        : HonoRPCError<S, Awaited<ReturnType<R['json']>>>
      : never
    : never

/**
 * Any other error status can still happen (proxy 502, platform 500, ...).
 * They stay typed, with an `unknown` body, and exclude the declared statuses
 * so that `error.status === 404` still narrows `error.data` to the declared body.
 */
type UndeclaredErrorOf<Fn extends AnyEndpoint> = HonoRPCError<Exclude<ErrorStatus, DeclaredErrorStatus<Fn>>, unknown>

/**
 * The complete `error` type seen by TanStack Query:
 * declared route errors | undeclared HTTP errors | client-side failures.
 */
export type ErrorOf<Fn extends AnyEndpoint> = DeclaredErrorOf<Fn> | UndeclaredErrorOf<Fn> | HonoRPCClientError

/** `mutate()` becomes callable without arguments when the endpoint input is optional. */
export type VariablesOf<Fn extends AnyEndpoint> = undefined extends InputOf<Fn> ? InputOf<Fn> | void : InputOf<Fn>

/** Everything the library itself can throw: HTTP errors and client-side failures. */
export type LibraryError = HonoRPCError | HonoRPCClientError

/** Result of `safeCall`: errors are values, never thrown. Destructuring works: `const { data, error } = ...`. */
export type SafeResult<T, E> =
  | { ok: true; data: T; error?: undefined }
  | { ok: false; data?: undefined; error: E }

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'

/** Identifies the request a `mapError` / `defaults.client` callback is being run for. */
export interface CallContext {
  /** Route segments without the method, e.g. `['posts', ':id']`. */
  readonly route: readonly string[]
  readonly method: HttpMethod
}

/** The error type hooks see: route-typed by default, or whatever `mapError` returns. */
type UtilsError<TMapped> = [TMapped] extends [never] ? LibraryError : TMapped
type ResolveError<Fn extends AnyEndpoint, TMapped> = [TMapped] extends [never] ? ErrorOf<Fn> : TMapped

type DefaultQueryOptions<TErr> = Partial<
  Pick<
    QueryObserverOptions<unknown, TErr, unknown, unknown, QueryKey>,
    | 'staleTime'
    | 'gcTime'
    | 'retry'
    | 'retryDelay'
    | 'retryOnMount'
    | 'refetchOnMount'
    | 'refetchOnWindowFocus'
    | 'refetchOnReconnect'
    | 'refetchInterval'
    | 'networkMode'
    | 'throwOnError'
    | 'meta'
    | 'structuralSharing'
  >
>

type DefaultMutationOptions<TErr> = Partial<
  Pick<
    MutationObserverOptions<unknown, TErr, unknown, unknown>,
    'retry' | 'retryDelay' | 'networkMode' | 'gcTime' | 'meta' | 'throwOnError'
  >
>

export interface HonoQueryUtilsOptions<TMapped = never> {
  /**
   * Convert every library error into your own error type at a single boundary.
   * When provided, the `error` seen by hooks, `call` and `safeCall` is whatever this returns.
   * It must not throw.
   */
  mapError?: (error: LibraryError, context: CallContext) => TMapped

  defaults?: {
    /**
     * Request options applied to every call (merged under per-call `client` options).
     * A function is evaluated per request and can vary by route and method.
     * `headers` are merged case-insensitively; `init` is shallow-merged; `fetch` etc. are replaced.
     */
    client?: ClientRequestOptions | ((context: CallContext) => ClientRequestOptions | undefined)
    /** Shallow-merged under the options passed to `queryOptions` and `infiniteOptions`. */
    query?: DefaultQueryOptions<UtilsError<TMapped>>
    /** Shallow-merged under the options passed to `mutationOptions`. */
    mutation?: DefaultMutationOptions<UtilsError<TMapped>>
  }
}

type ClientOpt = {
  /** Per-call Hono client options (headers, custom fetch, init). */
  client?: ClientRequestOptions
}

type QueryBase<TOut, TErr, TData> = Omit<QueryObserverOptions<TOut, TErr, TData, TOut, QueryKey>, 'queryKey' | 'queryFn'>

/**
 * Options whose function form receives a `Query<..., TQueryKey>`. Framework adapters type that parameter differently
 * (Vue unwraps refs inside the key type, which strips TanStack's `DataTag` brand), so a returned object that declares them
 * is rejected by `useQuery` in Vue. They are therefore left out of the *returned types*; the values you pass are still
 * forwarded at runtime. Inputs are unaffected: you can still pass all of them.
 */
type QueryParamOptions =
  | 'enabled'
  | 'staleTime'
  | 'refetchInterval'
  | 'refetchOnWindowFocus'
  | 'refetchOnReconnect'
  | 'refetchOnMount'
  | 'retryOnMount'
  | 'throwOnError'

type QueryOptionsIn<TOut, TErr, TData> = QueryBase<TOut, TErr, TData> & ClientOpt

type QueryOptionsOut<TOut, TErr, TData> = Omit<QueryBase<TOut, TErr, TData>, QueryParamOptions> & {
  queryKey: DataTag<QueryKey, TOut, TErr>
  queryFn: QueryFunction<TOut, QueryKey>
}

/** Same, but `queryFn` may be `skipToken` — not accepted by `useSuspenseQuery`. */
type QueryOptionsOutSkippable<TOut, TErr, TData> = Omit<QueryOptionsOut<TOut, TErr, TData>, 'queryFn'> & {
  queryFn: QueryFunction<TOut, QueryKey> | SkipToken
}

type InfiniteBase<TOut, TErr, TPageParam, TData> = Omit<
  InfiniteQueryObserverOptions<TOut, TErr, TData, QueryKey, TPageParam>,
  'queryKey' | 'queryFn'
>

type InfiniteOptionsIn<TInput, TOut, TErr, TPageParam, TData> = InfiniteBase<TOut, TErr, TPageParam, TData> &
  ClientOpt & {
    /** Build the endpoint input for a given page param. */
    input: (pageParam: TPageParam) => TInput
    initialPageParam: TPageParam
  }

type InfiniteOptionsOut<TOut, TErr, TPageParam, TData> = Omit<InfiniteBase<TOut, TErr, TPageParam, TData>, QueryParamOptions> & {
  queryKey: DataTag<QueryKey, InfiniteData<TOut, TPageParam>, TErr>
  queryFn: QueryFunction<TOut, QueryKey, TPageParam>
}

type MutationOptionsIn<TOut, TErr, TVars, TCtx> = Omit<
  MutationObserverOptions<TOut, TErr, TVars, TCtx>,
  'mutationKey' | 'mutationFn'
> &
  ClientOpt

export type KeyType = 'query' | 'infinite' | 'mutation'

/** `[options?]` when the endpoint input is optional, `[options]` otherwise. */
type WithInput<Fn extends AnyEndpoint, TExtra = unknown> = undefined extends InputOf<Fn>
  ? [options?: { input?: InputOf<Fn> } & TExtra]
  : [options: { input: InputOf<Fn> } & TExtra]

/**
 * TanStack's own filters. Note they already own `type` ('active' | 'inactive' | 'all'),
 * which is why our key discriminator is called `keyType` in the invalidate helpers.
 */
type InvalidateFilters = Omit<InvalidateQueryFilters, 'queryKey'>

export interface EndpointUtils<Fn extends AnyEndpoint, TErr = ErrorOf<Fn>> {
  /** Calls the endpoint. Resolves with the parsed 2xx body, rejects with the typed error otherwise. */
  call(
    ...args: undefined extends InputOf<Fn>
      ? [input?: InputOf<Fn>, options?: ClientRequestOptions]
      : [input: InputOf<Fn>, options?: ClientRequestOptions]
  ): Promise<OutputOf<Fn>>

  /** Like `call`, but never rejects: resolves to `{ ok: true, data }` or `{ ok: false, error }`. */
  safeCall(
    ...args: undefined extends InputOf<Fn>
      ? [input?: InputOf<Fn>, options?: ClientRequestOptions]
      : [input: InputOf<Fn>, options?: ClientRequestOptions]
  ): Promise<SafeResult<OutputOf<Fn>, TErr>>

  /** Partial key for filters: `queryClient.invalidateQueries({ queryKey: api.posts.$get.key() })`. */
  key(options?: { type?: KeyType; input?: InputOf<Fn> }): QueryKey

  /** Fully-typed key for `getQueryData` / `setQueryData`. */
  queryKey(...args: WithInput<Fn>): DataTag<QueryKey, OutputOf<Fn>, TErr>

  /**
   * Options for `useQuery` / `useSuspenseQuery` / `queryClient.fetchQuery` / ...
   * Passing `skipToken` as `input` disables the query (not allowed with suspense).
   */
  queryOptions<TData = OutputOf<Fn>>(
    ...args: WithInput<Fn, QueryOptionsIn<OutputOf<Fn>, TErr, TData>>
  ): QueryOptionsOut<OutputOf<Fn>, TErr, TData>
  queryOptions<TData = OutputOf<Fn>>(
    options: { input: InputOf<Fn> | SkipToken } & QueryOptionsIn<OutputOf<Fn>, TErr, TData>,
  ): QueryOptionsOutSkippable<OutputOf<Fn>, TErr, TData>

  infiniteOptions<TPageParam, TData = InfiniteData<OutputOf<Fn>, TPageParam>>(
    options: InfiniteOptionsIn<InputOf<Fn>, OutputOf<Fn>, TErr, TPageParam, TData>,
  ): InfiniteOptionsOut<OutputOf<Fn>, TErr, TPageParam, TData>
  infiniteOptions<TPageParam, TData = InfiniteData<OutputOf<Fn>, TPageParam>>(
    options: Omit<InfiniteOptionsIn<InputOf<Fn>, OutputOf<Fn>, TErr, TPageParam, TData>, 'input'> & {
      input: ((pageParam: TPageParam) => InputOf<Fn>) | SkipToken
    },
  ): Omit<InfiniteOptionsOut<OutputOf<Fn>, TErr, TPageParam, TData>, 'queryFn'> & {
    queryFn: QueryFunction<OutputOf<Fn>, QueryKey, TPageParam> | SkipToken
  }

  mutationKey(): QueryKey

  mutationOptions<TCtx = unknown>(
    options?: MutationOptionsIn<OutputOf<Fn>, TErr, VariablesOf<Fn>, TCtx>,
  ): MutationObserverOptions<OutputOf<Fn>, TErr, VariablesOf<Fn>, TCtx>

  // ---- cache helpers: thin, typed wrappers over QueryClient using this endpoint's query key ----

  /** `queryClient.getQueryData` for this endpoint and input. */
  getData(queryClient: QueryClient, ...args: WithInput<Fn>): OutputOf<Fn> | undefined

  /** `queryClient.setQueryData` for this endpoint and input; the updater is typed with the output. */
  setData(
    queryClient: QueryClient,
    options: (undefined extends InputOf<Fn> ? { input?: InputOf<Fn> } : { input: InputOf<Fn> }) & {
      updater: Updater<OutputOf<Fn> | undefined, OutputOf<Fn> | undefined>
    },
  ): OutputOf<Fn> | undefined

  /** Cancels the in-flight request for exactly this input (use before optimistic updates). */
  cancel(queryClient: QueryClient, ...args: WithInput<Fn>): Promise<void>

  /** Invalidates every query of this endpoint, or only those matching `input` / `keyType`. */
  invalidate(
    queryClient: QueryClient,
    options?: { input?: InputOf<Fn>; keyType?: KeyType } & InvalidateFilters,
  ): Promise<void>

  /** `queryClient.fetchQuery` with this endpoint's options. */
  fetch(
    queryClient: QueryClient,
    ...args: WithInput<Fn, ClientOpt & Omit<FetchQueryOptions<OutputOf<Fn>, TErr, OutputOf<Fn>, QueryKey>, 'queryKey' | 'queryFn'>>
  ): Promise<OutputOf<Fn>>

  /** `queryClient.prefetchQuery` with this endpoint's options. */
  prefetch(
    queryClient: QueryClient,
    ...args: WithInput<Fn, ClientOpt & Omit<FetchQueryOptions<OutputOf<Fn>, TErr, OutputOf<Fn>, QueryKey>, 'queryKey' | 'queryFn'>>
  ): Promise<void>

  /** `queryClient.ensureQueryData` with this endpoint's options. */
  ensureData(
    queryClient: QueryClient,
    ...args: WithInput<Fn, ClientOpt & Omit<EnsureQueryDataOptions<OutputOf<Fn>, TErr, OutputOf<Fn>, QueryKey>, 'queryKey' | 'queryFn'>>
  ): Promise<OutputOf<Fn>>
}

/** Keeps HTTP method members, `$url` / `$path` (Hono's own helpers) and path segments; drops `$ws`, ... */
type PublicKey<K> = K extends HonoMethodKey | '$url' | '$path' ? K : K extends `$${string}` ? never : K

export type HonoQueryUtils<T, TMapped = never> = {
  [K in keyof T as PublicKey<K>]: K extends HonoMethodKey
    ? T[K] extends AnyEndpoint
      ? EndpointUtils<T[K], ResolveError<T[K], TMapped>>
      : never
    : K extends '$url' | '$path'
      ? T[K] // passed through untouched: same signature and result as Hono's own client
      : HonoQueryUtils<T[K], TMapped>
} & {
  /** Prefix key for this node: `queryClient.invalidateQueries({ queryKey: api.posts.$key() })`. */
  $key(options?: { type?: KeyType }): QueryKey
  /** Invalidates everything under this node. */
  $invalidate(queryClient: QueryClient, options?: { keyType?: KeyType } & InvalidateFilters): Promise<void>
}
