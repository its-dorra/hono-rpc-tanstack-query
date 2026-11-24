import { QueryClient, skipToken, useInfiniteQuery, useMutation, useQuery } from '@tanstack/vue-query'
import { computed, effectScope, ref } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHonoQueryUtils, HonoRPCClientError, HonoRPCError, isHonoRPCError } from '../src'
import { inMemoryFetch, makeClient } from './fixture'

const scopes: Array<ReturnType<typeof effectScope>> = []
afterEach(() => scopes.splice(0).forEach((s) => s.stop()))

/** Run composables inside an effect scope, the way a Vue component's setup() would. */
const setup = <T>(factory: (ctx: { api: ReturnType<typeof makeApi>; queryClient: QueryClient }) => T, fetchImpl = vi.fn(inMemoryFetch)) => {
  const api = makeApi(fetchImpl)
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  const scope = effectScope()
  scopes.push(scope)
  return { ...scope.run(() => factory({ api, queryClient }))!, fetchImpl, queryClient, api }
}
const makeApi = (fetchImpl: any) => createHonoQueryUtils(makeClient(fetchImpl))

describe('Vue: reactivity through computed options', () => {
  it('loads data', async () => {
    const { q } = setup(({ api, queryClient }) => ({
      q: useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '5' } } }), queryClient),
    }))
    await vi.waitFor(() => expect(q.isSuccess.value).toBe(true))
    expect(q.data.value).toEqual({ id: '5', title: 'hello', views: 3 })
  })

  it('refetches when a ref used inside a computed options object changes', async () => {
    const id = ref('1')
    const { q, fetchImpl } = setup(({ api, queryClient }) => ({
      q: useQuery(computed(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id.value } } })), queryClient),
    }))
    await vi.waitFor(() => expect(q.data.value?.id).toBe('1'))
    id.value = '2'
    await vi.waitFor(() => expect(q.data.value?.id).toBe('2'))
    expect(fetchImpl).toHaveBeenCalledTimes(2) // separate keys, separate requests
  })

  it('exposes a typed HonoRPCError via `error`', async () => {
    const { q } = setup(({ api, queryClient }) => ({
      q: useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '0' } } }), queryClient),
    }))
    await vi.waitFor(() => expect(q.isError.value).toBe(true))
    const error = q.error.value
    expect(error).toBeInstanceOf(HonoRPCError)
    expect(isHonoRPCError(error) && error.status === 404 && error.data.message).toBe('not found')
  })

  it('exposes HonoRPCClientError for network failures', async () => {
    const { q } = setup(
      ({ api, queryClient }) => ({ q: useQuery(api.health.$get.queryOptions(), queryClient) }),
      vi.fn(() => Promise.reject(new TypeError('offline'))),
    )
    await vi.waitFor(() => expect(q.isError.value).toBe(true))
    expect(q.error.value).toBeInstanceOf(HonoRPCClientError)
  })

  it('skipToken keeps the query idle until the input exists', async () => {
    const id = ref<string | undefined>(undefined)
    const { q, fetchImpl } = setup(({ api, queryClient }) => ({
      q: useQuery(
        computed(() => api.posts[':id'].$get.queryOptions({ input: id.value ? { param: { id: id.value } } : skipToken })),
        queryClient,
      ),
    }))
    expect(q.fetchStatus.value).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
    id.value = '9'
    await vi.waitFor(() => expect(q.data.value?.id).toBe('9'))
  })

  it('applies select', async () => {
    const { q } = setup(({ api, queryClient }) => ({
      q: useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id: '1' } }, select: (p) => p.views * 2 }), queryClient),
    }))
    await vi.waitFor(() => expect(q.data.value).toBe(6))
  })

  it('still forwards staleTime and enabled at runtime even though they are not in the returned type', async () => {
    const { api } = setup(({ api }) => ({ api }))
    const o = api.health.$get.queryOptions({ staleTime: 1234, enabled: false }) as any
    expect(o.staleTime).toBe(1234)
    expect(o.enabled).toBe(false)
    const { q, fetchImpl } = setup(({ api, queryClient }) => ({
      q: useQuery(api.health.$get.queryOptions({ enabled: false }), queryClient),
    }))
    await Promise.resolve()
    expect(q.fetchStatus.value).toBe('idle')
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})

describe('Vue: mutations and infinite queries', () => {
  it('mutates and invalidates a prefix', async () => {
    const { list, create, fetchImpl } = setup(({ api, queryClient }) => ({
      list: useQuery(api.posts.$get.queryOptions({ input: { query: {} } }), queryClient),
      create: useMutation(api.posts.$post.mutationOptions({ onSuccess: () => api.posts.$invalidate(queryClient) }), queryClient),
    }))
    await vi.waitFor(() => expect(list.isSuccess.value).toBe(true))
    const before = fetchImpl.mock.calls.length
    create.mutate({ json: { title: 'new' } })
    await vi.waitFor(() => expect(create.data.value).toEqual({ id: '2', title: 'new' }))
    await vi.waitFor(() => expect(fetchImpl.mock.calls.length).toBeGreaterThan(before + 1))
  })

  it('surfaces typed mutation errors', async () => {
    const { create } = setup(({ api, queryClient }) => ({ create: useMutation(api.posts.$post.mutationOptions(), queryClient) }))
    create.mutate({ json: { title: 'dup' } })
    await vi.waitFor(() => expect(create.isError.value).toBe(true))
    const err = create.error.value
    expect(isHonoRPCError(err) && err.status === 409 && err.data.code).toBe('DUPLICATE')
  })

  it('pages with fetchNextPage', async () => {
    const { list } = setup(({ api, queryClient }) => ({
      list: useInfiniteQuery(
        api.posts.$get.infiniteOptions({
          input: (cursor: string | undefined) => ({ query: { cursor } }),
          initialPageParam: undefined,
          getNextPageParam: (last) => last.nextCursor ?? undefined,
        }),
        queryClient,
      ),
    }))
    await vi.waitFor(() => expect(list.isSuccess.value).toBe(true))
    await list.fetchNextPage()
    await vi.waitFor(() => expect(list.data.value?.pages).toHaveLength(2))
    expect(list.hasNextPage.value).toBe(false)
  })
})
