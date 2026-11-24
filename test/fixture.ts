import { zValidator } from '@hono/zod-validator'
import { Hono } from 'hono'
import { hc } from 'hono/client'
import { z } from 'zod'
import { createHonoQueryUtils } from '../src'

export const app = new Hono()
  .get('/health', (c) => c.json({ ok: true as const }))
  .get('/text', (c) => c.text('hello'))
  .get(
    '/posts',
    zValidator('query', z.object({ cursor: z.string().optional(), limit: z.string().optional() })),
    (c) => {
      const cursor = c.req.query('cursor')
      return c.json({
        items: [{ id: cursor ?? '1', title: `page ${cursor ?? 'first'}` }],
        nextCursor: (cursor ? null : 'abc') as string | null,
      })
    },
  )
  .post(
    '/posts',
    zValidator('json', z.object({ title: z.string().min(1) })),
    (c) => {
      const { title } = c.req.valid('json')
      if (title === 'dup') return c.json({ code: 'DUPLICATE' as const, existingId: '9' }, 409)
      return c.json({ id: '2', title }, 201)
    },
  )
  .get('/posts/:id', zValidator('param', z.object({ id: z.string() })), (c) => {
    const id = c.req.param('id')
    if (id === '0') return c.json({ message: 'not found' }, 404)
    return c.json({ id, title: 'hello', views: 3 }, 200)
  })
  .delete('/posts/:id', zValidator('param', z.object({ id: z.string() })), (c) => c.body(null, 204))
  // validator with a hook that returns a typed 400: this one *is* declared in the route type
  .post(
    '/checked',
    zValidator('json', z.object({ n: z.number() }), (result, c) => {
      if (!result.success) return c.json({ error: 'invalid' as const, issues: result.error.issues.length }, 400)
    }),
    (c) => c.json({ doubled: c.req.valid('json').n * 2 }),
  )
  .get('/echo-headers', zValidator('header', z.object({ 'x-token': z.string() })), (c) =>
    c.json({ token: c.req.valid('header')['x-token'] }),
  )
  .get('/union', (c) => (c.req.query('created') ? c.json({ kind: 'created' as const, id: 1 }, 201) : c.json({ kind: 'ok' as const }, 200)))
  .get('/a/b/c/:x', (c) => c.json({ x: c.req.param('x') }))
  // a path segment that happens to be called "get" / "post"
  .get('/things/get', (c) => c.json({ segment: true }))
  .get('/things', (c) => c.json({ list: true }))
  // misbehaving responses, as real servers / proxies produce them
  .get('/invalid-json', () => new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } }))
  .get('/broken-html', () => new Response('<html>oops</html>', { status: 500, headers: { 'content-type': 'application/json' } }))
  .get('/empty-500', () => new Response(null, { status: 500 }))
  .get('/teapot', () => new Response('short and stout', { status: 418, headers: { 'content-type': 'text/plain' } }))

export type AppType = typeof app

export type FetchLike = (input: any, init?: any) => Promise<Response>

/** Routes requests straight into the Hono app, no network. */
export const inMemoryFetch: FetchLike = (input, init) => Promise.resolve(app.request(input, init))

export const makeClient = (fetchImpl: FetchLike = inMemoryFetch) =>
  hc<AppType>('http://localhost', { fetch: fetchImpl as typeof fetch })

export const makeApi = (fetchImpl?: FetchLike) => createHonoQueryUtils(makeClient(fetchImpl))
