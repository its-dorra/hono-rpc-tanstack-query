# API reference

Contents: [createHonoQueryUtils](#createhonoqueryutils) · [Tree shape](#tree-shape) · [Node members](#node-members) · [Endpoint members](#endpoint-members) · [Errors](#errors) · [Types](#exported-types) · [Adapters](#adapters)

## createHonoQueryUtils

```ts
function createHonoQueryUtils<T extends object, TMapped = never>(
  client: T,                                   // hc<AppType>(...)
  options?: HonoQueryUtilsOptions<TMapped>,
): HonoQueryUtils<T, TMapped>
```

| Option | Type | Notes |
| --- | --- | --- |
| `mapError` | `(error: HonoRPCError \| HonoRPCClientError, ctx: CallContext) => TMapped` | Replaces the error type everywhere (hooks, `call`, `safeCall`, cache state). Must not throw. Loses per-route status/body typing. |
| `defaults.client` | `ClientRequestOptions \| (ctx: CallContext) => ClientRequestOptions \| undefined` | Merged under per-call `client`. Headers merge case-insensitively (static and function headers can mix); `init` is shallow-merged; `fetch` etc. are replaced. A function runs per request. |
| `defaults.query` | `staleTime, gcTime, retry, retryDelay, retryOnMount, refetchOnMount, refetchOnWindowFocus, refetchOnReconnect, refetchInterval, networkMode, throwOnError, meta, structuralSharing` | Shallow-merged under `queryOptions` and `infiniteOptions`; call-site wins. `retry` / `retryDelay` receive the typed error. No `select`, no keys. |
| `defaults.mutation` | `retry, retryDelay, networkMode, gcTime, meta, throwOnError` | Shallow-merged under `mutationOptions`. |

`CallContext = { route: readonly string[]; method: 'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options' }`, for example `{ route: ['posts', ':id'], method: 'get' }`.

## Tree shape

The result mirrors the client. Path segments (`posts`, `':id'`, deep chains like `a.b.c[':x']`) are nodes. `$get`, `$post`, `$put`, `$patch`, `$delete`, `$head`, `$options` are endpoints.
Nodes and endpoints are cached: `api.posts === api.posts`. `$ws` and other `$`-members of the Hono client are not exposed. A segment named `then` is unreachable.

## Node members

| Member | Description |
| --- | --- |
| `$key({ type? })` | Prefix key for everything under the node. `api.$key()` matches everything. |
| `$invalidate(queryClient, { keyType?, ...filters })` | `invalidateQueries` for the subtree. `filters` are TanStack's (`refetchType`, `type: 'active'`, ...). |
| `$url(...)` / `$path(...)` | Hono's helpers, passed through with identical signatures. `$url` needs an absolute base; `$path` returns the route path only. |

## Endpoint members

`Input` = `Parameters<endpoint>[0]` of the Hono client; `Output` = parsed 2xx body (`undefined` for 204/205; text routes give `string`); `Err` = the error union (or `TMapped`).

| Member | Returns | Notes |
| --- | --- | --- |
| `call(input, options?)` | `Promise<Output>` | Rejects with `HonoRPCError` / `HonoRPCClientError` (or mapped). `input` optional when the route needs none. `options` is Hono `ClientRequestOptions`. |
| `safeCall(input, options?)` | `Promise<SafeResult<Output, Err>>` | Never rejects. `{ ok: true, data }` or `{ ok: false, error }`; destructuring `{ data, error }` works. |
| `key({ type?, input? })` | `QueryKey` | Partial key; `type` is `'query' \| 'infinite' \| 'mutation'`. |
| `queryKey({ input })` | `DataTag<QueryKey, Output, Err>` | Typed key for `getQueryData` / `setQueryData` / `getQueryState`. |
| `queryOptions({ input, client?, ...tanstack })` | options for `useQuery` etc. | `input` may be `skipToken` (not with suspense hooks). `select` is typed with `Output`. Any TanStack option except `queryKey` / `queryFn`. |
| `infiniteOptions({ input, initialPageParam, client?, ...tanstack })` | options for `useInfiniteQuery` | `input: (pageParam) => Input`, or `skipToken`. Key uses `input(initialPageParam)`. |
| `mutationKey()` | `QueryKey` | |
| `mutationOptions({ client?, ...tanstack })` | options for `useMutation` | Variables = `Input`. If `Input` is optional, `mutate()` needs no argument. Generic `TCtx` flows from `onMutate`. |
| `getData(qc, { input })` | `Output \| undefined` | Wraps `getQueryData`. |
| `setData(qc, { input, updater })` | `Output \| undefined` | `updater` is a value or `(old: Output \| undefined) => Output \| undefined`. |
| `cancel(qc, { input })` | `Promise<void>` | Cancels exactly this input (`exact: true`). |
| `invalidate(qc, { input?, keyType?, ...filters })` | `Promise<void>` | No `input`: every input of this endpoint. `keyType` filters query / infinite / mutation. |
| `fetch(qc, { input, client?, ...fetchOptions })` | `Promise<Output>` | `queryClient.fetchQuery`. |
| `prefetch(qc, { input, client?, ...fetchOptions })` | `Promise<void>` | `queryClient.prefetchQuery`; never throws. |
| `ensureData(qc, { input, client?, ...options })` | `Promise<Output>` | `queryClient.ensureQueryData`. |

`input` is a required property on the options object when the route needs input, and optional (so `getData(qc)` works) when it does not.

Key shape: `[['posts', ':id', '$get'], { type: 'query', input }]`; `type` and `input` are omitted when undefined so partial keys match.

## Errors

```ts
class HonoRPCError<TStatus extends number = number, TData = unknown> extends Error {
  readonly status: TStatus
  readonly data: TData          // parsed JSON body, raw text, or undefined (empty / unreadable)
  readonly response: Response   // headers, status; the body is already consumed
}

class HonoRPCClientError extends Error {
  readonly reason: 'network' | 'abort' | 'timeout' | 'parse'
  readonly cause: unknown       // the original thrown value
}

function isHonoRPCError<E>(e: E): e is Extract<E, HonoRPCError<any, any>>
function isHonoRPCClientError<E>(e: E): e is Extract<E, HonoRPCClientError>
```

For a route, `ErrorOf` = one `HonoRPCError<status, body>` per declared non-2xx response, plus `HonoRPCError<every other error status, unknown>`, plus `HonoRPCClientError`.
Classification rule: a response member whose status union contains any 2xx status is the success response.

Reasons: `network` (fetch rejected), `abort` (a signal aborted), `timeout` (an `AbortSignal.timeout()` fired), `parse` (a 2xx body could not be parsed). A malformed error body never hides the status.

## Exported types

`HonoQueryUtils<T, TMapped>`, `HonoQueryUtilsOptions<TMapped>`, `EndpointUtils<Fn, TErr>`, `CallContext`, `HttpMethod`, `SafeResult<T, E>`, `LibraryError` (= `HonoRPCError | HonoRPCClientError`),
`KeyType`, `HonoRPCClientErrorReason`, and helpers that take a **raw Hono endpoint** (`typeof client.posts.$get`): `InputOf<Fn>`, `OutputOf<Fn>`, `ErrorOf<Fn>`, `VariablesOf<Fn>`.

## Adapters

```ts
import { toResultAsync } from 'hono-rpc-tanstack-query/neverthrow'     // neverthrow ^8; ResultAsync<Output, Err>
import { toResult } from 'hono-rpc-tanstack-query/better-result'       // better-result ^3, ESM only; Promise<Result<Output, Err>>
```

Both take the promise returned by `safeCall` (any `PromiseLike<SafeResult<T, E>>`) and keep the route-typed (or mapped) error.
