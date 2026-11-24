import { ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { createHonoQueryUtils, HonoRPCClientError, HonoRPCError, isHonoRPCError } from '../src'
import { toResultAsync } from '../src/neverthrow'
import { inMemoryFetch, makeApi, makeClient } from './fixture'

const api = makeApi()

describe('neverthrow adapter', () => {
  it('wraps success as Ok', async () => {
    const result = await toResultAsync(api.posts[':id'].$get.safeCall({ param: { id: '7' } }))
    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap()).toEqual({ id: '7', title: 'hello', views: 3 })
  })

  it('wraps failures as Err, keeping the typed error object', async () => {
    const result = await toResultAsync(api.posts[':id'].$get.safeCall({ param: { id: '0' } }))
    expect(result.isErr()).toBe(true)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(HonoRPCError)
    expect(isHonoRPCError(error) && error.status).toBe(404)
  })

  it('returns a ResultAsync that supports chaining before awaiting', async () => {
    const title = await toResultAsync(api.posts[':id'].$get.safeCall({ param: { id: '1' } }))
      .map((p) => p.title.toUpperCase())
      .mapErr(() => 'failed')
    expect(title._unsafeUnwrap()).toBe('HELLO')

    const mapped = await toResultAsync(api.posts[':id'].$get.safeCall({ param: { id: '0' } })).mapErr((e) =>
      isHonoRPCError(e) && e.status === 404 ? 'missing' : 'failed',
    )
    expect(mapped._unsafeUnwrapErr()).toBe('missing')
  })

  it('supports match()', async () => {
    const out = await toResultAsync(api.health.$get.safeCall()).match(
      (d) => `ok:${d.ok}`,
      () => 'err',
    )
    expect(out).toBe('ok:true')
  })

  it('returns a real ResultAsync', () => {
    expect(toResultAsync(api.health.$get.safeCall())).toBeInstanceOf(ResultAsync)
  })

  it('accepts any PromiseLike of SafeResult', async () => {
    const r = await toResultAsync(Promise.resolve({ ok: true as const, data: 1 }))
    expect(r._unsafeUnwrap()).toBe(1)
    const e = await toResultAsync({ then: (res: any) => res({ ok: false, error: 'boom' }) } as PromiseLike<any>)
    expect(e._unsafeUnwrapErr()).toBe('boom')
  })

  it('carries client errors too', async () => {
    const offline = makeApi(() => Promise.reject(new TypeError('offline')))
    const r = await toResultAsync(offline.health.$get.safeCall())
    expect(r._unsafeUnwrapErr()).toBeInstanceOf(HonoRPCClientError)
  })

  it('carries mapped errors from mapError', async () => {
    const mapped = createHonoQueryUtils(makeClient(inMemoryFetch), { mapError: () => ({ _tag: 'Mapped' as const }) })
    const r = await toResultAsync(mapped.posts[':id'].$get.safeCall({ param: { id: '0' } }))
    expect(r._unsafeUnwrapErr()).toEqual({ _tag: 'Mapped' })
  })
})
