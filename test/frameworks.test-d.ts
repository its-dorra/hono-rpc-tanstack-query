import { createInfiniteQuery as svelteInfinite, createMutation as svelteMutation, createQuery as svelteQuery, skipToken as svelteSkip } from '@tanstack/svelte-query'
import { createInfiniteQuery as solidInfinite, createMutation as solidMutation, createQuery as solidQuery, skipToken as solidSkip } from '@tanstack/solid-query'
import { skipToken as vueSkip, useInfiniteQuery as vueInfinite, useMutation as vueMutation, useQuery as vueQuery } from '@tanstack/vue-query'
import { computed, ref } from 'vue'
import { describe, test } from 'vitest'
import { createHonoQueryUtils, isHonoRPCError, type ErrorOf } from '../src'
import { makeClient } from './fixture'

const client = makeClient()
const api = createHonoQueryUtils(client)

type Post = { id: string; title: string; views: number }
type PostError = ErrorOf<(typeof client.posts)[':id']['$get']>
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
const assert = <_T extends true>() => {}

describe('Vue (@tanstack/vue-query)', () => { test('options, typed error, skipToken, select, mutation, infinite', () => {
  const id = ref('1')
  // reactive input: wrap in computed (vue-query unwraps it)
  const q = vueQuery(computed(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id.value } } })))
  assert<Equal<typeof q.data.value, Post | undefined>>()
  assert<Equal<typeof q.error.value, PostError | null>>()
  const e = q.error.value
  if (isHonoRPCError(e) && e.status === 404) assert<Equal<typeof e.data, { message: string }>>()

  vueQuery(api.health.$get.queryOptions()) // static options
  vueQuery(computed(() => api.posts[':id'].$get.queryOptions({ input: id.value ? { param: { id: id.value } } : vueSkip })))
  const sel = vueQuery(computed(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id.value } }, select: (p) => p.views })))
  assert<Equal<typeof sel.data.value, number | undefined>>()

  const m = vueMutation(api.posts.$post.mutationOptions())
  m.mutate({ json: { title: 'x' } })
  // @ts-expect-error body is typed
  m.mutate({ json: { title: 1 } })
  assert<Equal<typeof m.error.value, ErrorOf<typeof client.posts.$post> | null>>()

  const inf = vueInfinite(api.posts.$get.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: { cursor } }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  }))
  const pages = inf.data.value?.pages
  assert<Equal<typeof pages, { items: { id: string; title: string }[]; nextCursor: string | null }[] | undefined>>()
}) })

describe('Solid (@tanstack/solid-query)', () => { test('options, typed error, skipToken, select, mutation, infinite', () => {
  const id = () => '1' // a Solid accessor
  const q = solidQuery(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id() } } }))
  assert<Equal<typeof q.data, Post | undefined>>()
  assert<Equal<typeof q.error, PostError | null>>()
  const e = q.error
  if (isHonoRPCError(e) && e.status === 404) assert<Equal<typeof e.data, { message: string }>>()

  solidQuery(() => api.posts[':id'].$get.queryOptions({ input: id() ? { param: { id: id() } } : solidSkip }))
  const sel = solidQuery(() => api.posts[':id'].$get.queryOptions({ input: { param: { id: id() } }, select: (p) => p.views }))
  assert<Equal<typeof sel.data, number | undefined>>()

  const m = solidMutation(() => api.posts.$post.mutationOptions())
  m.mutate({ json: { title: 'x' } })
  // @ts-expect-error body is typed
  m.mutate({ json: { title: 1 } })
  assert<Equal<typeof m.error, ErrorOf<typeof client.posts.$post> | null>>()

  solidInfinite(() => api.posts.$get.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: { cursor } }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  }))
}) })

describe('Svelte (@tanstack/svelte-query)', () => { test('options, typed error, skipToken, select, mutation, infinite', () => {
  let id = '1' // a Svelte 5 rune would be `$state('1')`; the options are built inside the thunk so reads are tracked
  const q = svelteQuery(() => api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
  assert<Equal<typeof q.data, Post | undefined>>()
  assert<Equal<typeof q.error, PostError | null>>()
  const e = q.error
  if (isHonoRPCError(e) && e.status === 404) assert<Equal<typeof e.data, { message: string }>>()

  svelteQuery(() => api.posts[':id'].$get.queryOptions({ input: id ? { param: { id } } : svelteSkip }))
  const sel = svelteQuery(() => api.posts[':id'].$get.queryOptions({ input: { param: { id } }, select: (p) => p.views }))
  assert<Equal<typeof sel.data, number | undefined>>()

  const m = svelteMutation(() => api.posts.$post.mutationOptions())
  m.mutate({ json: { title: 'x' } })
  // @ts-expect-error body is typed
  m.mutate({ json: { title: 1 } })
  assert<Equal<typeof m.error, ErrorOf<typeof client.posts.$post> | null>>()

  svelteInfinite(() => api.posts.$get.infiniteOptions({
    input: (cursor: string | undefined) => ({ query: { cursor } }),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  }))
}) })
