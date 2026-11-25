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
  it('exits at once when a session dies before its first turn (dead pool, not an outage)', async () => {
    const notifications: string[] = []
    const exits: number[] = []
    let runs = 0
    await Effect.runPromise(
      sessionWithPause({
        run: async () => {
          runs += 1
          // Zero turns, 300ms: the request never left the process.
          return { ...providerOutcome('Connection error.'), turns: 0, durationMs: 300 }
        },
        notify: async (text) => {
          notifications.push(text)
        },
        issue: 21,
        sleepFn: immediate,
        exitFn: (code) => {
          exits.push(code)
        },
      }),
    )
    expect(runs).toBe(1) // no ladder at all
    expect(exits).toEqual([255])
    expect(notifications.some((n) => n.includes('connection pool is dead'))).toBe(true)
  })

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

describe('checkpoint scratch resolution', () => {
  it('a branch differing only on PROGRESS.md replays onto the remote tip instead of parking', async () => {
    const { execFileSync } = await import('node:child_process')
    const { mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const { rebaseResolvingScratch } = await import('../src/loop/rebase.ts')
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
        .toString()
        .trim()

    const dir = await mkdtemp(join(tmpdir(), 'treadle-scratch-'))
    try {
      git(dir, 'init', '-b', 'main')
      git(dir, 'config', 'user.email', 't@t')
      git(dir, 'config', 'user.name', 't')
      await writeFile(join(dir, 'code.ts'), 'export const x = 1\n')
      await writeFile(join(dir, 'PROGRESS.md'), 'base note\n')
      git(dir, 'add', '-A')
      git(dir, 'commit', '-m', 'base')
      git(dir, 'checkout', '-b', 'loop/1')
      // The remote side moves the note.
      git(dir, 'checkout', 'main')
      await writeFile(join(dir, 'PROGRESS.md'), 'remote note\n')
      git(dir, 'commit', '-am', 'remote note')
      git(dir, 'checkout', 'loop/1')
      // The branch moves the note and adds code.
      await writeFile(join(dir, 'PROGRESS.md'), 'branch note\n')
      await writeFile(join(dir, 'more.ts'), 'export const y = 2\n')
      git(dir, 'add', '-A')
      git(dir, 'commit', '-m', 'branch note + code')

      await rebaseResolvingScratch(dir, 'main')
      // The code landed; the scratch file did not fight over its content.
      expect(git(dir, 'log', '--oneline', 'main..HEAD')).toContain('branch note + code')
      expect(git(dir, 'show', 'HEAD:more.ts')).toBe('export const y = 2')
      expect(() => git(dir, 'status', '--porcelain')).not.toThrow()
      expect(git(dir, 'status', '--porcelain')).toBe('')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
