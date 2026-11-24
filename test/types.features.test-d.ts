import type { QueryClient } from '@tanstack/query-core'
import { skipToken, useMutation, useQuery } from '@tanstack/react-query'
import type { Result } from 'better-result'
import type { ResultAsync } from 'neverthrow'
import { describe, expectTypeOf, test } from 'vitest'
import { createHonoQueryUtils, type CallContext, type ErrorOf, type LibraryError, type SafeResult } from '../src'
import { toResult } from '../src/better-result'
import { toResultAsync } from '../src/neverthrow'
import { makeApi, makeClient } from './fixture'

const api = makeApi()
const client = makeClient()
declare const qc: QueryClient
declare const id: string

type Post = { id: string; title: string; views: number }
type PostError = ErrorOf<typeof client.posts[':id']['$get']>
type AppError = { _tag: 'App'; cause: LibraryError }

const mapped = createHonoQueryUtils(client, {
  mapError: (error, context): AppError => {
    expectTypeOf(error).toEqualTypeOf<LibraryError>()
    expectTypeOf(context).toEqualTypeOf<CallContext>()
    return { _tag: 'App', cause: error }
  },
})

describe('safeCall', () => {
  test('is a discriminated union carrying the route-typed error', async () => {
    const r = await api.posts[':id'].$get.safeCall({ param: { id } })
    expectTypeOf(r).toEqualTypeOf<SafeResult<Post, PostError>>()
    if (r.ok) {
      expectTypeOf(r.data).toEqualTypeOf<Post>()
      expectTypeOf(r.error).toEqualTypeOf<undefined>()
    } else {
      expectTypeOf(r.error).toEqualTypeOf<PostError>()
      expectTypeOf(r.data).toEqualTypeOf<undefined>()
    }
  })

  test('go-style destructuring narrows on `error`', async () => {
    const { data, error } = await api.posts[':id'].$get.safeCall({ param: { id } })
    expectTypeOf(data).toEqualTypeOf<Post | undefined>()
    if (error) expectTypeOf(error).toEqualTypeOf<PostError>()
  })

  test('input rules match call()', () => {
    // @ts-expect-error input is required for routes with params
    api.posts[':id'].$get.safeCall()
    api.health.$get.safeCall()
    // @ts-expect-error wrong param type
    api.posts[':id'].$get.safeCall({ param: { id: 1 } })
  })

  test('204 endpoints give undefined data', async () => {
    const r = await api.posts[':id'].$delete.safeCall({ param: { id } })
    if (r.ok) expectTypeOf(r.data).toEqualTypeOf<undefined>()
  })
})

describe('mapError changes the error type everywhere', () => {
  test('hooks, safeCall and cache state use the mapped type', async () => {
    expectTypeOf(useQuery(mapped.posts[':id'].$get.queryOptions({ input: { param: { id } } })).error).toEqualTypeOf<AppError | null>()
    expectTypeOf(useMutation(mapped.posts.$post.mutationOptions()).error).toEqualTypeOf<AppError | null>()
    expectTypeOf(await mapped.posts[':id'].$get.safeCall({ param: { id } })).toEqualTypeOf<SafeResult<Post, AppError>>()
    expectTypeOf(qc.getQueryState(mapped.posts[':id'].$get.queryKey({ input: { param: { id } } }))?.error).toEqualTypeOf<
      AppError | null | undefined
    >()
  })

  test('output types are unaffected', () => {
    expectTypeOf(useQuery(mapped.posts[':id'].$get.queryOptions({ input: { param: { id } } })).data).toEqualTypeOf<Post | undefined>()
  })

  test('applies to deep routes and every method', async () => {
    const r = await mapped.a.b.c[':x'].$get.safeCall({ param: { x: '1' } })
    if (!r.ok) expectTypeOf(r.error).toEqualTypeOf<AppError>()
  })

  test('without mapError the route-typed union is kept', () => {
    expectTypeOf(useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } })).error).toEqualTypeOf<PostError | null>()
  })
})

describe('defaults', () => {
  test('retry sees the library error union when there is no mapper', () => {
    createHonoQueryUtils(client, {
      defaults: {
        query: {
          retry: (count, error) => {
            expectTypeOf(count).toBeNumber()
            expectTypeOf(error).toEqualTypeOf<LibraryError>()
            return false
          },
        },
      },
    })
  })

  test('retry sees the mapped error type when there is one', () => {
    createHonoQueryUtils(client, {
      mapError: (e): AppError => ({ _tag: 'App', cause: e }),
      defaults: {
        query: { retry: (_count, error) => (expectTypeOf(error).toEqualTypeOf<AppError>(), false) },
        mutation: { retry: (_count, error) => (expectTypeOf(error).toEqualTypeOf<AppError>(), false) },
      },
    })
  })

  test('client defaults accept static options or a typed function', () => {
    createHonoQueryUtils(client, { defaults: { client: { headers: { a: 'b' } } } })
    createHonoQueryUtils(client, {
      defaults: {
        client: (context) => {
          expectTypeOf(context.route).toEqualTypeOf<readonly string[]>()
          expectTypeOf(context.method).toEqualTypeOf<'get' | 'post' | 'put' | 'patch' | 'delete' | 'head' | 'options'>()
          return { headers: { 'x-route': context.route.join('/') } }
        },
      },
    })
  })

  test('only cross-endpoint-safe options are allowed as defaults', () => {
    createHonoQueryUtils(client, {
      defaults: {
        // @ts-expect-error select is endpoint-specific
        query: { select: (d: unknown) => d },
      },
    })
    createHonoQueryUtils(client, {
      // @ts-expect-error keys are owned by the library
      defaults: { query: { queryKey: ['x'] } },
    })
    createHonoQueryUtils(client, {
      // @ts-expect-error unknown option
      defaults: { mutation: { onSuccess: () => {} } },
    })
  })
})

describe('cache helpers', () => {
  const p = api.posts[':id'].$get

  test('getData / fetch / ensureData / prefetch are typed with the output', () => {
    expectTypeOf(p.getData(qc, { input: { param: { id } } })).toEqualTypeOf<Post | undefined>()
    expectTypeOf(p.fetch(qc, { input: { param: { id } } })).toEqualTypeOf<Promise<Post>>()
    expectTypeOf(p.ensureData(qc, { input: { param: { id } } })).toEqualTypeOf<Promise<Post>>()
    expectTypeOf(p.prefetch(qc, { input: { param: { id } } })).toEqualTypeOf<Promise<void>>()
  })

  test('setData: typed updater and return', () => {
    const next = p.setData(qc, {
      input: { param: { id } },
      updater: (old) => {
        expectTypeOf(old).toEqualTypeOf<Post | undefined>()
        return old && { ...old, views: old.views + 1 }
      },
    })
    expectTypeOf(next).toEqualTypeOf<Post | undefined>()
    // @ts-expect-error wrong shape
    p.setData(qc, { input: { param: { id } }, updater: { nope: true } })
    // @ts-expect-error input is required
    p.setData(qc, { updater: undefined })
  })

  test('input is required exactly when the route needs it', () => {
    // @ts-expect-error
    p.getData(qc)
    // @ts-expect-error
    p.fetch(qc)
    // @ts-expect-error
    p.cancel(qc)
    api.health.$get.getData(qc)
    api.health.$get.fetch(qc)
    api.health.$get.cancel(qc)
    api.health.$get.setData(qc, { updater: { ok: true } })
  })

  test('wrong input types are rejected', () => {
    // @ts-expect-error
    p.getData(qc, { input: { param: { id: 1 } } })
    // @ts-expect-error
    p.invalidate(qc, { input: { param: { id: 1 } } })
  })

  test('skipToken is not accepted where a real fetch happens', () => {
    // @ts-expect-error
    p.fetch(qc, { input: skipToken })
    // @ts-expect-error
    p.prefetch(qc, { input: skipToken })
  })

  test('fetch options are typed', () => {
    p.fetch(qc, { input: { param: { id } }, staleTime: 1000, client: { headers: { a: 'b' } } })
    // @ts-expect-error unknown option
    p.fetch(qc, { input: { param: { id } }, nope: true })
  })

  test('invalidate / $invalidate accept QueryClient filters and key types', () => {
    expectTypeOf(p.invalidate(qc)).toEqualTypeOf<Promise<void>>()
    p.invalidate(qc, { input: { param: { id } }, keyType: 'query', type: 'active', refetchType: 'none' })
    // @ts-expect-error unknown key type
    p.invalidate(qc, { keyType: 'nope' })
    // @ts-expect-error TanStack's `type` filter is not our key type
    p.invalidate(qc, { type: 'infinite' })
    expectTypeOf(api.posts.$invalidate(qc, { keyType: 'infinite', type: 'all', refetchType: 'all' })).toEqualTypeOf<Promise<void>>()
    expectTypeOf(api.$invalidate(qc)).toEqualTypeOf<Promise<void>>()
  })

  test('the first argument must be a QueryClient', () => {
    // @ts-expect-error
    p.getData({}, { input: { param: { id } } })
  })
})

describe('$url / $path are passed through with Hono’s own types', () => {
  test('identical signatures', () => {
    expectTypeOf(api.posts[':id'].$url).toEqualTypeOf<(typeof client.posts)[':id']['$url']>()
    expectTypeOf(api.posts[':id'].$path).toEqualTypeOf<(typeof client.posts)[':id']['$path']>()
  })

  test('results', () => {
    expectTypeOf(api.posts[':id'].$url({ param: { id } })).toExtend<URL>()
    expectTypeOf(api.posts[':id'].$path({ param: { id } })).toBeString()
  })

  test('$ws and unknown $-members stay hidden', () => {
    // @ts-expect-error
    api.posts.$ws
    // @ts-expect-error
    api.posts.$whatever
  })
})

describe('result adapters', () => {
  test('neverthrow: ResultAsync<Output, Error>', () => {
    const r = toResultAsync(api.posts[':id'].$get.safeCall({ param: { id } }))
    expectTypeOf(r).toEqualTypeOf<ResultAsync<Post, PostError>>()
    r.map((post) => expectTypeOf(post).toEqualTypeOf<Post>())
    r.mapErr((e) => expectTypeOf(e).toEqualTypeOf<PostError>())
  })

  test('neverthrow carries the mapped error type', () => {
    expectTypeOf(toResultAsync(mapped.posts[':id'].$get.safeCall({ param: { id } }))).toEqualTypeOf<ResultAsync<Post, AppError>>()
  })

  test('better-result: Promise<Result<Output, Error>>', () => {
    expectTypeOf(toResult(api.posts[':id'].$get.safeCall({ param: { id } }))).toEqualTypeOf<Promise<Result<Post, PostError>>>()
    expectTypeOf(toResult(mapped.posts[':id'].$get.safeCall({ param: { id } }))).toEqualTypeOf<Promise<Result<Post, AppError>>>()
  })

  test('both only accept safeCall-shaped promises', () => {
    // @ts-expect-error a plain promise of data is not a SafeResult
    toResultAsync(api.health.$get.call())
    // @ts-expect-error
    toResult(api.health.$get.call())
  })
})
