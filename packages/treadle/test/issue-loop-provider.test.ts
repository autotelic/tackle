import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { sessionWithPause } from '../src/loop/issue-loop.ts'

// The provider ladder's terminal state used to Pause and probe in-process; since
// pi's pooled dispatcher rots against providers that cap connection lifetime
// (both collab-loop episodes healed only by restart), it now exits the process.
// These tests pin that: the ladder's shape, and the exit.

const providerOutcome = (text: string) => ({
  terminal: 'failed' as const,
  reason: text,
  turns: 1,
  durationMs: 1,
  logPath: '',
  lastAssistantText: null,
  costUsd: 0,
  tokens: 0,
})

const healthyOutcome = {
  terminal: 'completed' as const,
  reason: undefined,
  turns: 2,
  durationMs: 2,
  logPath: '',
  lastAssistantText: 'done',
  costUsd: 0,
  tokens: 0,
}

const immediate = () => Effect.void

describe('sessionWithPause', () => {
  it('retries the ladder, then exits the process instead of probing in-process', async () => {
    const notifications: string[] = []
    const runs: number[] = []
    const exits: number[] = []
    // Three provider failures exhaust the ladder (1, 5, 15); the fourth run succeeds
    // only because the exit stops the loop first — the recorder answers every run
    // with a provider failure, and exitFn cuts the sequence.
    await Effect.runPromise(
      sessionWithPause({
        run: async () => {
          runs.push(runs.length)
          return providerOutcome('Connection error.')
        },
        notify: async (text) => {
          notifications.push(text)
        },
        issue: 14,
        sleepFn: immediate,
        exitFn: (code) => {
          exits.push(code)
        },
      }),
    )
    expect(runs).toHaveLength(4) // initial + 3 ladder retries
    expect(exits).toEqual([255])
    expect(notifications.some((n) => n.includes('Treadle EXITING'))).toBe(true)
    expect(notifications.some((n) => n.includes('Retrying the Pass in 15 min'))).toBe(true)
  })

  it('a non-provider outcome reaches the caller without exiting', async () => {
    const exits: number[] = []
    const outcome = await Effect.runPromise(
      sessionWithPause({
        run: async () => healthyOutcome,
        notify: async () => {},
        issue: 14,
        sleepFn: immediate,
        exitFn: (code) => {
          exits.push(code)
        },
      }),
    )
    expect(outcome.terminal).toBe('completed')
    expect(exits).toEqual([])
  })
})
