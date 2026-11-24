import { describe, expect, it, vi } from 'vitest'
import { HonoRPCClientError, HonoRPCError } from '../src'
import { inMemoryFetch, makeApi } from './fixture'

const api = makeApi()

/** Runs a promise to rejection and returns the reason, typed loosely for assertions. */
const rejection = async (p: Promise<unknown>) => {
  try {
    await p
  } catch (e) {
    return e as any
  }
  throw new Error('expected promise to reject')
}

describe('call() — successful responses', () => {
  it('parses a JSON body', async () => {
    await expect(api.health.$get.call()).resolves.toEqual({ ok: true })
  })

  it('sends path params', async () => {
    await expect(api.posts[':id'].$get.call({ param: { id: '42' } })).resolves.toEqual({ id: '42', title: 'hello', views: 3 })
  })

  it('sends query params', async () => {
    const res = await api.posts.$get.call({ query: { cursor: 'abc' } })
    expect(res.items[0]!.id).toBe('abc')
    expect(res.nextCursor).toBeNull()
  })

  it('sends a JSON body and accepts 201', async () => {
    await expect(api.posts.$post.call({ json: { title: 'hi' } })).resolves.toEqual({ id: '2', title: 'hi' })
  })

  it('resolves 204 to undefined', async () => {
    await expect(api.posts[':id'].$delete.call({ param: { id: '1' } })).resolves.toBeUndefined()
  })

  it('returns text for non-JSON content types', async () => {
    await expect(api.text.$get.call()).resolves.toBe('hello')
  })

  it('works through deeply nested paths', async () => {
    await expect(api.a.b.c[':x'].$get.call({ param: { x: 'deep' } })).resolves.toEqual({ x: 'deep' })
  })

  it('returns the union of declared success bodies', async () => {
    await expect(api.union.$get.call({ query: {} })).resolves.toEqual({ kind: 'ok' })
    await expect(api.union.$get.call({ query: { created: '1' } })).resolves.toEqual({ kind: 'created', id: 1 })
  })
})

describe('call() — HTTP errors become HonoRPCError', () => {
  it('declared 404 keeps status and parsed JSON body', async () => {
    const err = await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))
    expect(err).toBeInstanceOf(HonoRPCError)
    expect(err.status).toBe(404)
    expect(err.data).toEqual({ message: 'not found' })
  })

  it('declared 409 on a mutation', async () => {
    const err = await rejection(api.posts.$post.call({ json: { title: 'dup' } }))
    expect(err).toBeInstanceOf(HonoRPCError)
    expect([err.status, err.data]).toEqual([409, { code: 'DUPLICATE', existingId: '9' }])
  })

  it('validator rejections surface as 400 with the validator body', async () => {
    const err = await rejection(api.posts.$post.call({ json: { title: '' } }))
    expect(err).toBeInstanceOf(HonoRPCError)
    expect(err.status).toBe(400)
    expect(err.data).toMatchObject({ success: false })
  })

  it('a validator hook returning a typed 400 keeps its body', async () => {
    const err = await rejection(api.checked.$post.call({ json: { n: 'x' as unknown as number } }))
    expect(err).toBeInstanceOf(HonoRPCError)
    expect([err.status, err.data]).toEqual([400, { error: 'invalid', issues: 1 }])
    await expect(api.checked.$post.call({ json: { n: 2 } })).resolves.toEqual({ doubled: 4 })
  })

  it('exposes the raw response (status, headers)', async () => {
    const err = await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))
    expect(err.response).toBeInstanceOf(Response)
    expect(err.response.headers.get('content-type')).toContain('json')
    expect(err.response.status).toBe(404)
  })

  it('keeps the status when the error body claims JSON but is not', async () => {
    const err = await rejection(api['broken-html'].$get.call())
    expect(err).toBeInstanceOf(HonoRPCError)
    expect(err.status).toBe(500)
    expect(err.data).toBe('<html>oops</html>')
  })

  it('gives data === undefined for an empty error body', async () => {
    const err = await rejection(api['empty-500'].$get.call())
    expect(err.status).toBe(500)
    expect(err.data).toBeUndefined()
  })

  it('keeps plain-text error bodies as strings', async () => {
    const err = await rejection(api.teapot.$get.call())
    expect([err.status, err.data]).toEqual([418, 'short and stout'])
  })

  it('resolves 204 to undefined regardless of route', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }))
    await expect(makeApi(fetchImpl).health.$get.call()).resolves.toBeUndefined()
  })

  it('tolerates an unreadable error body without losing the status', async () => {
    const res = new Response('x', { status: 503 })
    vi.spyOn(res, 'text').mockRejectedValue(new Error('stream broke'))
    const err = await rejection(makeApi(async () => res).health.$get.call())
    expect(err).toBeInstanceOf(HonoRPCError)
    expect(err.status).toBe(503)
    expect(err.data).toBeUndefined()
  })
})

describe('call() — failures without a usable response become HonoRPCClientError', () => {
  it('network failure', async () => {
    const cause = new TypeError('Failed to fetch')
    const err = await rejection(makeApi(() => Promise.reject(cause)).health.$get.call())
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('network')
    expect(err.cause).toBe(cause)
  })

  it('abort while sending', async () => {
    const abort = new DOMException('The operation was aborted', 'AbortError')
    const err = await rejection(makeApi(() => Promise.reject(abort)).health.$get.call())
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('abort')
    expect(err.cause).toBe(abort)
  })

  it('timeout while sending is distinguished from abort and network', async () => {
    const timeout = new DOMException('The operation timed out', 'TimeoutError')
    const err = await rejection(makeApi(() => Promise.reject(timeout)).health.$get.call())
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('timeout')
    expect(err.cause).toBe(timeout)
  })

  it('timeout while reading the body', async () => {
    const res = new Response('{}', { headers: { 'content-type': 'application/json' } })
    vi.spyOn(res, 'json').mockRejectedValue(new DOMException('timed out', 'TimeoutError'))
    const err = await rejection(makeApi(async () => res).health.$get.call())
    expect(err.reason).toBe('timeout')
  })

  it('a non-Error rejection is a network failure', async () => {
    const err = await rejection(makeApi(() => Promise.reject('plain string')).health.$get.call())
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('network')
    expect(err.cause).toBe('plain string')
  })

  it('abort while reading the body', async () => {
    const res = new Response('{}', { headers: { 'content-type': 'application/json' } })
    vi.spyOn(res, 'json').mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const err = await rejection(makeApi(async () => res).health.$get.call())
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('abort')
  })

  it('2xx with invalid JSON', async () => {
    const err = await rejection(api['invalid-json'].$get.call())
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('parse')
    expect(err.cause).toBeInstanceOf(SyntaxError)
  })

  it('a synchronous throw from the client call also becomes a client error', async () => {
    const err = await rejection(
      makeApi(() => {
        throw new Error('sync boom')
      }).health.$get.call(),
    )
    expect(err).toBeInstanceOf(HonoRPCClientError)
    expect(err.reason).toBe('network')
    expect(err.cause.message).toBe('sync boom')
  })

  it('never leaks a raw TypeError / DOMException', async () => {
    for (const failure of [new TypeError('x'), new DOMException('y', 'AbortError'), new Error('z')]) {
      const err = await rejection(makeApi(() => Promise.reject(failure)).health.$get.call())
      expect(err).toBeInstanceOf(HonoRPCClientError)
    }
  })
})

describe('call() — request options', () => {
  it('forwards headers given via `options`', async () => {
    await expect(api['echo-headers'].$get.call({ header: { 'x-token': 'from-input' } })).resolves.toEqual({ token: 'from-input' })
  })

  it('merges per-call client headers', async () => {
    const seen = vi.fn(inMemoryFetch)
    const a = makeApi(seen)
    await a.health.$get.call(undefined, { headers: { authorization: 'Bearer t' } })
    const init = seen.mock.calls[0]![1]
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer t')
  })

  it('uses a per-call fetch override instead of the client one', async () => {
    const base = vi.fn(inMemoryFetch)
    const override = vi.fn(async () => Response.json({ ok: true }))
    await makeApi(base).health.$get.call(undefined, { fetch: override as any })
    expect(override).toHaveBeenCalledTimes(1)
    expect(base).not.toHaveBeenCalled()
  })

  it('is lazy: constructing utils and options never hits the network', () => {
    const spy = vi.fn(inMemoryFetch)
    const a = makeApi(spy)
    a.posts[':id'].$get.queryOptions({ input: { param: { id: '1' } } })
    a.posts.$post.mutationOptions()
    a.posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
    })
    expect(spy).not.toHaveBeenCalled()
  })
})
