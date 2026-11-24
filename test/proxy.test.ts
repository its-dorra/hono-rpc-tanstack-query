import { describe, expect, it, vi } from 'vitest'
import { createHonoQueryUtils } from '../src'
import { inMemoryFetch, makeApi, makeClient } from './fixture'

const api = makeApi()

describe('proxy hygiene', () => {
  it('is not thenable, so it can be returned from async functions', async () => {
    const wrapped = async () => api.posts
    const resolved = await wrapped()
    expect(resolved.$key()).toEqual([['posts']])
    expect((api as any).then).toBeUndefined()
    expect((api.posts as any).then).toBeUndefined()
  })

  it('ignores symbol access', () => {
    expect((api as any)[Symbol.iterator]).toBeUndefined()
    expect((api.posts as any)[Symbol.toPrimitive]).toBeUndefined()
  })

  it('does not expose Hono’s websocket / unknown `$` members', () => {
    expect((api.posts as any).$ws).toBeUndefined()
    expect((api.posts as any).$all).toBeUndefined()
    expect((api.posts as any).$whatever).toBeUndefined()
  })

  it('passes `$url` and `$path` through as functions', () => {
    expect(typeof api.posts.$url).toBe('function')
    expect(typeof api.posts.$path).toBe('function')
  })

  it('does not expose lowercase method names as endpoints', async () => {
    // `get` is just a path segment here; calling it would request /posts/get
    expect(typeof (api.posts as any).get.$get.call).toBe('function')
    expect((api.posts as any).get.$get.key()).toEqual([['posts', 'get', '$get']])
  })

  it('path segments named like methods do not clash with real methods', async () => {
    await expect(api.things.$get.call()).resolves.toEqual({ list: true })
    await expect(api.things.get.$get.call()).resolves.toEqual({ segment: true })
  })

  it('exposes every HTTP method accessor', () => {
    const node: any = api.posts
    for (const m of ['$get', '$post', '$put', '$patch', '$delete', '$head', '$options']) {
      expect(typeof node[m].queryOptions).toBe('function')
      expect(node[m].key()).toEqual([['posts', m]])
    }
  })

  it('each endpoint exposes the whole helper surface', () => {
    const ep: any = api.posts.$get
    for (const fn of ['call', 'key', 'queryKey', 'queryOptions', 'infiniteOptions', 'mutationKey', 'mutationOptions']) {
      expect(typeof ep[fn]).toBe('function')
    }
  })

  it('works with a client created from a different base URL / basePath', async () => {
    const seen = vi.fn(inMemoryFetch)
    const a = createHonoQueryUtils(makeClient(seen))
    await a.health.$get.call()
    expect(String(seen.mock.calls[0]![0])).toBe('http://localhost/health')
  })

  it('independent util trees do not share state', () => {
    const a = makeApi()
    const b = makeApi()
    expect(a.posts.$get.queryKey({ input: { query: {} } })).toEqual(b.posts.$get.queryKey({ input: { query: {} } }))
    expect(a.posts).not.toBe(b.posts)
  })

  describe('stable identity (cached nodes)', () => {
    it('returns the same node for the same path', () => {
      expect(api.posts).toBe(api.posts)
      expect(api.posts[':id']).toBe(api.posts[':id'])
      expect(api.a.b.c[':x']).toBe(api.a.b.c[':x'])
    })

    it('returns the same endpoint utils and helper functions', () => {
      expect(api.posts[':id'].$get).toBe(api.posts[':id'].$get)
      expect(api.posts[':id'].$get.queryOptions).toBe(api.posts[':id'].$get.queryOptions)
      expect(api.posts.$key).toBe(api.posts.$key)
    })

    it('different paths and different methods are different nodes', () => {
      expect(api.posts).not.toBe(api.health)
      expect(api.posts.$get).not.toBe(api.posts.$post)
      expect(api.posts[':id'].$get).not.toBe(api.posts.$get)
    })

    it('does not grow on repeated access', () => {
      const first = api.posts[':id'].$get
      for (let i = 0; i < 1000; i++) expect(api.posts[':id'].$get).toBe(first)
    })

    it('keeps keys correct when nodes are reused', () => {
      const node = api.posts[':id']
      expect(node.$get.key()).toEqual([['posts', ':id', '$get']])
      expect(node.$delete.key()).toEqual([['posts', ':id', '$delete']])
      expect(api.posts[':id'].$key()).toEqual([['posts', ':id']])
    })
  })
})
