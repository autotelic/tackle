import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createNightlyBudget } from '../src/loop/nightly.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd }).toString().trim()

let dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

async function makeDir(prefix: string, gitInit = false): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  if (gitInit) {
    git(dir, 'init', '-b', 'main')
    git(dir, 'config', 'user.email', 't@t')
    git(dir, 'config', 'user.name', 't')
    await mkdir(join(dir, 'issues'), { recursive: true })
    await writeFile(join(dir, 'issues', '.gitkeep'), '')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', 'init')
  }
  return dir
}

const config = (dir: string, tracker: 'markdown' | 'github' = 'markdown') =>
  ({
    issues: {
      tracker,
      dir,
      ready: 'ready',
      working: 'working',
      parked: 'parked',
    },
  }) as never

describe('createNightlyBudget', () => {
  it('starts fresh, records passes with costs, and persists across instances', async () => {
    const dir = await makeDir('treadle-nightly-', true)
    const budget = await createNightlyBudget({ config: config(dir), repoDir: dir })
    expect(budget.passes()).toBe(0)
    expect(budget.costUsd()).toBe(0)

    await budget.recordPass(1.25)
    await budget.recordPass(0.75)
    expect(budget.passes()).toBe(2)
    expect(budget.costUsd()).toBeCloseTo(2)

    // A restart (new instance, same file) keeps the count.
    const restarted = await createNightlyBudget({ config: config(dir), repoDir: dir })
    expect(restarted.passes()).toBe(2)
    expect(restarted.costUsd()).toBeCloseTo(2)
  })

  it('commits the budget file on the markdown tracker', async () => {
    const dir = await makeDir('treadle-nightly-', true)
    const budget = await createNightlyBudget({ config: config(dir), repoDir: dir })
    await budget.recordPass(0.5)
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('treadle: nightly budget')
    expect(git(dir, 'status', '--porcelain')).toBe('')
  })

  it('writes clone-local on the github tracker without committing', async () => {
    const dir = await makeDir('treadle-nightly-gh-', true)
    const budget = await createNightlyBudget({ config: config(dir, 'github'), repoDir: dir })
    await budget.recordPass(0.5)
    expect(JSON.parse(await readFile(join(dir, '.treadle', 'nightly.json'), 'utf8'))).toMatchObject(
      { passes: 1, costUsd: 0.5 },
    )
    expect(git(dir, 'log', '--format=%s')).not.toContain('treadle: nightly budget')
  })

  it('rolls over on the first pass of a new day', async () => {
    const dir = await makeDir('treadle-nightly-', true)
    let now = new Date('2026-11-09T23:59:00')
    const budget = await createNightlyBudget({
      config: config(dir),
      repoDir: dir,
      nowFn: () => now,
    })
    await budget.recordPass(3)
    expect(budget.passes()).toBe(1)

    now = new Date('2026-11-10T00:01:00')
    // Reads roll over lazily.
    expect(budget.passes()).toBe(0)
    expect(budget.costUsd()).toBe(0)
    await budget.recordPass(0.5)
    expect(budget.passes()).toBe(1)
  })

  it('treats a stale-dated file as rolled over, and a malformed file as fresh', async () => {
    const dir = await makeDir('treadle-nightly-', true)
    await writeFile(
      join(dir, '.treadle-nightly.json'),
      JSON.stringify({ date: '2020-01-01', passes: 99, costUsd: 99 }),
    )
    const stale = await createNightlyBudget({ config: config(dir), repoDir: dir })
    expect(stale.passes()).toBe(0)

    await writeFile(join(dir, '.treadle-nightly.json'), 'not json')
    const malformed = await createNightlyBudget({ config: config(dir), repoDir: dir })
    expect(malformed.passes()).toBe(0)
  })
})
