import {
  skipToken,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query'
import { describe, expectTypeOf, test } from 'vitest'
import {
  HonoRPCClientError,
  HonoRPCError,
  isHonoRPCClientError,
  isHonoRPCError,
  type ErrorOf,
  type InputOf,
  type OutputOf,
  type VariablesOf,
} from '../src'
import { makeApi, makeClient } from './fixture'

const api = makeApi()
const client = makeClient()

/** statuses of the member whose body is `unknown` (the "undeclared" one) */
type UndeclaredStatuses<E> = E extends HonoRPCError<infer S, infer D> ? (unknown extends D ? S : never) : never
declare const qc: ReturnType<typeof useQueryClient>
declare const id: string

type Post = { id: string; title: string; views: number }

describe('output types', () => {
  test('come from the 2xx responses of the route', () => {
    expectTypeOf(useQuery(api.health.$get.queryOptions()).data).toEqualTypeOf<{ ok: true } | undefined>()
    expectTypeOf(useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } })).data).toEqualTypeOf<Post | undefined>()
    expectTypeOf(useQuery(api.text.$get.queryOptions()).data).toEqualTypeOf<string | undefined>()
  })

  test('non-200 success statuses and unions', () => {
    expectTypeOf<OutputOf<typeof client.posts.$post>>().toEqualTypeOf<{ id: string; title: string }>()
    expectTypeOf<OutputOf<typeof client.union.$get>>().toEqualTypeOf<{ kind: 'created'; id: number } | { kind: 'ok' }>()
  })

  test('204 resolves to undefined', () => {
    expectTypeOf<OutputOf<typeof client.posts[':id']['$delete']>>().toEqualTypeOf<undefined>()
  })

  test('error bodies are never part of the output', () => {
    expectTypeOf<OutputOf<typeof client.posts[':id']['$get']>>().toEqualTypeOf<Post>()
  })

  test('call() returns the output', () => {
    expectTypeOf(api.health.$get.call()).resolves.toEqualTypeOf<{ ok: true }>()
  })
})

describe('routes whose middleware declares extra responses', () => {
  type Fn = typeof client.checked.$post

  test('the handler response stays the output even if Hono types its status widely', () => {
    expectTypeOf<OutputOf<Fn>>().toEqualTypeOf<{ doubled: number }>()
  })

  test('no bogus error members are produced from the success response', () => {
    type E = Extract<ErrorOf<Fn>, HonoRPCError<any, any>>
    type DeclaredBodies = E extends HonoRPCError<any, infer D> ? D : never
    // bodies seen across all errors: the declared 400 body and `unknown` for undeclared statuses
    expectTypeOf<DeclaredBodies>().toEqualTypeOf<unknown>()
    type Statuses = UndeclaredStatuses<ErrorOf<Fn>>
    expectTypeOf<400 extends Statuses ? true : false>().toEqualTypeOf<false>() // 400 is declared
    expectTypeOf<500 extends Statuses ? true : false>().toEqualTypeOf<true>()
  })
})

describe('error types — the `error` returned by TanStack Query hooks', () => {
  test('useQuery().error is the route error union or null', () => {
    const { error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    expectTypeOf(error).toEqualTypeOf<ErrorOf<typeof client.posts[':id']['$get']> | null>()
  })

  test('narrowing by status narrows the body (declared statuses)', () => {
    const { error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    if (isHonoRPCError(error)) {
      if (error.status === 404) expectTypeOf(error.data).toEqualTypeOf<{ message: string }>()
    }
  })

  test('narrowing works with plain `instanceof` too', () => {
    const { error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    if (error instanceof HonoRPCError) {
      expectTypeOf(error.status).not.toBeAny()
      expectTypeOf(error.data).not.toBeAny()
      if (error.status === 404) expectTypeOf(error.data).toEqualTypeOf<{ message: string }>()
    }
  })

  test('undeclared statuses stay typed with an unknown body', () => {
    const { error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    if (isHonoRPCError(error) && error.status === 500) {
      expectTypeOf(error.data).toEqualTypeOf<unknown>()
    }
  })

  test('declared statuses are excluded from the undeclared member', () => {
    type E = ErrorOf<typeof client.posts[':id']['$get']>
    type Undeclared = UndeclaredStatuses<E>
    expectTypeOf<404 extends Undeclared ? true : false>().toEqualTypeOf<false>()
    expectTypeOf<500 extends Undeclared ? true : false>().toEqualTypeOf<true>()
    expectTypeOf<502 extends Undeclared ? true : false>().toEqualTypeOf<true>()
    expectTypeOf<200 extends Undeclared ? true : false>().toEqualTypeOf<false>()
  })

  test('several declared statuses on one route narrow independently', () => {
    const e = useMutation(api.posts.$post.mutationOptions()).error
    if (isHonoRPCError(e)) {
      if (e.status === 409) expectTypeOf(e.data).toEqualTypeOf<{ code: 'DUPLICATE'; existingId: string }>()
    }
  })

  test('a validator 400 is only typed when its hook declares it', () => {
    // plain zValidator: the 400 exists at runtime but is not in the route type -> undeclared, body unknown
    const plain = useMutation(api.posts.$post.mutationOptions()).error
    if (isHonoRPCError(plain) && plain.status === 400) expectTypeOf(plain.data).toEqualTypeOf<unknown>()

    // hook returning c.json(..., 400): declared, fully typed
    const hooked = useMutation(api.checked.$post.mutationOptions()).error
    if (isHonoRPCError(hooked) && hooked.status === 400) {
      expectTypeOf(hooked.data).toEqualTypeOf<{ error: 'invalid'; issues: number }>()
    }
  })

  test('client-side failures are part of the union', () => {
    const { error } = useQuery(api.health.$get.queryOptions())
    if (isHonoRPCClientError(error)) {
      expectTypeOf(error).toEqualTypeOf<HonoRPCClientError>()
      expectTypeOf(error.reason).toEqualTypeOf<'network' | 'abort' | 'timeout' | 'parse'>()
      expectTypeOf(error.cause).toEqualTypeOf<unknown>()
    }
  })

  test('routes with no declared errors still type every HTTP error status', () => {
    const { error } = useQuery(api.health.$get.queryOptions())
    if (isHonoRPCError(error)) {
      expectTypeOf(error.data).toEqualTypeOf<unknown>()
      expectTypeOf(error.status).toBeNumber()
    }
  })

  test('the union is closed: nothing but HonoRPCError | HonoRPCClientError', () => {
    const { error } = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    if (error && !isHonoRPCError(error) && !isHonoRPCClientError(error)) {
      expectTypeOf(error).toBeNever()
    }
  })

  test('mutation error / onError / onSettled are typed', () => {
    useMutation(
      api.posts.$post.mutationOptions({
        onError: (error, variables) => {
          expectTypeOf(error).toEqualTypeOf<ErrorOf<typeof client.posts.$post>>()
          expectTypeOf(variables.json.title).toBeString()
        },
        onSettled: (data, error) => {
          expectTypeOf(data).toEqualTypeOf<{ id: string; title: string } | undefined>()
          expectTypeOf(error).toEqualTypeOf<ErrorOf<typeof client.posts.$post> | null>()
        },
      }),
    )
  })

  test('infinite query error is typed', () => {
    const { error } = useInfiniteQuery(
      api.posts.$get.infiniteOptions({
        input: (cursor: string | undefined) => ({ query: { cursor } }),
        initialPageParam: undefined,
        getNextPageParam: () => undefined,
      }),
    )
    expectTypeOf(error).toEqualTypeOf<ErrorOf<typeof client.posts.$get> | null>()
  })

  test('getQueryState().error is typed through the tagged key', () => {
    const state = qc.getQueryState(api.posts[':id'].$get.queryKey({ input: { param: { id } } }))
    expectTypeOf(state?.error).toEqualTypeOf<ErrorOf<typeof client.posts[':id']['$get']> | null | undefined>()
  })

  test('useSuspenseQuery().error is typed', () => {
    const { error } = useSuspenseQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    expectTypeOf(error).toEqualTypeOf<ErrorOf<typeof client.posts[':id']['$get']> | null>()
  })
})

describe('input types', () => {
  test('required when the route needs params / query / json', () => {
    // @ts-expect-error input is required for routes with params
    api.posts[':id'].$get.queryOptions()
    // @ts-expect-error input is required, even as an empty options object
    api.posts[':id'].$get.queryOptions({})
    // @ts-expect-error json body is required
    api.posts.$post.call()
  })

  test('optional when the route has no input', () => {
    api.health.$get.queryOptions()
    api.health.$get.queryOptions({})
    api.health.$get.queryOptions({ staleTime: 1 })
    api.health.$get.call()
    api.health.$get.queryKey()
  })

  test('param / query / json / header are checked', () => {
    // @ts-expect-error wrong param type
    api.posts[':id'].$get.queryOptions({ input: { param: { id: 1 } } })
    // @ts-expect-error missing param
    api.posts[':id'].$get.queryOptions({ input: { param: {} } })
    // @ts-expect-error unknown input section
    api.posts[':id'].$get.queryOptions({ input: { param: { id }, bogus: 1 } })
    // @ts-expect-error wrong json field type
    api.posts.$post.mutationOptions().mutationFn!({ json: { title: 1 } }, {} as any)
    // @ts-expect-error missing required header
    api['echo-headers'].$get.call({ header: {} })
    api['echo-headers'].$get.call({ header: { 'x-token': 't' } })
  })

  test('the same input type is used by call, queryKey and key', () => {
    expectTypeOf(api.posts[':id'].$get.call).parameter(0).toEqualTypeOf<InputOf<typeof client.posts[':id']['$get']>>()
    api.posts[':id'].$get.queryKey({ input: { param: { id } } })
    // @ts-expect-error wrong type in key
    api.posts[':id'].$get.queryKey({ input: { param: { id: 5 } } })
  })

  test('`client` request options are typed', () => {
    api.health.$get.queryOptions({ client: { headers: { a: 'b' } } })
    // @ts-expect-error headers must be strings
    api.health.$get.queryOptions({ client: { headers: { a: 1 } } })
  })
})

describe('mutations', () => {
  test('variables and data are typed', () => {
    const create = useMutation(api.posts.$post.mutationOptions({ onSuccess: (data) => expectTypeOf(data).toEqualTypeOf<{ id: string; title: string }>() }))
    create.mutate({ json: { title: 'x' } })
    // @ts-expect-error body is typed
    create.mutate({ json: { title: 1 } })
    // @ts-expect-error variables are required
    create.mutate()
  })

  test('mutate() needs no arguments when the input is optional', () => {
    const m = useMutation(api.health.$get.mutationOptions())
    m.mutate()
    m.mutate(undefined)
    expectTypeOf<VariablesOf<typeof client.health.$get>>().toEqualTypeOf<{} | void | undefined>()
  })

  test('context type flows from onMutate to onError', () => {
    useMutation(
      api.posts.$post.mutationOptions({
        onMutate: () => ({ previous: 1 }),
        onError: (_e, _v, ctx) => expectTypeOf(ctx).toEqualTypeOf<{ previous: number } | undefined>(),
      }),
    )
  })
})

describe('select', () => {
  test('changes the data type seen by the hook but not the cached type', () => {
    const q = useQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } }, select: (p) => p.views }))
    expectTypeOf(q.data).toEqualTypeOf<number | undefined>()
    expectTypeOf(qc.getQueryData(api.posts[':id'].$get.queryKey({ input: { param: { id } } }))).toEqualTypeOf<Post | undefined>()
  })

  test('select receives the typed output', () => {
    api.posts[':id'].$get.queryOptions({ input: { param: { id } }, select: (p) => expectTypeOf(p).toEqualTypeOf<Post>() })
  })
})

describe('query keys', () => {
  test('are tagged with data and error types', () => {
    const data = qc.getQueryData(api.posts[':id'].$get.queryKey({ input: { param: { id } } }))
    expectTypeOf(data).toEqualTypeOf<Post | undefined>()
  })

  test('setQueryData updater is typed', () => {
    qc.setQueryData(api.posts[':id'].$get.queryKey({ input: { param: { id } } }), (old) => {
      expectTypeOf(old).toEqualTypeOf<Post | undefined>()
      return old && { ...old, views: old.views + 1 }
    })
    // @ts-expect-error wrong shape
    qc.setQueryData(api.posts[':id'].$get.queryKey({ input: { param: { id } } }), { nope: true })
  })

  test('prefix and partial keys are plain QueryKeys usable in filters', () => {
    qc.invalidateQueries({ queryKey: api.$key() })
    qc.invalidateQueries({ queryKey: api.posts.$key({ type: 'query' }) })
    qc.invalidateQueries({ queryKey: api.posts[':id'].$get.key({ type: 'infinite' }) })
    // @ts-expect-error unknown key type
    api.posts.$key({ type: 'nope' })
  })
})

describe('skipToken', () => {
  test('is accepted by useQuery', () => {
    useQuery(api.posts[':id'].$get.queryOptions({ input: id ? { param: { id } } : skipToken }))
    useQuery(api.posts[':id'].$get.queryOptions({ input: skipToken }))
  })

  test('is rejected by useSuspenseQuery, which would otherwise break at runtime', () => {
    useSuspenseQuery(api.posts[':id'].$get.queryOptions({ input: { param: { id } } }))
    // @ts-expect-error skipToken is not allowed with suspense
    useSuspenseQuery(api.posts[':id'].$get.queryOptions({ input: id ? { param: { id } } : skipToken }))
  })

  test('is accepted by infiniteOptions', () => {
    useInfiniteQuery(
      api.posts.$get.infiniteOptions({
        input: id ? (cursor: string | undefined) => ({ query: { cursor } }) : skipToken,
        initialPageParam: undefined,
        getNextPageParam: () => undefined,
      }),
    )
  })
})

describe('infinite queries', () => {
  const opts = () =>
    api.posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last, all, lastParam) => {
        expectTypeOf(last.items[0]!.title).toBeString()
        expectTypeOf(all).toEqualTypeOf<{ items: { id: string; title: string }[]; nextCursor: string | null }[]>()
        expectTypeOf(lastParam).toEqualTypeOf<string | undefined>()
        return last.nextCursor ?? undefined
      },
    })

  test('pages are typed', () => {
    const list = useInfiniteQuery(opts())
    expectTypeOf(list.data?.pages[0]?.nextCursor).toEqualTypeOf<string | null | undefined>()
    expectTypeOf(list.data?.pageParams).toEqualTypeOf<(string | undefined)[] | undefined>()
  })

  test('input receives the page param type and must return a valid endpoint input', () => {
    api.posts.$get.infiniteOptions({
      input: (cursor: string | undefined) => ({ query: { cursor } }),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
    })
    api.posts.$get.infiniteOptions({
      // @ts-expect-error not a valid input for this endpoint
      input: (cursor: string | undefined) => ({ query: { cursor: 1 } }),
      initialPageParam: undefined,
      getNextPageParam: () => undefined,
    })
  })

  test('select reshapes infinite data', () => {
    const list = useInfiniteQuery(
      api.posts.$get.infiniteOptions({
        input: (cursor: string | undefined) => ({ query: { cursor } }),
        initialPageParam: undefined,
        getNextPageParam: () => undefined,
        select: (d) => d.pages.flatMap((p) => p.items),
      }),
    )
    expectTypeOf(list.data).toEqualTypeOf<{ id: string; title: string }[] | undefined>()
  })

  test('tagged infinite key', () => {
    expectTypeOf(qc.getQueryData(opts().queryKey)?.pages).not.toBeAny()
  })
})

describe('public surface', () => {
  test('endpoints are exposed under $get / $post / ...', () => {
    expectTypeOf(api.posts.$get.queryOptions).toBeFunction()
    expectTypeOf(api.posts.$post.mutationOptions).toBeFunction()
    expectTypeOf(api.posts[':id'].$delete.call).toBeFunction()
  })

  test('only methods the route defines exist', () => {
    // @ts-expect-error /health has no $post
    api.health.$post
    // @ts-expect-error /posts has no $delete (only /posts/:id does)
    api.posts.$delete
  })

  test('lowercase accessors, Hono-internal members and unknown routes are not exposed', () => {
    // @ts-expect-error
    api.posts.get
    // @ts-expect-error
    api.posts.$ws
    // @ts-expect-error
    api.nope
    // @ts-expect-error
    api.posts.nope
  })

  test('path segments that look like methods remain navigable', () => {
    expectTypeOf(api.things.get.$get.call).toBeFunction()
    expectTypeOf(api.things.$get.call).toBeFunction()
  })

  test('$key exists on every node', () => {
    expectTypeOf(api.$key).toBeFunction()
    expectTypeOf(api.posts[':id'].$key).toBeFunction()
  })

  test('endpoint helpers are typed per route (no cross-talk)', () => {
    expectTypeOf(api.health.$get.call).returns.resolves.toEqualTypeOf<{ ok: true }>()
    expectTypeOf(api.text.$get.call).returns.resolves.toEqualTypeOf<string>()
  })
})
