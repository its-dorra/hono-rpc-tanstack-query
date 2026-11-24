import { Result } from 'better-result'
import type { SafeResult } from './types'

/**
 * Turn the promise from `safeCall` into a better-result `Result`, keeping the route-typed error.
 *
 * @example
 * const result = await toResult(api.posts[':id'].$get.safeCall({ param: { id } }))
 * result.match({ ok: (post) => post.title, err: (e) => e.message })
 */
export async function toResult<T, E>(promise: PromiseLike<SafeResult<T, E>>): Promise<Result<T, E>> {
  const r = await promise
  return r.ok ? Result.ok(r.data) : Result.err(r.error)
}
