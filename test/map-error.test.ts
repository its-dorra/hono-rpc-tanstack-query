import { MutationObserver, QueryClient } from '@tanstack/query-core'
import { describe, expect, it, vi } from 'vitest'
import { createHonoQueryUtils, HonoRPCClientError, HonoRPCError, type CallContext, type LibraryError } from '../src'
import { inMemoryFetch, makeClient } from './fixture'

/** an app-level error, as you would define with a TaggedError factory */
type AppError = { _tag: 'NotFound' | 'Conflict' | 'Offline' | 'Unknown'; detail?: unknown; route: string }

const toAppError = (error: LibraryError, ctx: CallContext): AppError => {
  const route = `${ctx.method.toUpperCase()} /${ctx.route.join('/')}`
  if (error instanceof HonoRPCClientError) return { _tag: 'Offline', route }
  if (error.status === 404) return { _tag: 'NotFound', detail: error.data, route }
  if (error.status === 409) return { _tag: 'Conflict', detail: error.data, route }
  return { _tag: 'Unknown', route }
}

const make = (fetchImpl: any = inMemoryFetch, mapError = toAppError) => createHonoQueryUtils(makeClient(fetchImpl), { mapError })
const newClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const rejection = async (p: Promise<unknown>) => p.then(() => { throw new Error('expected rejection') }, (e) => e)

describe('mapError', () => {
  it('maps HTTP errors and passes the request context', async () => {
    const api = make()
    expect(await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))).toEqual({
      _tag: 'NotFound',
      detail: { message: 'not found' },
      route: 'GET /posts/:id',
    })
    expect(await rejection(api.posts.$post.call({ json: { title: 'dup' } }))).toMatchObject({ _tag: 'Conflict', route: 'POST /posts' })
  })

  it('maps client errors', async () => {
    const api = make(() => Promise.reject(new TypeError('offline')))
    expect(await rejection(api.health.$get.call())).toEqual({ _tag: 'Offline', route: 'GET /health' })
  })

  it('maps undeclared statuses', async () => {
    expect(await rejection(make().teapot.$get.call())).toMatchObject({ _tag: 'Unknown' })
  })

  it('does not touch successful results', async () => {
    const mapper = vi.fn(toAppError)
    await expect(make(inMemoryFetch, mapper).health.$get.call()).resolves.toEqual({ ok: true })
    expect(mapper).not.toHaveBeenCalled()
  })

  it('is applied by safeCall', async () => {
    const result = await make().posts[':id'].$get.safeCall({ param: { id: '0' } })
    expect(result).toMatchObject({ ok: false, error: { _tag: 'NotFound' } })
  })

  it('is applied to queries (QueryClient state holds the mapped error)', async () => {
    const api = make()
    const qc = newClient()
    await qc.fetchQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '0' } } })).catch(() => {})
    expect(qc.getQueryState(api.posts[':id'].$get.queryKey({ input: { param: { id: '0' } } }))?.error).toMatchObject({ _tag: 'NotFound' })
  })

  it('is applied to mutations', async () => {
    const onError = vi.fn()
    const api = make()
    await new MutationObserver(newClient(), api.posts.$post.mutationOptions({ onError })).mutate({ json: { title: 'dup' } }).catch(() => {})
    expect(onError.mock.calls[0]![0]).toMatchObject({ _tag: 'Conflict' })
  })

  it('receives the original library error classes', async () => {
    const seen: unknown[] = []
    const api = make(inMemoryFetch, (e, ctx) => (seen.push(e), toAppError(e, ctx)))
    await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))
    expect(seen[0]).toBeInstanceOf(HonoRPCError)
  })

  it('may return non-Error values', async () => {
    const api = make(inMemoryFetch, () => 'plain string' as any)
    expect(await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))).toBe('plain string')
  })

  it('a throwing mapper surfaces its own error (bugs are not swallowed)', async () => {
    const api = make(inMemoryFetch, () => { throw new Error('mapper bug') })
    expect((await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))).message).toBe('mapper bug')
  })

  it('is optional: without it errors are the library classes', async () => {
    const api = createHonoQueryUtils(makeClient())
    expect(await rejection(api.posts[':id'].$get.call({ param: { id: '0' } }))).toBeInstanceOf(HonoRPCError)
  })
})
