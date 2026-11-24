import { hc } from 'hono/client'
import { describe, expect, it, vi } from 'vitest'
import { createHonoQueryUtils } from '../src'
import { app, inMemoryFetch, makeClient } from './fixture'

describe('$url / $path', () => {
  const spy = vi.fn(inMemoryFetch)
  const api = createHonoQueryUtils(hc<typeof app>('http://localhost:3000/api', { fetch: spy as any }))

  it('$url builds the same URL as the Hono client, with params and query', () => {
    expect(String(api.posts[':id'].$url({ param: { id: '42' } }))).toBe('http://localhost:3000/api/posts/42')
    expect(String(api.posts.$url({ query: { cursor: 'a b' } }))).toBe('http://localhost:3000/api/posts?cursor=a+b')
    expect(String(api.health.$url())).toBe('http://localhost:3000/api/health')
  })

  it('returns a real URL object', () => {
    expect(api.posts[':id'].$url({ param: { id: '1' } })).toBeInstanceOf(URL)
  })

  it('$path builds the route path (params and query), without the base URL', () => {
    expect(api.posts[':id'].$path({ param: { id: '42' } })).toBe('/posts/42')
    expect(api.posts.$path({ query: { cursor: 'x' } })).toBe('/posts?cursor=x')
  })

  it('matches the underlying client exactly', () => {
    const client = hc<typeof app>('http://localhost:3000/api')
    expect(String(api.posts[':id'].$url({ param: { id: '7' } }))).toBe(String(client.posts[':id'].$url({ param: { id: '7' } })))
    expect(api.posts[':id'].$path({ param: { id: '7' } })).toBe(client.posts[':id'].$path({ param: { id: '7' } }))
  })

  it('never makes a request', () => {
    api.posts[':id'].$url({ param: { id: '1' } })
    api.posts[':id'].$path({ param: { id: '1' } })
    expect(spy).not.toHaveBeenCalled()
  })

  it('is stable (cached) like every other node member', () => {
    expect(api.posts.$url).toBe(api.posts.$url)
    expect(api.posts.$path).toBe(api.posts.$path)
  })

  it('works on deep nodes', () => {
    expect(api.a.b.c[':x'].$path({ param: { x: 'deep' } })).toBe('/a/b/c/deep')
  })

  it('$path also works with a relative base URL (where Hono’s $url cannot)', () => {
    const rel = createHonoQueryUtils(hc<typeof app>('/api', { fetch: inMemoryFetch as any }))
    expect(rel.posts[':id'].$path({ param: { id: '1' } })).toBe('/posts/1')
    expect(() => rel.posts[':id'].$url({ param: { id: '1' } })).toThrow()
  })

  it('does not expose $ws', () => {
    expect((api.posts as any).$ws).toBeUndefined()
  })
})
