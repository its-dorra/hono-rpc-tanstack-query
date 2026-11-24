# Troubleshooting

Find the symptom, read the cause, apply the fix.

| Symptom | Cause | Fix |
| --- | --- | --- |
| "Type 'Query<...>' / 'Mutation<...>' is not assignable to ..." on `useQuery(...)`, often across several frameworks | Two copies of `@tanstack/query-core` (an adapter installed its own) | `npm ls @tanstack/query-core`; dedupe with `overrides` (npm), `resolutions` (yarn) or `pnpm.overrides` |
| `error.data` is `unknown` where a body is expected | The route does not declare that status with `c.json(body, status)` | Declare it on the server. For validator 400s, return a typed body from the validator hook |
| `error.status === 404` does not narrow `error.data` | `error` was widened (`catch (e)`, `as Error`, or `mapError` in use) | Use the hook's typed `error`, or `isHonoRPCError(e)` first. With `mapError`, narrowing is on your own type |
| `data` has `Date`-like fields as strings | Hono serialises JSON; the type is the JSON-parsed shape | Expected: map to `Date` in `select` |
| Queries retry 404s three times | TanStack's default retry policy | `retry: (count, error) => !(error instanceof HonoRPCError && error.status < 500) && count < 3` in `defaults.query` or per call |
| Retries seem to multiply | A retry loop was added around `call` / inside `queryFn` | Remove it; TanStack already retries |
| `$url` throws `Invalid URL` | Hono's `$url` needs an absolute base (`hc('http://...')`) | Use `$path`, or give `hc` an absolute base |
| `invalidate(qc, { type: 'infinite' })` is a type error | `type` is TanStack's filter (`active \| inactive \| all`) | Use `keyType: 'infinite'` |
| `queryOptions(...).staleTime` (or `.enabled`) is missing from the type | Those fields are omitted from returned types on purpose (Vue compatibility) | Read the value you passed; at runtime the property is present |
| `useSuspenseQuery(...queryOptions({ input: cond ? x : skipToken }))` fails to compile | Suspense hooks cannot be disabled | Render the component only when the input exists |
| Cache entry not found by `getData` | Different `input` object shape (extra `query: {}` vs none) is a different key | Use exactly the input the query uses; `{ query: {} }` and no query are different keys |
| Invalidate does nothing | The key prefix does not match (wrong node) | Use `api.posts.$key()` for a subtree or `endpoint.key()` for one endpoint; check `queryClient.getQueryCache().getAll().map(q => q.queryKey)` |
| `require('hono-rpc-tanstack-query/better-result')` fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` | `better-result` is ESM-only, so its adapter is too | `import` it from an ESM context |
| `data`/`error` are `any` | `AppType` is not inferred (routes not chained, or `hc` created without the generic) | `new Hono().get(...).post(...)` chain, `export type AppType = typeof app`, `hc<AppType>(...)` |
| A route named `then` is unreachable | Proxy must not be thenable | Rename the route segment |
| Mutation cannot be aborted | TanStack provides no signal to mutations | Cancel at a higher level (ignore result, guard UI) |
| `error.reason` is `'network'` for a timeout | A custom `fetch` rejected with an error not named `TimeoutError` | The library recognises `AbortError` / `TimeoutError` by name; make the custom fetch propagate the signal's reason |

## When the type-check is slow

Large `AppType`s make Hono's own client types heavy. The utils evaluate lazily (only the endpoints you touch), but their cost has not been
benchmarked on very large apps. If a project suffers, split the app into several `hc` clients (one per sub-app) and create utils for each.
