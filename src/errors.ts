/**
 * The server answered with a non-2xx status.
 *
 * `status` and `data` are typed from the responses the route declares
 * (`c.json({ message }, 404)`), so narrowing on `status` narrows `data`.
 */
export class HonoRPCError<TStatus extends number = number, TData = unknown> extends Error {
  readonly status: TStatus
  readonly data: TData
  /** The raw response (headers, url, ...). Its body has already been consumed. */
  readonly response: Response

  constructor(status: TStatus, data: TData, response: Response) {
    super(`Request failed with status ${status}`)
    this.name = 'HonoRPCError'
    this.status = status
    this.data = data
    this.response = response
  }
}

export type HonoRPCClientErrorReason =
  /** `fetch` rejected: offline, DNS, CORS, TLS, ... */
  | 'network'
  /** The request was aborted (query cancelled or a caller-supplied signal fired). */
  | 'abort'
  /** An `AbortSignal.timeout()` fired before the request (or its body) completed. */
  | 'timeout'
  /** A 2xx response whose body could not be parsed (e.g. invalid JSON). */
  | 'parse'

/**
 * The request never produced a usable response. Everything that can go wrong
 * outside of an HTTP status is normalised into this class so that the `error`
 * returned by TanStack Query hooks is a closed union:
 * `HonoRPCError<...declared statuses> | HonoRPCClientError`.
 */
export class HonoRPCClientError extends Error {
  readonly reason: HonoRPCClientErrorReason
  /** The original thrown value. */
  override readonly cause: unknown

  constructor(reason: HonoRPCClientErrorReason, cause: unknown) {
    super(
      reason === 'abort'
        ? 'Request was aborted'
        : reason === 'timeout'
          ? 'Request timed out'
          : reason === 'parse'
            ? 'Response body could not be parsed'
            : 'Network request failed',
      { cause },
    )
    this.name = 'HonoRPCClientError'
    this.reason = reason
    this.cause = cause
  }
}

/**
 * Prefer this over `instanceof` when you already hold a typed `error`:
 * it keeps the route's `status` / `data` union intact.
 */
export function isHonoRPCError<E>(error: E): error is Extract<E, HonoRPCError<any, any>> {
  return error instanceof HonoRPCError
}

export function isHonoRPCClientError<E>(error: E): error is Extract<E, HonoRPCClientError> {
  return error instanceof HonoRPCClientError
}
