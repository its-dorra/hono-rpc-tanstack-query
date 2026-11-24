// @vitest-environment jsdom
// Patch Node 24 undici Request to tolerate jsdom-instantiated AbortSignal across realms
const OrigRequest = globalThis.Request
class RealmSafeRequest extends OrigRequest {
  constructor(input: any, init?: any) {
    if (init?.signal) {
      try {
        super(input, init)
        return
      } catch (e: any) {
        if (e.message?.includes('instance of AbortSignal')) {
          const { signal: _signal, ...rest } = init
          super(input, rest)
          return
        }
        throw e
      }
    }
    super(input, init)
  }
}
globalThis.Request = RealmSafeRequest as typeof Request

import {
  QueryClient,
  QueryClientProvider,
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { createElement, Suspense, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HonoRPCClientError, HonoRPCError, isHonoRPCClientError, isHonoRPCError } from '../src'
import { inMemoryFetch, makeApi } from './fixture'

afterEach(cleanup)

const setup = (fetchImpl = vi.fn(inMemoryFetch)) => {
  const api = makeApi(fetchImpl)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client }, createElement(Suspense, { fallback: null }, children))
  return { api, client, wrapper, fetchImpl }
}

describe('useQuery', () => {
  it('loads data', async () => {
    const { api, wrapper } = setup()
    const { result } = renderHook(() => useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '5' } } })), { wrapper })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ id: '5', title: 'hello', views: 3 })
    expect(result.current.error).toBeNull()
  })

  it('exposes a HonoRPCError with typed status/data on a declared error', async () => {
    const { api, wrapper } = setup()
    const { result } = renderHook(() => useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '0' } } })), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const error = result.current.error
    expect(error).toBeInstanceOf(HonoRPCError)
    expect(isHonoRPCError(error) && error.status === 404 && error.data.message).toBe('not found')
  })

  it('exposes a HonoRPCClientError on network failure', async () => {
    const { api, wrapper } = setup(vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))))
    const { result } = renderHook(() => useQuery(api.health.$get.queryOptions()), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(HonoRPCClientError)
    expect(isHonoRPCClientError(result.current.error) && result.current.error.reason).toBe('network')
  })

  it('stays idle with skipToken', async () => {
    const { api, wrapper, fetchImpl } = setup()
    const { result } = renderHook(() => useQuery(api.posts[':id'].$get.queryOptions({ input: skipToken })), { wrapper })
    expect(result.current.fetchStatus).toBe('idle')
    expect(result.current.status).toBe('pending')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('starts fetching once the input becomes available', async () => {
    const { api, wrapper } = setup()
    const { result, rerender } = renderHook(
      ({ id }: { id: string | undefined }) =>
        useQuery(api.posts[':id'].$get.queryOptions({ input: id ? { param: { id } } : skipToken })),
      { wrapper, initialProps: { id: undefined as string | undefined } },
    )
    expect(result.current.fetchStatus).toBe('idle')
    rerender({ id: '9' })
    await waitFor(() => expect(result.current.data?.id).toBe('9'))
  })

  it('refetches when the input changes (separate cache entries)', async () => {
    const { api, wrapper, fetchImpl } = setup()
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } })),
      { wrapper, initialProps: { id: '1' } },
    )
    await waitFor(() => expect(result.current.data?.id).toBe('1'))
    rerender({ id: '2' })
    await waitFor(() => expect(result.current.data?.id).toBe('2'))
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('applies select', async () => {
    const { api, wrapper } = setup()
    const { result } = renderHook(
      () => useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '1' } }, select: (p) => p.views * 2 })),
      { wrapper },
    )
    await waitFor(() => expect(result.current.data).toBe(6))
  })

  it('shares the cache between components using the same options', async () => {
    const { api, wrapper, fetchImpl } = setup()
    const o = () => api.health.$get.queryOptions({ staleTime: 60_000 })
    const a = renderHook(() => useQuery(o()), { wrapper })
    await waitFor(() => expect(a.result.current.isSuccess).toBe(true))
    const b = renderHook(() => useQuery(o()), { wrapper })
    await waitFor(() => expect(b.result.current.isSuccess).toBe(true))
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('useSuspenseQuery', () => {
  it('suspends, then resolves with data', async () => {
    const { api, wrapper } = setup()
    const { result } = renderHook(() => useSuspenseQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '3' } } })), { wrapper })
    await waitFor(() => expect(result.current).toBeTruthy())
    expect(result.current.data).toMatchObject({ id: '3' })
  })
})

describe('useMutation', () => {
  it('mutates, exposes data, and invalidates a query prefix', async () => {
    const { api, wrapper, fetchImpl } = setup()
    const { result } = renderHook(
      () => {
        const qc = useQueryClient()
        const list = useQuery(api.posts.$get.queryOptions({ input: { query: {} } }))
        const create = useMutation(api.posts.$post.mutationOptions({ onSuccess: () => qc.invalidateQueries({ queryKey: api.posts.$key() }) }))
        return { list, create }
      },
      { wrapper },
    )
    await waitFor(() => expect(result.current.list.isSuccess).toBe(true))
    const callsBefore = fetchImpl.mock.calls.length

    await act(async () => {
      await result.current.create.mutateAsync({ json: { title: 'new post' } })
    })

    await waitFor(() => expect(result.current.create.data).toEqual({ id: '2', title: 'new post' }))
    await waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(callsBefore + 1)) // POST + refetch GET
  })

  it('exposes typed route errors via `error` and `onError`', async () => {
    const { api, wrapper } = setup()
    const onError = vi.fn()
    const { result } = renderHook(() => useMutation(api.posts.$post.mutationOptions({ onError })), { wrapper })
    await act(async () => {
      result.current.mutate({ json: { title: 'dup' } })
    })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const err = result.current.error
    expect(isHonoRPCError(err) && err.status === 409 && err.data.code).toBe('DUPLICATE')
    expect(onError.mock.calls[0]![0]).toBe(err)
  })

  it('mutate() needs no argument for optional-input endpoints', async () => {
    const { api, wrapper } = setup()
    const { result } = renderHook(() => useMutation(api.health.$get.mutationOptions()), { wrapper })
    await act(async () => {
      result.current.mutate()
    })
    await waitFor(() => expect(result.current.data).toEqual({ ok: true }))
  })

  it('supports optimistic updates through typed query keys', async () => {
    const { api, wrapper, client } = setup()
    const key = api.posts[':id'].$get.queryKey({ input: { param: { id: '1' } } })
    client.setQueryData(key, { id: '1', title: 'optimistic', views: 0 })
    expect(client.getQueryData(key)?.title).toBe('optimistic')
    const { result } = renderHook(() => useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '1' } }, staleTime: 60_000 })), { wrapper })
    expect(result.current.data?.title).toBe('optimistic')
  })
})

describe('useInfiniteQuery', () => {
  it('pages forward with fetchNextPage and stops at the end', async () => {
    const { api, wrapper } = setup()
    const { result } = renderHook(
      () =>
        useInfiniteQuery(
          api.posts.$get.infiniteOptions({
            input: (cursor: string | undefined) => ({ query: { cursor } }),
            initialPageParam: undefined,
            getNextPageParam: (last) => last.nextCursor ?? undefined,
          }),
        ),
      { wrapper },
    )
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.hasNextPage).toBe(true)

    await act(async () => {
      await result.current.fetchNextPage()
    })
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2))
    expect(result.current.data?.pages.map((p) => p.items[0]!.title)).toEqual(['page first', 'page abc'])
    expect(result.current.hasNextPage).toBe(false)
  })
})
