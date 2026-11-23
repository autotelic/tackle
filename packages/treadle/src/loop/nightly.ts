/**
 * The durable nightly budget (#18): passes and dollars so far today,
 * persisted after every Pass so a restart can't reset the count — the
 * in-memory counter leaked exactly on tuning days, when restarts are
 * common. Markdown tracker: a file in the synced tracker repo, committed
 * per Pass (ADR-0001: state is written as it happens). GitHub tracker: a
 * clone-local file under .treadle/. Rollover is local midnight; reads roll
 * over lazily so a Loop waiting through midnight resumes with a fresh
 * budget rather than dying on yesterday's.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { LoopConfig } from '../config.ts'
import { commitAndPush } from './markdown-tracker.ts'

export type NightlyBudget = {
  passes: () => number
  costUsd: () => number
  recordPass: (costUsd: number) => Promise<void>
}

type State = { date: string; passes: number; costUsd: number }

export async function createNightlyBudget(options: {
  config: LoopConfig
  repoDir: string
  /** Injectable for tests. */
  nowFn?: () => Date
}): Promise<NightlyBudget> {
  const nowFn = options.nowFn ?? (() => new Date())
  const path =
    options.config.issues.tracker === 'markdown'
      ? join(options.config.issues.dir as string, '.treadle-nightly.json')
      : join(options.repoDir, '.treadle', 'nightly.json')

  const todayKey = () => {
    const now = nowFn()
    const year = now.getFullYear()
    const month = String(now.getMonth() + 1).padStart(2, '0')
    const day = String(now.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  let state: State = { date: todayKey(), passes: 0, costUsd: 0 }
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as Partial<State>
    if (parsed.date === state.date && typeof parsed.passes === 'number') {
      state = { date: parsed.date as string, passes: parsed.passes, costUsd: parsed.costUsd ?? 0 }
    }
    // Any other date: yesterday's budget, rolled over to zero.
  } catch {
    // No file yet: fresh budget.
  }

  /** Reads roll over lazily: a Loop waiting through midnight resumes. */
  const current = () => {
    const today = todayKey()
    if (state.date !== today) state = { date: today, passes: 0, costUsd: 0 }
    return state
  }

  return {
    passes: () => current().passes,
    costUsd: () => current().costUsd,
    recordPass: async (costUsd: number) => {
      const today = current()
      state = { date: today.date, passes: today.passes + 1, costUsd: today.costUsd + costUsd }
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, `${JSON.stringify(state)}\n`)
      if (options.config.issues.tracker === 'markdown') {
        await commitAndPush(options.config.issues.dir as string, 'treadle: nightly budget')
      }
    },
  }
}
