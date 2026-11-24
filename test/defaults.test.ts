import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { createHonoQueryUtils, HonoRPCError, type CallContext } from '../src'
import { inMemoryFetch, makeClient } from './fixture'

const spyFetch = () => vi.fn(inMemoryFetch)
const make = (spy: any, defaults: Parameters<typeof createHonoQueryUtils>[1] extends infer O ? (O extends { defaults?: infer D } ? D : never) : never) =>
  createHonoQueryUtils(makeClient(spy), { defaults })
const headersOf = (spy: ReturnType<typeof spyFetch>, call = 0) => new Headers(spy.mock.calls[call]![1].headers)

describe('defaults.client', () => {
  it('applies static headers to every request', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { headers: { authorization: 'Bearer t' } } })
    await api.health.$get.call()
    await api.text.$get.call()
    expect(headersOf(spy, 0).get('authorization')).toBe('Bearer t')
    expect(headersOf(spy, 1).get('authorization')).toBe('Bearer t')
  })

  it('per-call headers win, case-insensitively, and others are kept', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { headers: { Authorization: 'default', 'x-keep': 'kept' } } })
    await api.health.$get.call(undefined, { headers: { authorization: 'override' } })
    expect(headersOf(spy).get('authorization')).toBe('override')
    expect(headersOf(spy).get('x-keep')).toBe('kept')
  })

  it('a function is evaluated per request with route and method context', async () => {
    const spy = spyFetch()
    const seen: CallContext[] = []
    const api = make(spy, {
      client: (ctx) => {
        seen.push(ctx)
        return { headers: { 'x-route': ctx.route.join('/'), 'x-method': ctx.method } }
      },
    })
    await api.posts[':id'].$get.call({ param: { id: '1' } })
    await api.posts.$post.call({ json: { title: 'a' } })
    expect(headersOf(spy, 0).get('x-route')).toBe('posts/:id')
    expect(headersOf(spy, 0).get('x-method')).toBe('get')
    expect(headersOf(spy, 1).get('x-method')).toBe('post')
    expect(seen).toHaveLength(2)
  })

  it('a function may return undefined', async () => {
    const spy = spyFetch()
    await make(spy, { client: () => undefined }).health.$get.call()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('function headers (resolved per request) combine with static per-call headers', async () => {
    const spy = spyFetch()
    let token = 'one'
    const api = make(spy, { client: { headers: async () => ({ authorization: token }) } })
    await api.health.$get.call(undefined, { headers: { 'x-extra': 'e' } })
    token = 'two'
    await api.health.$get.call(undefined, { headers: { 'x-extra': 'e' } })
    expect(headersOf(spy, 0).get('authorization')).toBe('one')
    expect(headersOf(spy, 1).get('authorization')).toBe('two')
    expect(headersOf(spy, 1).get('x-extra')).toBe('e')
  })

  it('static default headers combine with function per-call headers', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { headers: { 'x-default': 'd' } } })
    await api.health.$get.call(undefined, { headers: () => ({ 'x-call': 'c' }) })
    expect(headersOf(spy).get('x-default')).toBe('d')
    expect(headersOf(spy).get('x-call')).toBe('c')
  })

  it('function + function headers both resolve, per-call wins', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { headers: () => ({ 'x-a': 'default', 'x-b': 'b' }) } })
    await api.health.$get.call(undefined, { headers: () => ({ 'x-a': 'call' }) })
    expect(headersOf(spy).get('x-a')).toBe('call')
    expect(headersOf(spy).get('x-b')).toBe('b')
  })

  it('shallow-merges `init` instead of replacing it', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { init: { cache: 'no-store', credentials: 'include' } } })
    await api.health.$get.call(undefined, { init: { credentials: 'omit' } })
    const init = spy.mock.calls[0]![1]
    expect(init.cache).toBe('no-store')
    expect(init.credentials).toBe('omit')
  })

  it('merges init when only one side defines it', async () => {
    const spy = spyFetch()
    await make(spy, { client: { headers: { a: '1' } } }).health.$get.call(undefined, { init: { cache: 'reload' } })
    expect(spy.mock.calls[0]![1].cache).toBe('reload')
    const spy2 = spyFetch()
    await make(spy2, { client: { init: { cache: 'reload' } } }).health.$get.call(undefined, { headers: { a: '1' } })
    expect(spy2.mock.calls[0]![1].cache).toBe('reload')
  })

  it('a per-call fetch replaces the default one', async () => {
    const base = spyFetch()
    const override = vi.fn(async () => Response.json({ ok: true }))
    await make(base, { client: { headers: { a: '1' } } }).health.$get.call(undefined, { fetch: override as any })
    expect(override).toHaveBeenCalledTimes(1)
    expect(base).not.toHaveBeenCalled()
  })

  it('applies to queries, infinite queries and mutations alike', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { headers: { 'x-d': '1' } } })
    const qc = new QueryClient()
    await qc.fetchQuery(api.health.$get.queryOptions())
    await qc.fetchInfiniteQuery(api.posts.$get.infiniteOptions({ input: () => ({ query: {} }), initialPageParam: 0, getNextPageParam: () => undefined }))
    await new MutationObserver(qc, api.posts.$post.mutationOptions()).mutate({ json: { title: 'x' } })
    for (let i = 0; i < 3; i++) expect(headersOf(spy, i).get('x-d')).toBe('1')
  })

  it('keeps TanStack’s abort signal when init defaults exist', async () => {
    const spy = spyFetch()
    const api = make(spy, { client: { init: { cache: 'no-store' } } })
    await new QueryClient().fetchQuery(api.health.$get.queryOptions())
    expect(spy.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    expect(spy.mock.calls[0]![1].cache).toBe('no-store')
  })

  it('does not alter requests when no defaults are given', async () => {
    const spy = spyFetch()
    await createHonoQueryUtils(makeClient(spy)).health.$get.call()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('defaults.query / defaults.mutation', () => {
  const api = createHonoQueryUtils(makeClient(), {
    defaults: { query: { staleTime: 1000, gcTime: 2000, meta: { source: 'defaults' } }, mutation: { retry: 4, meta: { m: 1 } } },
  })

  it('are applied to queryOptions and infiniteOptions', () => {
    expect(api.health.$get.queryOptions()).toMatchObject({ staleTime: 1000, gcTime: 2000, meta: { source: 'defaults' } })
    expect(
      api.posts.$get.infiniteOptions({ input: () => ({ query: {} }), initialPageParam: 0, getNextPageParam: () => undefined }),
    ).toMatchObject({ staleTime: 1000 })
  })

  it('call-site options win (shallow merge)', () => {
    expect(api.health.$get.queryOptions({ staleTime: 5 })).toMatchObject({ staleTime: 5, gcTime: 2000 })
    expect(api.health.$get.queryOptions({ meta: { own: true } }).meta).toEqual({ own: true })
  })

  it('mutation defaults only affect mutationOptions', () => {
    expect(api.posts.$post.mutationOptions()).toMatchObject({ retry: 4, meta: { m: 1 } })
    expect(api.posts.$post.mutationOptions({ retry: 0 })).toMatchObject({ retry: 0 })
    expect(api.health.$get.queryOptions()).not.toHaveProperty('retry')
  })

  it('can never override the key or the function', () => {
    const o = api.health.$get.queryOptions() as any
    expect(o.queryKey).toEqual([['health', '$get'], { type: 'query' }])
    expect(typeof o.queryFn).toBe('function')
  })

  it('without defaults, nothing extra appears on the options', () => {
    const plain = createHonoQueryUtils(makeClient()).health.$get.queryOptions()
    expect(Object.keys(plain).sort()).toEqual(['queryFn', 'queryKey'])
  })
})

describe('retry: TanStack’s own option, typed against the error union', () => {
  const run = async (id: string, retryOpts: object) => {
    const spy = spyFetch()
    const api = createHonoQueryUtils(makeClient(spy), {
      defaults: {
        query: {
          // typed: `error` is HonoRPCError | HonoRPCClientError; retry only server-side / network failures, at most twice
          retry: (count, error) => !(error instanceof HonoRPCError && error.status < 500) && count < 2,
          retryDelay: 0,
          ...retryOpts,
        },
      },
    })
    const qc = new QueryClient()
    const opts = id === 'broken' ? api['broken-html'].$get.queryOptions() : api.posts[':id'].$get.queryOptions({ input: { param: { id } } })
    await qc.fetchQuery(opts as any).catch(() => {})
    return spy.mock.calls.length
  }

  it('does not retry a 404', async () => expect(await run('0', {})).toBe(1))
  it('retries a 500 until the predicate says stop (initial try + 2 retries)', async () => expect(await run('broken', {})).toBe(3))
})
