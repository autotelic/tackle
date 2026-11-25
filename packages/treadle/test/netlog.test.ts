import { describe, expect, it } from 'vitest'
import {
  describeFailure,
  formatFailure,
  installFetchDiagnostics,
  lastFetchFailure,
} from '../src/loop/netlog.ts'

describe('describeFailure', () => {
  it('names a dead pooled socket (ECONNRESET) through the cause chain', () => {
    const socket = Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' })
    const cause = Object.assign(new Error('read ECONNRESET'), {
      code: 'ECONNRESET',
      syscall: 'read',
    })
    const fetchFailed = Object.assign(new TypeError('fetch failed'), { cause })
    void socket
    const failure = describeFailure(
      fetchFailed,
      'https://opencode.ai/inference/go/openai/v1/chat/completions',
    )
    expect(failure.name).toBe('TypeError')
    expect(failure.code).toBe('ECONNRESET')
    expect(failure.syscall).toBe('read')
    expect(formatFailure(failure)).toBe('ECONNRESET read')
  })

  it('names a lost route (ENOTFOUND) with the hostname', () => {
    const cause = Object.assign(new Error('getaddrinfo ENOTFOUND'), {
      code: 'ENOTFOUND',
      syscall: 'getaddrinfo',
      hostname: 'opencode.ai',
    })
    const failure = describeFailure(
      Object.assign(new TypeError('fetch failed'), { cause }),
      'https://x/y',
    )
    expect(formatFailure(failure)).toBe('ENOTFOUND getaddrinfo opencode.ai')
  })

  it('falls back to the message when there is no cause chain', () => {
    const failure = describeFailure(new Error('socket hang up'), 'https://x/y')
    expect(failure.name).toBe('Error')
    expect(failure.message).toBe('socket hang up')
  })
})

describe('installFetchDiagnostics', () => {
  it('records the cause and rethrows, without changing the response', async () => {
    const seen: string[] = []
    installFetchDiagnostics((f) => seen.push(formatFailure(f)))
    const original = globalThis.fetch
    try {
      globalThis.fetch = (async () => {
        const cause = Object.assign(new Error('read ECONNRESET'), {
          code: 'ECONNRESET',
          syscall: 'read',
        })
        throw Object.assign(new TypeError('fetch failed'), { cause })
      }) as unknown as typeof fetch
      // Re-install over this fetch to prove the wrapper is per-process once.
      ;(globalThis.fetch as unknown as { __treadleDiagnostics?: true }).__treadleDiagnostics =
        undefined
      installFetchDiagnostics((f) => seen.push(formatFailure(f)))
      await expect(globalThis.fetch('https://opencode.ai/x')).rejects.toThrow('fetch failed')
      expect(lastFetchFailure()?.code).toBe('ECONNRESET')
    } finally {
      globalThis.fetch = original
    }
  })
})
