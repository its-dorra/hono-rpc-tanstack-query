import { describe, expect, it, vi } from 'vitest'
import { HonoRPCClientError, HonoRPCError } from '../src'
import { inMemoryFetch, makeApi } from './fixture'

const api = makeApi()

describe('safeCall()', () => {
  it('resolves { ok: true, data } on success', async () => {
    await expect(api.posts[':id'].$get.safeCall({ param: { id: '7' } })).resolves.toEqual({
      ok: true,
      data: { id: '7', title: 'hello', views: 3 },
    })
  })

  it('resolves { ok: false, error } with a HonoRPCError instead of rejecting', async () => {
    const result = await api.posts[':id'].$get.safeCall({ param: { id: '0' } })
    expect(result.ok).toBe(false)
    expect(result.error).toBeInstanceOf(HonoRPCError)
    expect((result.error as HonoRPCError).status).toBe(404)
    expect(result.data).toBeUndefined()
  })

  it('resolves with a HonoRPCClientError for network failures', async () => {
    const result = await makeApi(() => Promise.reject(new TypeError('offline'))).health.$get.safeCall()
    expect(result.ok).toBe(false)
    expect(result.error).toBeInstanceOf(HonoRPCClientError)
  })

  it('never rejects, whatever fails', async () => {
    const failures = [() => Promise.reject(new Error('x')), () => Promise.reject('str'), () => { throw new Error('sync') }]
    for (const f of failures) await expect(makeApi(f as any).health.$get.safeCall()).resolves.toMatchObject({ ok: false })
  })

  it('supports go-style destructuring', async () => {
    const { data, error } = await api.health.$get.safeCall()
    expect(data).toEqual({ ok: true })
    expect(error).toBeUndefined()
  })

  it('works for 204 and for optional-input endpoints', async () => {
    await expect(api.posts[':id'].$delete.safeCall({ param: { id: '1' } })).resolves.toEqual({ ok: true, data: undefined })
    await expect(api.health.$get.safeCall()).resolves.toMatchObject({ ok: true })
  })

  it('forwards per-call request options', async () => {
    const spy = vi.fn(inMemoryFetch)
    await makeApi(spy).health.$get.safeCall(undefined, { headers: { 'x-a': '1' } })
    expect(new Headers(spy.mock.calls[0]![1].headers).get('x-a')).toBe('1')
  })
})
