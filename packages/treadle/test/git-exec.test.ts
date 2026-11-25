import { describe, expect, it } from 'vitest'
import { ghRetry, isTransientGhFailure } from '../src/loop/git-exec.ts'

const gateway = Object.assign(
  new Error('Command failed: gh pr ready loop/13\nAPI call failed: 502 Bad Gateway'),
  { stderr: '502 Bad Gateway' },
)

describe('isTransientGhFailure', () => {
  it('reads gateway pages, 5xx, resets and timeouts as transient', () => {
    expect(isTransientGhFailure(gateway)).toBe(true)
    expect(isTransientGhFailure(new Error('HTTP 503: Service Unavailable'))).toBe(true)
    expect(isTransientGhFailure(new Error('read ECONNRESET'))).toBe(true)
    expect(
      isTransientGhFailure(new Error('dial tcp: lookup api.github.com: could not resolve host')),
    ).toBe(true)
  })

  it('does not retry an answer from GitHub', () => {
    expect(isTransientGhFailure(new Error('HTTP 404: Not Found'))).toBe(false)
    expect(isTransientGhFailure(new Error('HTTP 422: Validation Failed'))).toBe(false)
    expect(isTransientGhFailure(new Error('gh: To use GitHub CLI, run: gh auth login'))).toBe(false)
  })
})

describe('ghRetry', () => {
  const noSleep = async (): Promise<void> => {}

  it('retries a transient failure and returns the eventual answer', async () => {
    let calls = 0
    const waits: number[] = []
    const out = await ghRetry('/repo', ['pr', 'ready', 'loop/13'], {
      delaysMs: [1, 2, 3],
      sleep: async (ms) => {
        waits.push(ms)
      },
      run: async () => {
        calls += 1
        if (calls < 3) throw gateway
        return 'ok'
      },
    })
    expect(out).toBe('ok')
    expect(calls).toBe(3)
    expect(waits).toEqual([1, 2])
  })

  it('throws a non-transient failure at once', async () => {
    let calls = 0
    await expect(
      ghRetry('/repo', ['pr', 'list'], {
        delaysMs: [1, 2, 3],
        sleep: noSleep,
        run: async () => {
          calls += 1
          throw new Error('HTTP 404: Not Found')
        },
      }),
    ).rejects.toThrow('404')
    expect(calls).toBe(1)
  })

  it('gives up after the last delay and throws the last error', async () => {
    let calls = 0
    await expect(
      ghRetry('/repo', ['pr', 'ready'], {
        delaysMs: [1, 2],
        sleep: noSleep,
        run: async () => {
          calls += 1
          throw gateway
        },
      }),
    ).rejects.toThrow('502')
    expect(calls).toBe(3)
  })

  it('passes cwd and args through to gh', async () => {
    const seen: string[][] = []
    await ghRetry('/repo', ['pr', 'create', '--draft'], {
      run: async (cwd, ...args) => {
        seen.push([cwd, ...args])
        return ''
      },
    })
    expect(seen).toEqual([['/repo', 'pr', 'create', '--draft']])
  })
})
