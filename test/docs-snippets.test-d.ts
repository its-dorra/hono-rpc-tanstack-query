// Every snippet here mirrors a code block in README.md. If the API changes and the README does not, this file stops compiling.
import type { QueryClient } from '@tanstack/query-core'
import { skipToken, useInfiniteQuery, useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { test } from 'vitest'
import {
  createHonoQueryUtils,
  HonoRPCClientError,
  HonoRPCError,
  isHonoRPCError,
  type CallContext,
  type ErrorOf,
  type OutputOf,
} from '../src'
import { toResult } from '../src/better-result'
import { toResultAsync } from '../src/neverthrow'
import { makeApi, makeClient } from './fixture'

const client = makeClient()
const api = makeApi()
declare const queryClient: QueryClient
declare const id: string

test('Quick start and Errors', () => {
  const { data, error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
  void data?.title
  if (error instanceof HonoRPCError) {
    if (error.status === 404) error.data.message
    else error.data
  } else if (error) {
    error.reason
  }
  const create = useMutation(api.posts.$post.mutationOptions({ onSuccess: () => api.posts.$invalidate(queryClient) }))
  create.mutate({ json: { title: 'Hello' } })
})

test('Queries', () => {
  useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
  useQuery(api.health.$get.queryOptions())
  useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } }, staleTime: 30_000 }))
  useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } }, select: (p) => p.title }))
  useSuspenseQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
  useQuery(api.posts[':id'].$get.queryOptions({ input: id ? { param: { id } } : skipToken }))
})

test('Mutations', () => {
  const create = useMutation(
    api.posts.$post.mutationOptions({
      onSuccess: (post) => void post.id,
      onError: (error) => void error,
    }),
  )
  create.mutate({ json: { title: 'Hello' } })
})

test('Infinite queries', () => {
  useInfiniteQuery(
    api.posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  )
})

test('safeCall and Result libraries', async () => {
  const { data, error } = await api.posts[':id'].$get.safeCall({ param: { id } })
  void data
  void error
  const result = await api.posts[':id'].$get.safeCall({ param: { id } })
  if (result.ok) result.data.title
  else result.error

  await toResultAsync(api.posts[':id'].$get.safeCall({ param: { id } }))
    .map((post) => post.title)
    .mapErr((e) => (isHonoRPCError(e) && e.status === 404 ? 'missing' : 'failed'))

  const r = await toResult(api.posts[':id'].$get.safeCall({ param: { id } }))
  r.match({ ok: (post) => post.title, err: (e) => e.message })
})

test('Mapping errors', () => {
  type AppError = { _tag: 'NotFound' | 'Offline' | 'Unknown' }
  const mapped = createHonoQueryUtils(client, {
    mapError: (error, { route, method }): AppError => {
      void route
      void method
      if (error instanceof HonoRPCClientError) return { _tag: 'Offline' }
      return error.status === 404 ? { _tag: 'NotFound' } : { _tag: 'Unknown' }
    },
  })
  useQuery(mapped.posts[':id'].$get.queryOptions({ input: { param: { id } } })).error satisfies AppError | null
})

test('Default options and Retries', () => {
  createHonoQueryUtils(client, {
    defaults: {
      client: (ctx: CallContext) => ({ headers: { 'x-route': ctx.route.join('/') } }),
      query: { staleTime: 30_000, gcTime: 5 * 60_000 },
      mutation: { retry: 0 },
    },
  })
  createHonoQueryUtils(client, {
    defaults: {
      query: {
        retry: (count, error) => !(error instanceof HonoRPCError && error.status < 500) && count < 3,
        retryDelay: (count, error) =>
          error instanceof HonoRPCError && error.status === 429
            ? Number(error.response.headers.get('retry-after') ?? 1) * 1000
            : Math.min(1000 * 2 ** count, 30_000),
      },
    },
  })
})

test('Keys', () => {
  api.posts[':id'].$get.queryKey({ input: { param: { id } } })
  api.posts[':id'].$get.key()
  api.posts.$key()
  api.$key()
})

test('Cache helpers', async () => {
  const post = api.posts[':id'].$get
  const input = { param: { id } }
  post.getData(queryClient, { input })
  post.setData(queryClient, { input, updater: (old) => old && { ...old, views: old.views + 1 } })
  await post.cancel(queryClient, { input })
  await post.invalidate(queryClient, { input })
  await post.invalidate(queryClient)
  await post.fetch(queryClient, { input, staleTime: 10_000 })
  await post.prefetch(queryClient, { input })
  await post.ensureData(queryClient, { input })
  await api.posts.$invalidate(queryClient)
  await post.invalidate(queryClient, { keyType: 'query', type: 'active', refetchType: 'none' })
})

test('Cache helpers: optimistic update', () => {
  useMutation({
    mutationFn: (input: { param: { id: string } }) => api.posts[':id'].$delete.call(input),
    onMutate: async (input) => {
      await api.posts.$get.cancel(queryClient, { input: { query: {} } })
      const previous = api.posts.$get.getData(queryClient, { input: { query: {} } })
      api.posts.$get.setData(queryClient, {
        input: { query: {} },
        updater: (old) => old && { ...old, items: old.items.filter((p) => p.id !== input.param.id) },
      })
      return { previous }
    },
    onError: (_e, _input, context) => {
      if (context?.previous) api.posts.$get.setData(queryClient, { input: { query: {} }, updater: context.previous })
    },
    onSettled: () => api.posts.$invalidate(queryClient),
  })
})

test('URLs, cancellation and exports', () => {
  api.posts[':id'].$url({ param: { id: '1' } })
  api.posts[':id'].$path({ param: { id: '1' } })
  useQuery(api.health.$get.queryOptions({ client: { init: { signal: AbortSignal.timeout(10_000) } } }))
  const out: OutputOf<typeof client.posts.$get> = { items: [], nextCursor: null }
  const err: ErrorOf<typeof client.posts.$get> | undefined = undefined
  void out
  void err
})
