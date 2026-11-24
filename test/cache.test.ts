import { QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { HonoRPCError } from '../src'
import { inMemoryFetch, makeApi } from './fixture'

const spyFetch = () => vi.fn(inMemoryFetch)
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const post = (id: string) => ({ param: { id } })
type PostData = { id: string; title: string; views: number }

describe('getData / setData', () => {
  it('getData reads what fetch put in the cache, per input', async () => {
    const api = makeApi()
    const qc = newClient()
    expect(api.posts[':id'].$get.getData(qc, { input: post('1') })).toBeUndefined()
    await api.posts[':id'].$get.fetch(qc, { input: post('1') })
    expect(api.posts[':id'].$get.getData(qc, { input: post('1') })).toMatchObject({ id: '1' })
    expect(api.posts[':id'].$get.getData(qc, { input: post('2') })).toBeUndefined()
  })

  it('works for endpoints without input (no arguments needed)', async () => {
    const api = makeApi()
    const qc = newClient()
    await api.health.$get.fetch(qc)
    expect(api.health.$get.getData(qc)).toEqual({ ok: true })
  })

  it('setData accepts a value and returns the new data', () => {
    const api = makeApi()
    const qc = newClient()
    const value: PostData = { id: '1', title: 'manual', views: 0 }
    expect(api.posts[':id'].$get.setData(qc, { input: post('1'), updater: value })).toEqual(value)
    expect(qc.getQueryData(api.posts[':id'].$get.queryKey({ input: post('1') }))).toEqual(value)
  })

  it('setData accepts an updater that receives the previous value', async () => {
    const api = makeApi()
    const qc = newClient()
    const seen: unknown[] = []
    api.posts[':id'].$get.setData(qc, { input: post('1'), updater: (old) => (seen.push(old), { id: '1', title: 'first', views: 1 }) })
    api.posts[':id'].$get.setData(qc, { input: post('1'), updater: (old) => (seen.push(old), old && { ...old, views: old.views + 1 }) })
    expect(seen[0]).toBeUndefined()
    expect(seen[1]).toMatchObject({ views: 1 })
    expect(api.posts[':id'].$get.getData(qc, { input: post('1') })?.views).toBe(2)
  })

  it('setData works for endpoints without input', () => {
    const api = makeApi()
    const qc = newClient()
    api.health.$get.setData(qc, { updater: { ok: true } })
    expect(api.health.$get.getData(qc)).toEqual({ ok: true })
  })

  it('uses the same cache entry as queryOptions (so hooks see the update)', async () => {
    const api = makeApi()
    const qc = newClient()
    api.posts[':id'].$get.setData(qc, { input: post('1'), updater: { id: '1', title: 'seeded', views: 0 } })
    const data = await qc.fetchQuery(api.posts[':id'].$get.queryOptions({ input: post('1'), staleTime: 60_000 }))
    expect(data.title).toBe('seeded')
  })
})

describe('fetch / prefetch / ensureData', () => {
  it('fetch returns the data and honours options and client options', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const data = await api.posts[':id'].$get.fetch(newClient(), { input: post('9'), client: { headers: { 'x-h': '1' } } })
    expect(data).toMatchObject({ id: '9' })
    expect(new Headers(spy.mock.calls[0]![1].headers).get('x-h')).toBe('1')
  })

  it('fetch rejects with the typed error', async () => {
    const err = await makeApi().posts[':id'].$get.fetch(newClient(), { input: post('0') }).catch((e) => e)
    expect(err).toBeInstanceOf(HonoRPCError)
  })

  it('fetch respects staleTime (second call is served from cache)', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    await api.health.$get.fetch(qc, { staleTime: 60_000 })
    await api.health.$get.fetch(qc, { staleTime: 60_000 })
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('prefetch fills the cache and never throws, even on errors', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    await expect(api.posts[':id'].$get.prefetch(qc, { input: post('3') })).resolves.toBeUndefined()
    expect(api.posts[':id'].$get.getData(qc, { input: post('3') })).toMatchObject({ id: '3' })
    await expect(api.posts[':id'].$get.prefetch(qc, { input: post('0') })).resolves.toBeUndefined()
  })

  it('ensureData returns cached data without fetching, and fetches when missing', async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    const first = await api.posts[':id'].$get.ensureData(qc, { input: post('4') })
    const second = await api.posts[':id'].$get.ensureData(qc, { input: post('4') })
    expect(second).toEqual(first)
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('work for endpoints without input', async () => {
    const api = makeApi()
    const qc = newClient()
    await api.health.$get.prefetch(qc)
    await expect(api.health.$get.ensureData(qc)).resolves.toEqual({ ok: true })
    await expect(api.health.$get.fetch(qc)).resolves.toEqual({ ok: true })
  })
})

describe('cancel', () => {
  it('cancels the in-flight request for exactly this input', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const api = makeApi(async (i, init) => (await gate, inMemoryFetch(i, init)))
    const qc = newClient()
    const a = qc.fetchQuery(api.posts[':id'].$get.queryOptions({ input: post('1') }))
    const b = qc.fetchQuery(api.posts[':id'].$get.queryOptions({ input: post('2') }))
    a.catch(() => {})
    await Promise.resolve()

    await api.posts[':id'].$get.cancel(qc, { input: post('1') })
    expect(qc.getQueryState(api.posts[':id'].$get.queryKey({ input: post('1') }))?.fetchStatus).toBe('idle')
    expect(qc.getQueryState(api.posts[':id'].$get.queryKey({ input: post('2') }))?.fetchStatus).toBe('fetching')

    release()
    await expect(b).resolves.toMatchObject({ id: '2' })
  })

  it('works for endpoints without input', async () => {
    const api = makeApi()
    await expect(api.health.$get.cancel(newClient())).resolves.toBeUndefined()
  })
})

describe('invalidate', () => {
  const seed = async () => {
    const spy = spyFetch()
    const api = makeApi(spy)
    const qc = newClient()
    await api.posts[':id'].$get.fetch(qc, { input: post('1') })
    await api.posts[':id'].$get.fetch(qc, { input: post('2') })
    await api.health.$get.fetch(qc)
    const flag = (key: readonly unknown[]) => qc.getQueryState(key)?.isInvalidated
    return { api, qc, spy, flag }
  }

  it('without options: every input of this endpoint, nothing else', async () => {
    const { api, qc, flag } = await seed()
    await api.posts[':id'].$get.invalidate(qc)
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('1') }))).toBe(true)
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('2') }))).toBe(true)
    expect(flag(api.health.$get.queryKey())).toBe(false)
  })

  it('with input: only that input', async () => {
    const { api, qc, flag } = await seed()
    await api.posts[':id'].$get.invalidate(qc, { input: post('1') })
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('1') }))).toBe(true)
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('2') }))).toBe(false)
  })

  it('with keyType: leaves other query types alone', async () => {
    const { api, qc, flag } = await seed()
    await api.posts[':id'].$get.invalidate(qc, { keyType: 'infinite' })
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('1') }))).toBe(false)
  })

  it('passes QueryClient filters through (refetchType: none does not refetch)', async () => {
    const { api, qc, spy } = await seed()
    const before = spy.mock.calls.length
    await api.posts[':id'].$get.invalidate(qc, { refetchType: 'none' })
    expect(spy.mock.calls.length).toBe(before)
  })

  it('TanStack’s own `type` filter (active/inactive) still works alongside keyType', async () => {
    const { api, qc, flag } = await seed()
    await api.posts[':id'].$get.invalidate(qc, { type: 'active', refetchType: 'none' }) // nothing is observed => no-op
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('1') }))).toBe(false)
    await api.posts[':id'].$get.invalidate(qc, { type: 'inactive', refetchType: 'none' })
    expect(flag(api.posts[':id'].$get.queryKey({ input: post('1') }))).toBe(true)
  })

  it('refetches active queries by default', async () => {
    const { api, qc, spy } = await seed()
    const { QueryObserver } = await import('@tanstack/query-core')
    const observer = new QueryObserver(qc, api.health.$get.queryOptions())
    const stop = observer.subscribe(() => {})
    const before = spy.mock.calls.length
    await api.health.$get.invalidate(qc)
    expect(spy.mock.calls.length).toBeGreaterThan(before)
    stop()
  })
})

describe('node-level $invalidate', () => {
  it('invalidates everything under the node', async () => {
    const api = makeApi()
    const qc = newClient()
    await api.posts[':id'].$get.fetch(qc, { input: post('1') })
    await api.health.$get.fetch(qc)
    await api.posts.$invalidate(qc)
    expect(qc.getQueryState(api.posts[':id'].$get.queryKey({ input: post('1') }))?.isInvalidated).toBe(true)
    expect(qc.getQueryState(api.health.$get.queryKey())?.isInvalidated).toBe(false)
  })

  it('the root node invalidates everything', async () => {
    const api = makeApi()
    const qc = newClient()
    await api.health.$get.fetch(qc)
    await api.$invalidate(qc)
    expect(qc.getQueryState(api.health.$get.queryKey())?.isInvalidated).toBe(true)
  })

  it('supports keyType and QueryClient filters', async () => {
    const api = makeApi()
    const qc = newClient()
    await api.health.$get.fetch(qc)
    await api.$invalidate(qc, { keyType: 'infinite' })
    expect(qc.getQueryState(api.health.$get.queryKey())?.isInvalidated).toBe(false)
    const spy = spyFetch()
    const api2 = makeApi(spy)
    await api2.health.$get.fetch(qc)
    const before = spy.mock.calls.length
    await api2.$invalidate(qc, { refetchType: 'none' })
    expect(spy.mock.calls.length).toBe(before)
  })
})
