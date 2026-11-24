import { describe, expect, it } from 'vitest'
import { HonoRPCClientError, HonoRPCError, isHonoRPCClientError, isHonoRPCError } from '../src'

describe('HonoRPCError', () => {
  const res = new Response(null, { status: 404, headers: { 'x-trace': 't1' } })
  const err = new HonoRPCError(404, { message: 'nf' }, res)

  it('is an Error carrying status, data and the raw response', () => {
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(HonoRPCError)
    expect(err.name).toBe('HonoRPCError')
    expect(err.message).toBe('Request failed with status 404')
    expect(err.status).toBe(404)
    expect(err.data).toEqual({ message: 'nf' })
    expect(err.response.headers.get('x-trace')).toBe('t1')
  })

  it('has a usable stack trace', () => {
    expect(err.stack).toContain('HonoRPCError')
  })
})

describe('HonoRPCClientError', () => {
  it.each([
    ['network', 'Network request failed'],
    ['abort', 'Request was aborted'],
    ['timeout', 'Request timed out'],
    ['parse', 'Response body could not be parsed'],
  ] as const)('reason %s', (reason, message) => {
    const cause = new TypeError('boom')
    const err = new HonoRPCClientError(reason, cause)
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('HonoRPCClientError')
    expect(err.reason).toBe(reason)
    expect(err.message).toBe(message)
    expect(err.cause).toBe(cause)
  })

  it('is not a HonoRPCError (the two are distinguishable)', () => {
    const client = new HonoRPCClientError('network', undefined)
    expect(client).not.toBeInstanceOf(HonoRPCError)
    expect(new HonoRPCError(500, null, new Response()) instanceof HonoRPCClientError).toBe(false)
  })
})

describe('type guards', () => {
  const http = new HonoRPCError(500, 'x', new Response())
  const client = new HonoRPCClientError('abort', null)

  it('isHonoRPCError', () => {
    expect(isHonoRPCError(http)).toBe(true)
    expect(isHonoRPCError(client)).toBe(false)
    expect(isHonoRPCError(new Error('x'))).toBe(false)
    expect(isHonoRPCError(null)).toBe(false)
    expect(isHonoRPCError('str')).toBe(false)
  })

  it('isHonoRPCClientError', () => {
    expect(isHonoRPCClientError(client)).toBe(true)
    expect(isHonoRPCClientError(http)).toBe(false)
    expect(isHonoRPCClientError(undefined)).toBe(false)
  })
})
