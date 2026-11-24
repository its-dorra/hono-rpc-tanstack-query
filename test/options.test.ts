import { hashKey, InfiniteQueryObserver, MutationObserver, QueryClient, QueryObserver, skipToken } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { HonoRPCError } from '../src'
import { inMemoryFetch, makeApi } from './fixture'

const spyFetch = () => vi.fn(inMemoryFetch)
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
const urlsOf = (spy: ReturnType<typeof spyFetch>) => spy.mock.calls.map((c) => String(c[0]))

describe('keys', () => {
  const api = makeApi()

  it('encodes the full route path (method included) and the input', () => {
    expect(api.posts[':id'].$get.queryKey({ input: { param: { id: '7' } } })).toEqual([
      ['posts', ':id', '$get'],
      { type: 'query', input: { param: { id: '7' } } },
    ])
  })

  it('omits `input` when there is none, so partial matching works', () => {
    expect(api.health.$get.queryKey()).toEqual([['health', '$get'], { type: 'query' }])
    expect(api.health.$get.key()).toEqual([['health', '$get']])
  })

  it('key() accepts type and input filters', () => {
    expect(api.posts.$get.key({ type: 'infinite' })).toEqual([['posts', '$get'], { type: 'infinite' }])
    expect(api.posts.$get.key({ type: 'query', input: { query: { cursor: 'c' } } })).toEqual([
      ['posts', '$get'],
      { type: 'query', input: { query: { cursor: 'c' } } },
    ])
  })

  it('node-level $key() gives prefix keys, optionally narrowed by type', () => {
    expect(api.$key()).toEqual([[]])
    expect(api.posts.$key()).toEqual([['posts']])
    expect(api.posts[':id'].$key({ type: 'mutation' })).toEqual([['posts', ':id'], { type: 'mutation' }])
  })

  it('mutationKey', () => {
    expect(api.posts.$post.mutationKey()).toEqual([['posts', '$post'], { type: 'mutation' }])
  })

  it('same input hashes equally regardless of key order or undefined fields', () => {
    const a = api.posts.$get.queryKey({ input: { query: { cursor: 'a', limit: '5' } } })
    const b = api.posts.$get.queryKey({ input: { query: { limit: '5', cursor: 'a' } } })
    const c = api.posts.$get.queryKey({ input: { query: { cursor: 'a', limit: '5', ...{ extra: undefined } } as any } })
    expect(hashKey(a)).toBe(hashKey(b))
    expect(hashKey(a)).toBe(hashKey(c))
  })

  it('different inputs, methods and routes hash differently', () => {
    const hashes = new Set([
      hashKey(api.posts[':id'].$get.queryKey({ input: { param: { id: '1' } } })),
      hashKey(api.posts[':id'].$get.queryKey({ input: { param: { id: '2' } } })),
      hashKey(api.posts[':id'].$delete.queryKey({ input: { param: { id: '1' } } })),
      hashKey(api.health.$get.queryKey()),
    ])
    expect(hashes.size).toBe(4)
  })

  describe('invalidation semantics', () => {
    const seed = async () => {
      const qc = newClient()
      const posts = api.posts[':id'].$get.queryKey({ input: { param: { id: '7' } } })
      await qc.fetchQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '7' } } }))
      await qc.fetchQuery(api.health.$get.queryOptions())
      await qc.fetchInfiniteQuery({
        ...api.posts.$get.infiniteOptions({
          input: (cursor: string | undefined) => ({ query: { cursor } }),
          initialPageParam: undefined,
          getNextPageParam: () => undefined,
        }),
      })
      const invalidated = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated
      return { qc, posts, invalidated }
    }

    it('a root key invalidates everything', async () => {
      const { qc, posts, invalidated } = await seed()
      await qc.invalidateQueries({ queryKey: api.$key() })
      expect(invalidated(posts)).toBe(true)
      expect(invalidated(api.health.$get.queryKey())).toBe(true)
    })

    it('a prefix key invalidates only its subtree', async () => {
      const { qc, posts, invalidated } = await seed()
      await qc.invalidateQueries({ queryKey: api.posts.$key() })
      expect(invalidated(posts)).toBe(true)
      expect(invalidated(api.health.$get.queryKey())).toBe(false)
    })

    it('an endpoint key() invalidates every input of that endpoint', async () => {
      const { qc, posts, invalidated } = await seed()
      await qc.invalidateQueries({ queryKey: api.posts[':id'].$get.key() })
      expect(invalidated(posts)).toBe(true)
      expect(invalidated(api.health.$get.queryKey())).toBe(false)
    })

    it('an input-specific key() leaves other inputs alone', async () => {
      const { qc, posts, invalidated } = await seed()
      await qc.fetchQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '8' } } }))
      await qc.invalidateQueries({ queryKey: api.posts[':id'].$get.key({ input: { param: { id: '8' } } }) })
      expect(invalidated(api.posts[':id'].$get.queryKey({ input: { param: { id: '8' } } }))).toBe(true)
      expect(invalidated(posts)).toBe(false)
    })

    it('type filters separate regular and infinite queries of the same endpoint', async () => {
      const qc = newClient()
      await qc.fetchQuery(api.posts.$get.queryOptions({ input: { query: {} } }))
      await qc.fetchInfiniteQuery(
        api.posts.$get.infiniteOptions({
          input: (cursor: string | undefined) => ({ query: { cursor } }),
          initialPageParam: undefined,
          getNextPageParam: () => undefined,
        }),
      )
      await qc.invalidateQueries({ queryKey: api.posts.$get.key({ type: 'infinite' }) })
      const states = qc.getQueryCache().getAll().map((q) => [(q.queryKey[1] as any).type, q.state.isInvalidated])
      expect(Object.fromEntries(states)).toEqual({ query: false, infinite: true })
    })
  })
})

describe('queryOptions', () => {
  it('fetches through QueryClient and returns the parsed body', async () => {
    const data = await newClient().fetchQuery(makeApi().posts[':id'].$get.queryOptions({ input: { param: { id: '7' } } }))
    expect(data).toEqual({ id: '7', title: 'hello', views: 3 })
  })

  it('does not leak `input` or `client` into the returned options', () => {
    const o = makeApi().posts[':id'].$get.queryOptions({ input: { param: { id: '1' } }, client: { headers: {} } })
    expect(o).not.toHaveProperty('input')
    expect(o).not.toHaveProperty('client')
  })

  it('passes TanStack options through untouched', () => {
    const select = (d: { ok: true }) => d.ok
    const o = makeApi().health.$get.queryOptions({ staleTime: 1234, gcTime: 99, retry: 2, meta: { a: 1 }, enabled: false, select })
    expect(o).toMatchObject({ staleTime: 1234, gcTime: 99, retry: 2, meta: { a: 1 }, enabled: false })
    expect(o.select).toBe(select)
  })

  it('select transforms data through a QueryObserver', async () => {
    const qc = newClient()
    const o = makeApi().posts[':id'].$get.queryOptions({
      input: { param: { id: '3' } },
      select: (post) => post.title.toUpperCase(),
    })
    const result = await new QueryObserver(qc, o).refetch()
    expect(result.data).toBe('HELLO')
    // the cache keeps the raw value
    expect(qc.getQueryData(makeApi().posts[':id'].$get.queryKey({ input: { param: { id: '3' } } }))).toMatchObject({ id: '3' })
  })

  it('is idempotent: building options twice yields equal keys', () => {
    const api = makeApi()
    const k = () => api.posts[':id'].$get.queryOptions({ input: { param: { id: '1' } } }).queryKey
    expect(hashKey(k())).toBe(hashKey(k()))
  })

  it('a rejected query surfaces the typed error on the QueryClient', async () => {
    const qc = newClient()
    const err = await qc
      .fetchQuery(makeApi().posts[':id'].$get.queryOptions({ input: { param: { id: '0' } } }))
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(HonoRPCError)
    const state = qc.getQueryState(makeApi().posts[':id'].$get.queryKey({ input: { param: { id: '0' } } }))
    expect(state?.status).toBe('error')
    expect((state?.error as HonoRPCError).status).toBe(404)
  })

  it('dedupes concurrent fetches of the same key', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    const o = api.posts[':id'].$get.queryOptions({ input: { param: { id: '1' } } })
    await Promise.all([qc.fetchQuery(o), qc.fetchQuery(o)])
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('serves a fresh cache entry without refetching', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    const o = api.health.$get.queryOptions({ staleTime: 60_000 })
    await qc.fetchQuery(o)
    await qc.fetchQuery(o)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  describe('skipToken', () => {
    it('yields a skipToken queryFn and an input-less key', () => {
      const o = makeApi().posts[':id'].$get.queryOptions({ input: skipToken })
      expect(o.queryFn).toBe(skipToken)
      expect(o.queryKey).toEqual([['posts', ':id', '$get'], { type: 'query' }])
    })

    it('never touches the network', async () => {
      const spy = spyFetch()
      const qc = newClient()
      const o = makeApi(spy).posts[':id'].$get.queryOptions({ input: skipToken })
      new QueryObserver(qc, o).subscribe(() => {})()
      await Promise.resolve()
      expect(spy).not.toHaveBeenCalled()
    })
  })

  describe('request options & cancellation', () => {
    it('forwards `client` options (headers) to the request', async () => {
      const spy = spyFetch()
      const o = makeApi(spy).health.$get.queryOptions({ client: { headers: { 'x-from': 'options' } } })
      await newClient().fetchQuery(o)
      expect(new Headers(spy.mock.calls[0]![1].headers).get('x-from')).toBe('options')
    })

    it("passes TanStack's AbortSignal to fetch", async () => {
      const spy = spyFetch()
      await newClient().fetchQuery(makeApi(spy).health.$get.queryOptions())
      expect(spy.mock.calls[0]![1].signal).toBeInstanceOf(AbortSignal)
    })

    it('aborting the query aborts the in-flight request and settles as a client error', async () => {
      let received: AbortSignal | undefined
      const fetchImpl = (_: any, init: any) =>
        new Promise<Response>((_res, rej) => {
          received = init.signal
          init.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
        })
      const api = makeApi(fetchImpl)
      const ac = new AbortController()
      const queryFn = api.health.$get.queryOptions().queryFn as any
      const pending = queryFn({ signal: ac.signal }).catch((e: any) => e)
      ac.abort()
      const err = await pending
      expect(received?.aborted).toBe(true)
      expect(err.reason).toBe('abort')
    })

    it('merges a caller-supplied signal with TanStack’s', async () => {
      const spy = spyFetch()
      const mine = new AbortController()
      const theirs = new AbortController()
      const o = makeApi(spy).health.$get.queryOptions({ client: { init: { signal: mine.signal } } })
      await (o.queryFn as any)({ signal: theirs.signal })
      const used: AbortSignal = spy.mock.calls[0]![1].signal
      expect(used.aborted).toBe(false)
      mine.abort()
      expect(used.aborted).toBe(true)
    })

    it('merged signal also follows TanStack’s own abort', async () => {
      const spy = spyFetch()
      const mine = new AbortController()
      const theirs = new AbortController()
      const o = makeApi(spy).health.$get.queryOptions({ client: { init: { signal: mine.signal } } })
      await (o.queryFn as any)({ signal: theirs.signal })
      const used: AbortSignal = spy.mock.calls[0]![1].signal
      theirs.abort()
      expect(used.aborted).toBe(true)
    })

    it('keeps other `init` fields when adding the signal', async () => {
      const spy = spyFetch()
      const o = makeApi(spy).health.$get.queryOptions({ client: { init: { cache: 'no-store' } } })
      await (o.queryFn as any)({ signal: new AbortController().signal })
      expect(spy.mock.calls[0]![1].cache).toBe('no-store')
    })

    it('falls back to the query signal when AbortSignal.any is unavailable', async () => {
      const original = AbortSignal.any
      // @ts-expect-error simulating an older runtime
      AbortSignal.any = undefined
      try {
        const spy = spyFetch()
        const mine = new AbortController()
        const theirs = new AbortController()
        const o = makeApi(spy).health.$get.queryOptions({ client: { init: { signal: mine.signal } } })
        await (o.queryFn as any)({ signal: theirs.signal })
        const used: AbortSignal = spy.mock.calls[0]![1].signal
        theirs.abort()
        expect(used.aborted).toBe(true)
      } finally {
        AbortSignal.any = original
      }
    })

    it('a real AbortSignal.timeout() surfaces as reason "timeout" through the merged signal', async () => {
      const fetchImpl = (_: any, init: any) =>
        new Promise<Response>((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
      const o = makeApi(fetchImpl).health.$get.queryOptions({ client: { init: { signal: AbortSignal.timeout(5) } } })
      const err = await (o.queryFn as any)({ signal: new AbortController().signal }).catch((e: any) => e)
      expect(err.reason).toBe('timeout')
    })

    it('a user-initiated abort surfaces as reason "abort"', async () => {
      const fetchImpl = (_: any, init: any) =>
        new Promise<Response>((_res, rej) => init.signal.addEventListener('abort', () => rej(init.signal.reason)))
      const ac = new AbortController()
      const o = makeApi(fetchImpl).health.$get.queryOptions()
      const pending = (o.queryFn as any)({ signal: ac.signal }).catch((e: any) => e)
      ac.abort()
      expect((await pending).reason).toBe('abort')
    })

    it('does not add a signal when TanStack supplies none', async () => {
      const spy = spyFetch()
      await (makeApi(spy).health.$get.queryOptions().queryFn as any)({})
      expect(spy.mock.calls[0]![1]?.signal).toBeUndefined()
    })
  })
})

describe('infiniteOptions', () => {
  const build = (api = makeApi()) =>
    api.posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    })

  it('fetches pages, threading each pageParam into the input', async () => {
    const spy = spyFetch()
    const qc = newClient()
    const data = await qc.fetchInfiniteQuery({ ...build(makeApi(spy)), pages: 2 })
    expect(data.pages.map((p) => p.items[0]!.title)).toEqual(['page first', 'page abc'])
    expect(data.pageParams).toEqual([undefined, 'abc'])
    expect(urlsOf(spy)[1]).toContain('cursor=abc')
  })

  it('keys under type "infinite" using the initial page input', () => {
    const o = build()
    expect(o.queryKey).toEqual([['posts', '$get'], { type: 'infinite', input: { query: { cursor: undefined } } }])
  })

  it('does not collide with the regular query key of the same endpoint', () => {
    const api = makeApi()
    expect(hashKey(build(api).queryKey)).not.toBe(hashKey(api.posts.$get.queryKey({ input: { query: {} } })))
  })

  it('does not leak `input` or `client` into the returned options', () => {
    const o = build() as any
    expect(o).not.toHaveProperty('input')
    expect(o).not.toHaveProperty('client')
    expect(o.initialPageParam).toBeUndefined()
  })

  it('keeps initialPageParam on the options', () => {
    const o = makeApi().posts.$get.infiniteOptions({
      input: (cursor: string) => ({ query: { cursor } }),
      initialPageParam: 'start',
      getNextPageParam: () => undefined,
    })
    expect(o.initialPageParam).toBe('start')
  })

  it('forwards client options and the abort signal to each page request', async () => {
    const spy = spyFetch()
    const o = makeApi(spy).posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      client: { headers: { 'x-page': '1' } },
    })
    await (o.queryFn as any)({ pageParam: undefined, signal: new AbortController().signal })
    const init = spy.mock.calls[0]![1]
    expect(new Headers(init.headers).get('x-page')).toBe('1')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('supports skipToken', async () => {
    const spy = spyFetch()
    const o = makeApi(spy).posts.$get.infiniteOptions({
      input: skipToken,
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
    })
    expect(o.queryFn).toBe(skipToken)
    expect(o.queryKey).toEqual([['posts', '$get'], { type: 'infinite' }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('select works through an observer', async () => {
    const qc = newClient()
    const o = makeApi().posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
      select: (data) => data.pages.length,
    })
    expect((await new InfiniteQueryObserver(qc, o as any).refetch()).data).toBe(1)
  })

  it('stops when getNextPageParam returns undefined', async () => {
    const data = await newClient().fetchInfiniteQuery({ ...build(), pages: 5 })
    expect(data.pages).toHaveLength(2) // first page + the last page (nextCursor null)
  })
})

describe('mutationOptions', () => {
  it('runs through a MutationObserver and returns the parsed body', async () => {
    const qc = newClient()
    const result = await new MutationObserver(qc, makeApi().posts.$post.mutationOptions()).mutate({ json: { title: 'hi' } })
    expect(result).toEqual({ id: '2', title: 'hi' })
  })

  it('sets a mutation key and tracks in-flight mutations by prefix', async () => {
    const qc = newClient()
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const api = makeApi(async (i, init) => {
      await gate
      return inMemoryFetch(i, init)
    })
    const o = api.posts.$post.mutationOptions()
    expect(o.mutationKey).toEqual(api.posts.$post.mutationKey())
    const pending = new MutationObserver(qc, o).mutate({ json: { title: 'x' } })
    await Promise.resolve()
    expect(qc.isMutating({ mutationKey: api.posts.$key() })).toBe(1)
    expect(qc.isMutating({ mutationKey: api.health.$key() })).toBe(0)
    release()
    await pending
    expect(qc.isMutating({ mutationKey: api.posts.$key() })).toBe(0)
  })

  it('calls onSuccess with data and variables', async () => {
    const onSuccess = vi.fn()
    await new MutationObserver(newClient(), makeApi().posts.$post.mutationOptions({ onSuccess })).mutate({ json: { title: 'ok' } })
    expect(onSuccess.mock.calls[0]![0]).toEqual({ id: '2', title: 'ok' })
    expect(onSuccess.mock.calls[0]![1]).toEqual({ json: { title: 'ok' } })
  })

  it('calls onError with a HonoRPCError carrying the declared body', async () => {
    const onError = vi.fn()
    await new MutationObserver(newClient(), makeApi().posts.$post.mutationOptions({ onError }))
      .mutate({ json: { title: 'dup' } })
      .catch(() => {})
    const error = onError.mock.calls[0]![0]
    expect(error).toBeInstanceOf(HonoRPCError)
    expect([error.status, error.data]).toEqual([409, { code: 'DUPLICATE', existingId: '9' }])
  })

  it('does not leak `client` and passes through other options', () => {
    const o = makeApi().posts.$post.mutationOptions({ retry: 3, meta: { m: 1 }, client: { headers: {} } })
    expect(o).not.toHaveProperty('client')
    expect(o).toMatchObject({ retry: 3, meta: { m: 1 } })
  })

  it('forwards `client` options to the request', async () => {
    const spy = spyFetch()
    const o = makeApi(spy).posts.$post.mutationOptions({ client: { headers: { 'x-m': '1' } } })
    await new MutationObserver(newClient(), o).mutate({ json: { title: 'x' } })
    expect(new Headers(spy.mock.calls[0]![1].headers).get('x-m')).toBe('1')
  })

  it('works without any options and with endpoints whose input is optional', async () => {
    const o = makeApi().health.$get.mutationOptions()
    await expect(new MutationObserver(newClient(), o).mutate(undefined)).resolves.toEqual({ ok: true })
  })

  it('invalidating after a mutation refetches the affected queries', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    const list = api.posts.$get.queryOptions({ input: { query: {} } })
    await qc.fetchQuery(list)
    const before = spy.mock.calls.length
    const observer = new QueryObserver(qc, list)
    const unsub = observer.subscribe(() => {})
    await new MutationObserver(qc, api.posts.$post.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: api.posts.$key() }) })).mutate({
      json: { title: 'z' },
    })
    await vi.waitFor(() => expect(spy.mock.calls.length).toBeGreaterThan(before + 1))
    unsub()
  })
})
