import { describe, expect, it } from 'vitest'
import { isProviderFailure, providerStatusCode } from '../src/loop/provider.ts'

describe('providerStatusCode', () => {
  it('reads the leading "NNN:" status the SDK renders', () => {
    expect(providerStatusCode('402: {"type":"server_error"}')).toBe(402)
    expect(providerStatusCode('429: {"error":"rate limited"}')).toBe(429)
    expect(providerStatusCode('Connection error.')).toBeNull()
    expect(providerStatusCode('fetch failed')).toBeNull()
  })
})

describe('isProviderFailure', () => {
  it('classifies leading status codes by table and range, deterministically', () => {
    expect(
      isProviderFailure(
        '402: {"type":"server_error","message":"Upstream request failed: Insufficient account funds"}',
      ),
    ).toBe(true)
    expect(isProviderFailure('500: Internal Server Error')).toBe(true)
    expect(isProviderFailure('429: {"error":"rate limited"}')).toBe(true)
    expect(isProviderFailure('401: unauthorized')).toBe(true)
    expect(isProviderFailure('403: forbidden')).toBe(true)
    expect(isProviderFailure('408: request timeout')).toBe(true)
    // Caller-side 4xx is the request's fault: an issue-budget failure, not a Pause.
    expect(isProviderFailure('400: {"error":"bad request"}')).toBe(false)
    expect(isProviderFailure('404: {"error":"model not found"}')).toBe(false)
    expect(isProviderFailure('422: {"error":"unprocessable"}')).toBe(false)
  })

  it('matches pi APIError class strings exactly', () => {
    // The two most common classes in the 2026-11 forestbuilder logs — both
    // missed by the old prose regexes.
    expect(isProviderFailure('Connection error.')).toBe(true)
    expect(isProviderFailure('Request timed out.')).toBe(true)
  })

  it('matches provider tokens in free-form errors', () => {
    expect(isProviderFailure('Rate limit exceeded, try again later')).toBe(true)
    expect(isProviderFailure('model is overloaded')).toBe(true)
    expect(isProviderFailure('fetch failed')).toBe(true)
    expect(isProviderFailure('connect ETIMEDOUT 1.2.3.4:443')).toBe(true)
    expect(isProviderFailure('401 unauthorized')).toBe(true)
  })

  it('never matches loop-caused or agent failures', () => {
    expect(isProviderFailure('turn cap 80 reached')).toBe(false)
    expect(isProviderFailure('session timeout after 30 minutes')).toBe(false)
    expect(isProviderFailure('This operation was aborted')).toBe(false)
    expect(isProviderFailure(undefined)).toBe(false)
    expect(isProviderFailure('')).toBe(false)
    expect(isProviderFailure('Cannot read properties of undefined')).toBe(false)
  })
})
