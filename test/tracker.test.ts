import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { hasOpenBlocker, type Issue, workPresent } from '../src/loop/tracker.ts'

describe('hasOpenBlocker', () => {
  const issue = (blockedBy?: Issue['blockedBy']): Issue => ({
    number: 1,
    title: 't',
    body: '',
    ...(blockedBy ? { blockedBy } : {}),
  })

  it('is unblocked with no edges or only closed blockers', () => {
    expect(hasOpenBlocker(issue())).toBe(false)
    expect(hasOpenBlocker(issue({ nodes: [], totalCount: 0 }))).toBe(false)
    expect(hasOpenBlocker(issue({ nodes: [{ number: 2, state: 'CLOSED' }], totalCount: 1 }))).toBe(
      false,
    )
  })

  it('is blocked while any blocker is open', () => {
    expect(
      hasOpenBlocker(
        issue({
          nodes: [
            { number: 2, state: 'CLOSED' },
            { number: 3, state: 'OPEN' },
          ],
          totalCount: 2,
        }),
      ),
    ).toBe(true)
    // No nodes returned (truncated/permission): trust the count.
    expect(hasOpenBlocker(issue({ nodes: [], totalCount: 2 }))).toBe(true)
  })
})

let dir: string | null = null

afterEach(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
  dir = null
})

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

/**
 * A main repo (base) plus a branch worktree with changes: the layout
 * workPresent runs against.
 */
async function setupRepos() {
  dir = await mkdtemp(join(tmpdir(), 'treadle-tracker-'))
  const repoDir = join(dir, 'main')
  const worktreeDir = join(dir, 'wt')
  await mkdir(repoDir, { recursive: true })
  git(repoDir, 'init', '-b', 'main')
  git(repoDir, 'config', 'user.email', 't@t')
  git(repoDir, 'config', 'user.name', 't')
  await mkdir(join(repoDir, 'src'))
  await writeFile(join(repoDir, 'src', 'app.ts'), 'export const x = 1\n')
  await writeFile(join(repoDir, '.treadle-unit.json'), JSON.stringify({ numTotalTests: 3 }))
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'base')
  git(repoDir, 'worktree', 'add', worktreeDir, '-b', 'loop/1')
  return { repoDir, worktreeDir }
}

describe('workPresent', () => {
  it('is absent when the branch changes nothing in changedPaths', async () => {
    const { repoDir, worktreeDir } = await setupRepos()
    const result = await workPresent({
      repoDir,
      worktreeDir,
      baseRef: 'main',
      changedPaths: ['src/**'],
      requireNewTests: true,
      unitReportPath: '.treadle-unit.json',
    })
    expect(result.present).toBe(false)
  })

  it('is present when code changed and the test count grew', async () => {
    const { repoDir, worktreeDir } = await setupRepos()
    await writeFile(join(worktreeDir, 'src', 'items.ts'), 'export const y = 2\n')
    await writeFile(join(worktreeDir, '.treadle-unit.json'), JSON.stringify({ numTotalTests: 5 }))
    git(worktreeDir, 'add', '-A')
    git(worktreeDir, 'commit', '-m', 'work')
    const result = await workPresent({
      repoDir,
      worktreeDir,
      baseRef: 'main',
      changedPaths: ['src/**'],
      requireNewTests: true,
      unitReportPath: '.treadle-unit.json',
    })
    expect(result.present).toBe(true)
    expect(result.detail).toContain('3 → 5')
  })

  it('is absent when the test count did not grow', async () => {
    const { repoDir, worktreeDir } = await setupRepos()
    await writeFile(join(worktreeDir, 'src', 'items.ts'), 'export const y = 2\n')
    await writeFile(join(worktreeDir, '.treadle-unit.json'), JSON.stringify({ numTotalTests: 3 }))
    git(worktreeDir, 'add', '-A')
    git(worktreeDir, 'commit', '-m', 'work')
    const result = await workPresent({
      repoDir,
      worktreeDir,
      baseRef: 'main',
      changedPaths: ['src/**'],
      requireNewTests: true,
      unitReportPath: '.treadle-unit.json',
    })
    expect(result.present).toBe(false)
    expect(result.detail).toContain('did not grow')
  })

  it('ignores test counts when requireNewTests is false', async () => {
    const { repoDir, worktreeDir } = await setupRepos()
    await writeFile(join(worktreeDir, 'src', 'items.ts'), 'export const y = 2\n')
    git(worktreeDir, 'add', '-A')
    git(worktreeDir, 'commit', '-m', 'work')
    const result = await workPresent({
      repoDir,
      worktreeDir,
      baseRef: 'main',
      changedPaths: ['src/**'],
      requireNewTests: false,
      unitReportPath: '.treadle-unit.json',
    })
    expect(result.present).toBe(true)
  })
})
