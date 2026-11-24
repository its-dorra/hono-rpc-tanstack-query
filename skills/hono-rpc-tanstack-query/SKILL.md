---
name: hono-rpc-tanstack-query
description: How to use the hono-rpc-tanstack-query library, which wraps a Hono RPC client (hc) in type-safe TanStack Query options. Use this skill whenever the user connects a Hono backend to a frontend that uses TanStack Query (React Query, Vue Query, Solid Query, Svelte Query), mentions hc, the Hono RPC client with an AppType, Hono RPC, queryOptions, mutationOptions, createHonoQueryUtils, HonoRPCError, safeCall, typed query keys, optimistic updates or cache invalidation with Hono, wants the TanStack Query `error` typed from Hono route responses, or wants neverthrow / better-result / tagged errors with a Hono client. Also use it for debugging retries on 404s, query-core type mismatches, or Hono validator 400 typing in this context, even if the user never names the library.
---

# hono-rpc-tanstack-query

A thin, type-safe layer between Hono's RPC client (`hc`) and TanStack Query. Given an `hc` client it returns **plain option objects**
(`queryOptions`, `mutationOptions`, `infiniteOptions`), typed query keys, typed cache helpers and an `error` whose type comes from the
responses the Hono routes declare. Nothing is generated; every type is derived from Hono's own inferred client type.

Use it when the user has (or is building) a Hono app and a TanStack Query frontend. Do not use it for non-Hono backends, and do not
add it to a project that only makes one or two calls (plain `hc` plus `useQuery` is fine there).

## Setup checklist

1. `npm i @dorra/hono-rpc-tanstack-query` (peers: `hono ^4.7`, `@tanstack/query-core ^5.62`, which the TanStack adapter already installs).
2. Make sure there is **one** copy of `@tanstack/query-core` in the tree. Duplicates cause baffling "not assignable" errors on `Query` / `Mutation`.
3. The server must `export type AppType = typeof app`, with routes chained on the `Hono` instance so the type accumulates.
4. Create the utils once and import it everywhere:

```ts
import { hc } from 'hono/client'
import { createHonoQueryUtils } from 'hono-rpc-tanstack-query'
import type { AppType } from '../server/app'

export const api = createHonoQueryUtils(hc<AppType>('/api'))
```

## Mental model (four rules)

1. **The utils mirror the client.** `client.posts[':id'].$get` becomes `api.posts[':id'].$get`. Methods keep their `$` prefix (`$get`, `$post`, `$put`, `$patch`, `$delete`).
2. **`input` is exactly what the Hono client method takes**: `{ param, query, json, header, form }`. It is optional only when the route needs no input.
3. **Options, not hooks.** `queryOptions(...)` returns an object you hand to the framework's own `useQuery` / `createQuery` / `fetchQuery`. That is why one library serves React, Vue, Solid and Svelte.
4. **Errors are a closed, typed union.** Every failure is either `HonoRPCError<status, data>` (server answered non-2xx) or `HonoRPCClientError` (no usable response: `reason` is `network | abort | timeout | parse`). Hono's `hc` resolves on 404/500 instead of rejecting; the library converts that so TanStack's error channel works.

## The server contract that drives the types

The `error` type comes from what the routes declare, so write routes with explicit statuses:

```ts
.get('/posts/:id', (c) => {
  const post = find(c.req.param('id'))
  if (!post) return c.json({ message: 'not found' }, 404)   // -> HonoRPCError<404, { message: string }>
  return c.json(post)                                        // -> the typed success body
})
```

- Undeclared error statuses (500, 502, ...) are still typed, with `data: unknown`.
- **Validator middleware (e.g. `@hono/zod-validator`) does not declare its 400.** To type it, return it from the hook:
  `zValidator('json', schema, (r, c) => { if (!r.success) return c.json({ error: 'invalid' as const }, 400) })`. Tell the user this when they ask why a 400 body is `unknown`.

## Standard patterns

**Query**

```ts
const { data, error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
useQuery(api.health.$get.queryOptions())                      // no input needed
useQuery(api.posts[':id'].$get.queryOptions({ input: id ? { param: { id } } : skipToken }))   // disabled until id exists
```

**Narrowing the error** (prefer `instanceof` on the hook's typed `error`; use the guard when you hold a value the compiler already typed):

```ts
if (error instanceof HonoRPCError && error.status === 404) error.data.message   // typed
else if (error instanceof HonoRPCClientError) error.reason
```

**Mutation + invalidation**

```ts
const create = useMutation(api.posts.$post.mutationOptions({ onSuccess: () => api.posts.$invalidate(queryClient) }))
create.mutate({ json: { title } })
```

**Infinite query**

```ts
useInfiniteQuery(api.posts.$get.infiniteOptions({
  input: (cursor: string | undefined) => ({ query: { cursor } }),
  initialPageParam: undefined,
  getNextPageParam: (last) => last.nextCursor ?? undefined,
}))
```

**Optimistic update** (typed cache helpers, first argument is the QueryClient): `cancel` the in-flight query, `getData` a snapshot, `setData` with an updater, roll back in `onError`, `$invalidate` in `onSettled`. Full example in `references/recipes.md`.

**Errors as values:** `const { data, error } = await api.posts[':id'].$get.safeCall({ param: { id } })` never rejects. Optional adapters: `hono-rpc-tanstack-query/neverthrow` (`toResultAsync`) and `/better-result` (`toResult`, ESM only).

## Choosing the right feature

| The user wants | Use |
| --- | --- |
| Status-specific UI (404 vs 409) | the route-typed `error` from hooks; declare statuses on the server |
| One app-wide error type (tagged errors, toasts) | `mapError` in `createHonoQueryUtils` (trade-off: loses per-route status/body typing) |
| Errors as return values, no try/catch | `safeCall`, or the neverthrow / better-result adapters |
| Auth header on every request | `defaults.client` with a headers **function** so the token is read per request |
| Different request options per route | `defaults.client` as a function of `{ route, method }` |
| staleTime / gcTime for all queries | `defaults.query`, or TanStack's `setQueryDefaults(api.posts.$key(), ...)` |
| Fewer retries / no retry on 4xx | TanStack's own `retry` and `retryDelay` (typed `error` inside them). Do **not** build another retry layer |
| Invalidate a section | `api.posts.$invalidate(qc)`; one endpoint: `endpoint.invalidate(qc, { input? })` |
| Seed or patch the cache | `getData` / `setData` / `ensureData` / `prefetch` on the endpoint |
| A URL for a link or download | `$url` (absolute base only) or `$path` (works with relative base) |

## Framework wiring

Everything returned is a plain object; only the reactivity wrapper differs. Static options can always be passed directly.

| Framework | Reactive input |
| --- | --- |
| React | `useQuery(api...queryOptions({ input: { param: { id } } }))` |
| Vue | `useQuery(computed(() => api...queryOptions({ input: { param: { id: id.value } } })))` |
| Solid | `createQuery(() => api...queryOptions({ input: { param: { id: id() } } }))` |
| Svelte 5 (svelte-query v6) | `createQuery(() => api...queryOptions({ input: { param: { id } } }))` |

## Pitfalls (and why)

- **`invalidate` / `$invalidate` use `keyType`, not `type`.** `type` is TanStack's own filter (`active | inactive | all`) and would collide.
- **Do not add a retry helper or retry inside `queryFn`.** TanStack already retries (3 times, including 404s by default); doubling it multiplies attempts. Configure `retry` / `retryDelay` instead.
- **`skipToken` is rejected by suspense hooks** at compile time (suspense queries cannot be disabled). Render the component only once the input exists.
- **Returned option *types* omit** `enabled`, `staleTime`, `refetchInterval`, `refetchOnWindowFocus`, `refetchOnReconnect`, `refetchOnMount`, `retryOnMount`, `throwOnError` (Vue's adapter rejects them otherwise). They are still accepted as inputs and forwarded at runtime. Do not "fix" this by casting.
- **Inputs go into the query key**, so they must be JSON-serialisable. Use `mutationOptions` or `call` for `File` / `Blob` form uploads.
- **`input` for `infiniteOptions` must be pure**; it is called once at construction to build the key.
- **`$url` throws on a relative base** (`hc('/api')`). Use `$path`.
- **A route segment literally named `then` is unreachable** through the utils.
- **Mutations cannot be cancelled** (TanStack gives no signal), queries can.

## Verifying generated code

Run `tsc --noEmit`. The value of this library is compile-time safety, so a green type-check is the real test: `error.status === 404` should
narrow `error.data`, `data` should have the route's shape, and wrong `input` shapes should be errors. If `error.data` is `unknown` where the
user expects a body, the server route is not declaring that status (see the server contract above).

## References (load only what the task needs)

- `references/api.md`: every option, member and exported type with signatures. Read when writing against an unfamiliar member or answering "what does X accept".
- `references/recipes.md`: optimistic updates, auth headers, per-route timeouts, tagged-error mapping, Result adapters, pagination, dependent queries, in-memory testing, SSR prefetch, Vue/Solid/Svelte full examples.
- `references/troubleshooting.md`: symptom → cause → fix for type errors and runtime surprises.
