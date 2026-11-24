# Recipes

Contents: [Auth header](#auth-header-on-every-request) · [Per-route request options and timeouts](#per-route-request-options-and-timeouts) · [Optimistic update](#optimistic-update) ·
[Tagged errors with mapError](#tagged-errors-with-maperror) · [neverthrow](#neverthrow-service-function) · [better-result](#better-result) · [Pagination](#pagination-with-select) ·
[Dependent queries](#dependent-queries) · [Polling](#polling) · [Error text helper](#error-text-helper) · [Testing without a network](#testing-without-a-network) ·
[SSR prefetch](#ssr-prefetch) · [Vue](#vue) · [Solid](#solid) · [Svelte](#svelte-5) · [File uploads](#file-uploads)

All examples assume `const api = createHonoQueryUtils(hc<AppType>('/api'))` and a `queryClient`.

## Auth header on every request

Use a headers **function** so the token is read for each request, not captured once:

```ts
const api = createHonoQueryUtils(hc<AppType>('/api'), {
  defaults: { client: { headers: () => ({ authorization: `Bearer ${getToken()}` }) } },  // may also be async
})
```

Per-call `client.headers` still win, and the two are merged case-insensitively.

## Per-route request options and timeouts

`defaults.client` can be a function of `{ route, method }`, evaluated per request, so a fresh `AbortSignal.timeout` is created each time:

```ts
defaults: {
  client: ({ route }) => (route[0] === 'reports' ? { init: { signal: AbortSignal.timeout(30_000) } } : undefined),
}
```

A timeout surfaces as `HonoRPCClientError` with `reason: 'timeout'`; the user's own `init.signal` is merged with TanStack's cancellation signal.

## Optimistic update

```ts
const remove = useMutation({
  mutationFn: (input: { param: { id: string } }) => api.posts[':id'].$delete.call(input),
  onMutate: async (input) => {
    await api.posts.$get.cancel(queryClient, { input: { query: {} } })          // stop in-flight refetches overwriting us
    const previous = api.posts.$get.getData(queryClient, { input: { query: {} } })
    api.posts.$get.setData(queryClient, {
      input: { query: {} },
      updater: (old) => old && { ...old, items: old.items.filter((p) => p.id !== input.param.id) },
    })
    return { previous }
  },
  onError: (_error, _input, context) => {
    if (context?.previous) api.posts.$get.setData(queryClient, { input: { query: {} }, updater: context.previous })
  },
  onSettled: () => api.posts.$invalidate(queryClient),
})
```

`cancel` / `getData` / `setData` take the **same input** as the query being displayed; a different input is a different cache entry.

## Tagged errors with mapError

```ts
class NotFound { readonly _tag = 'NotFound' as const; constructor(readonly detail: unknown) {} }
class Offline  { readonly _tag = 'Offline'  as const }
class Failed   { readonly _tag = 'Failed'   as const; constructor(readonly status?: number) {} }
type AppError = NotFound | Offline | Failed

const api = createHonoQueryUtils(client, {
  mapError: (error): AppError => {
    if (error instanceof HonoRPCClientError) return new Offline()
    return error.status === 404 ? new NotFound(error.data) : new Failed(error.status)
  },
})

const { error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
// error: AppError | null
if (error?._tag === 'NotFound') { /* ... */ }
```

Mention the trade-off: the mapper receives the generic error union, so per-route status/body typing is replaced by `AppError`. If the user wants per-route typing, skip `mapError`.

## neverthrow service function

```ts
import { toResultAsync } from 'hono-rpc-tanstack-query/neverthrow'
import { isHonoRPCError } from 'hono-rpc-tanstack-query'

export const getPostTitle = (id: string) =>
  toResultAsync(api.posts[':id'].$get.safeCall({ param: { id } }))
    .map((post) => post.title)
    .mapErr((e) => (isHonoRPCError(e) && e.status === 404 ? ('missing' as const) : ('failed' as const)))
// ResultAsync<string, 'missing' | 'failed'>
```

## better-result

```ts
import { toResult } from 'hono-rpc-tanstack-query/better-result'     // ESM only

const result = await toResult(api.posts[':id'].$get.safeCall({ param: { id } }))
const title = result.match({ ok: (post) => post.title, err: (e) => `failed: ${e.message}` })
```

## Pagination with select

```ts
const list = useInfiniteQuery(api.posts.$get.infiniteOptions({
  input: (cursor: string | undefined) => ({ query: { cursor } }),
  initialPageParam: undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
  select: (data) => data.pages.flatMap((page) => page.items),     // list.data is the flat item array
}))
list.fetchNextPage()
```

## Dependent queries

```ts
const post = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
const related = useQuery(
  api.posts.$get.queryOptions({ input: post.data ? { query: { cursor: post.data.id } } : skipToken }),
)
```

`skipToken` keeps the query idle (and its key input-less) until the input exists. `enabled` is also accepted as an input option; `skipToken` is preferred because it narrows the input type.

## Polling

```ts
useQuery(api.health.$get.queryOptions({ refetchInterval: 5_000, refetchIntervalInBackground: false }))
```

## Error text helper

```ts
import { HonoRPCClientError, HonoRPCError } from 'hono-rpc-tanstack-query'

export function describeError(error: unknown): string {
  if (error instanceof HonoRPCError) return `Server said ${error.status}`
  if (error instanceof HonoRPCClientError) {
    return { network: 'You appear to be offline', abort: 'Cancelled', timeout: 'Took too long', parse: 'Unreadable response' }[error.reason]
  }
  return 'Unexpected error'
}
```

## Testing without a network

Route requests straight into the Hono app by giving `hc` a `fetch` that calls `app.request`:

```ts
import { app } from '../server/app'

const client = hc<AppType>('http://localhost', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise.resolve(app.request(input, init)),
})
const api = createHonoQueryUtils(client)

const result = await api.posts[':id'].$get.safeCall({ param: { id: 'missing' } })
expect(result.ok).toBe(false)
expect(result.error).toBeInstanceOf(HonoRPCError)
```

To test UI against failures, pass a `fetch` that returns `new Response(...)` or rejects (`Promise.reject(new TypeError('offline'))` gives `reason: 'network'`).
Use a fresh `QueryClient` per test with `retry: false`.

## SSR prefetch

Options and keys are plain JSON-serialisable data, so TanStack's standard pattern applies (not verified against a specific SSR framework by the library's tests):

```ts
const queryClient = new QueryClient()
await api.posts[':id'].$get.prefetch(queryClient, { input: { param: { id } } })    // never throws
const state = dehydrate(queryClient)                                                // from @tanstack/react-query (or the framework's package)
```

Use `ensureData` in route loaders when the loader should reuse cached data, and `fetch` when it should throw on failure.

## Vue

```ts
import { computed, ref } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

export function usePost() {
  const id = ref('1')
  const queryClient = useQueryClient()
  const post = useQuery(computed(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id.value } } })))
  const create = useMutation(api.posts.$post.mutationOptions({ onSuccess: () => api.posts.$invalidate(queryClient) }))
  return { id, post, create }          // post.data.value, post.error.value are typed
}
```

Wrap options in `computed` whenever the input reads a ref; static options can be passed directly.

## Solid

```ts
import { createQuery } from '@tanstack/solid-query'

const post = createQuery(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id() } } }))   // post.data, post.error
```

## Svelte 5

```ts
import { createQuery } from '@tanstack/svelte-query'      // v6: takes a function

let id = $state('1')
const post = createQuery(() => api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
```

## File uploads

Put files in a **mutation**, not a query: inputs are hashed into query keys and must be JSON-serialisable, but mutation variables are not hashed.

```ts
const upload = useMutation(api.files.$post.mutationOptions())
upload.mutate({ form: { file } })            // `form` shape follows the route's validator
```
