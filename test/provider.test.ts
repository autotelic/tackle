import { describe, expect, it } from 'vitest'
import { isProviderFailure } from '../src/loop/provider.ts'

describe('isProviderFailure', () => {
  it('matches provider, network and auth failures', () => {
    expect(
      isProviderFailure(
        '402: {"type":"server_error","message":"Upstream request failed: Insufficient account funds"}',
      ),
    ).toBe(true)
    expect(isProviderFailure('500: Internal Server Error')).toBe(true)
    expect(isProviderFailure('Rate limit exceeded, try again later')).toBe(true)
    expect(isProviderFailure('model is overloaded')).toBe(true)
    expect(isProviderFailure('fetch failed')).toBe(true)
    expect(isProviderFailure('connect ETIMEDOUT 1.2.3.4:443')).toBe(true)
    expect(isProviderFailure('401 unauthorized')).toBe(true)
  })

  it('never matches loop-caused or agent failures', () => {
    expect(isProviderFailure('turn cap 80 reached')).toBe(false)
    expect(isProviderFailure('session timeout after 30 minutes')).toBe(false)
    expect(isProviderFailure(undefined)).toBe(false)
    expect(isProviderFailure('')).toBe(false)
    expect(isProviderFailure('Cannot read properties of undefined')).toBe(false)
  })
})
