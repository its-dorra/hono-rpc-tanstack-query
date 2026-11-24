# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-22

### Added
- `createHonoQueryUtils(client, options?)`: a typed proxy over a Hono RPC client (`hc`) returning plain TanStack Query option objects.
- Per endpoint: `call`, `safeCall`, `key`, `queryKey`, `queryOptions`, `infiniteOptions`, `mutationKey`, `mutationOptions`.
- Typed errors: `HonoRPCError<status, body>` for declared and undeclared HTTP statuses, `HonoRPCClientError` (`network` | `abort` | `timeout` | `parse`), and the `isHonoRPCError` / `isHonoRPCClientError` guards. The `error` seen by hooks is a closed, route-typed union.
- Optional `mapError` to replace the error type with your own.
- `defaults` for request options (static or per-request function) and for query / mutation options.
- Cache helpers: `getData`, `setData`, `cancel`, `invalidate`, `fetch`, `prefetch`, `ensureData`, plus node-level `$key` and `$invalidate`.
- `$url` and `$path` passed through from Hono's client.
- Optional subpath exports `@dorra/hono-rpc-tanstack-query/neverthrow` and `@dorra/hono-rpc-tanstack-query/better-result` (ESM only).
- Hierarchical query keys that work with TanStack's partial matching; stable (cached) node identity.
- Verified against React, Vue (including runtime reactivity), Solid and Svelte type-level.
- A Claude Agent Skill (`skills/@dorra/hono-rpc-tanstack-query`), included in the npm package and attached to each GitHub Release as a `.skill` file.
