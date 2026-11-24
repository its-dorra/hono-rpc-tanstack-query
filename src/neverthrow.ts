import { err, ok, ResultAsync } from 'neverthrow'
import type { SafeResult } from './types'

/**
 * Turn the promise from `safeCall` into a neverthrow `ResultAsync`, keeping the route-typed error.
 *
 * @example
 * const result = await toResultAsync(api.posts[':id'].$get.safeCall({ param: { id } }))
 *   .map((post) => post.title)
 *   .mapErr((e) => (isHonoRPCError(e) && e.status === 404 ? 'missing' : 'failed'))
 */
export function toResultAsync<T, E>(promise: PromiseLike<SafeResult<T, E>>): ResultAsync<T, E> {
  return new ResultAsync(Promise.resolve(promise).then((r) => (r.ok ? ok<T, E>(r.data) : err<T, E>(r.error))))
}
