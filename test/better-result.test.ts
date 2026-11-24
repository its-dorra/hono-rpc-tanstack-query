import { Result } from 'better-result'
import { describe, expect, it } from 'vitest'
import { createHonoQueryUtils, HonoRPCClientError, HonoRPCError, isHonoRPCError } from '../src'
import { toResult } from '../src/better-result'
import { inMemoryFetch, makeApi, makeClient } from './fixture'

const api = makeApi()

describe('better-result adapter', () => {
  it('wraps success as Ok', async () => {
    const result = await toResult(api.posts[':id'].$get.safeCall({ param: { id: '7' } }))
    expect(Result.isOk(result)).toBe(true)
    expect(result.match({ ok: (p) => p.id, err: () => 'err' })).toBe('7')
  })

  it('wraps failures as Err, keeping the typed error object', async () => {
    const result = await toResult(api.posts[':id'].$get.safeCall({ param: { id: '0' } }))
    expect(Result.isError(result)).toBe(true)
    const error = result.match({ ok: () => undefined, err: (e) => e })
    expect(error).toBeInstanceOf(HonoRPCError)
    expect(isHonoRPCError(error) && error.status).toBe(404)
  })

  it('exposes the standard Result helpers', async () => {
    const result = await toResult(api.posts[':id'].$get.safeCall({ param: { id: '1' } }))
    expect(result.map((p) => p.title).match({ ok: (t) => t, err: () => 'x' })).toBe('hello')
  })

  it('returns a Promise (awaitable)', () => {
    expect(toResult(api.health.$get.safeCall())).toBeInstanceOf(Promise)
  })

  it('accepts any PromiseLike of SafeResult', async () => {
    const ok = await toResult({ then: (res: any) => res({ ok: true, data: 5 }) } as PromiseLike<any>)
    expect(ok.match({ ok: (v) => v, err: () => 0 })).toBe(5)
  })

  it('carries client errors and mapped errors', async () => {
    const offline = makeApi(() => Promise.reject(new TypeError('offline')))
    const r1 = await toResult(offline.health.$get.safeCall())
    expect(r1.match({ ok: () => null, err: (e) => e })).toBeInstanceOf(HonoRPCClientError)

    const mapped = createHonoQueryUtils(makeClient(inMemoryFetch), { mapError: () => 'mapped' as const })
    const r2 = await toResult(mapped.posts[':id'].$get.safeCall({ param: { id: '0' } }))
    expect(r2.match({ ok: () => null, err: (e) => e })).toBe('mapped')
  })
})
