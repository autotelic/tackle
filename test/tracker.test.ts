import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  hasOpenBlocker,
  type Issue,
  normalizeBase,
  parseBaseFromBody,
  resolveBaseRef,
  workPresent,
} from '../src/loop/tracker.ts'

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

describe('parseBaseFromBody', () => {
  it('parses a numeric base as an issue number', () => {
    expect(parseBaseFromBody('Spec here\n\nBase: 3\n')).toBe(3)
    expect(parseBaseFromBody('base: 12')).toBe(12)
  })

  it('parses a named base as a ref', () => {
    expect(parseBaseFromBody('Base: develop\n')).toBe('develop')
    expect(parseBaseFromBody('Base: origin/feature-x\n')).toBe('origin/feature-x')
  })

  it('ignores prose that only mentions a base', () => {
    expect(parseBaseFromBody('The base: develop branch is where this lands.')).toBeUndefined()
    expect(parseBaseFromBody('Base: develop (stacked)')).toBeUndefined()
    expect(parseBaseFromBody('No base line at all.')).toBeUndefined()
  })
})

describe('normalizeBase', () => {
  it('drops a numeric base whose issue is closed', () => {
    const issue: Issue = { number: 2, title: 't', body: '', base: 1 }
    expect(normalizeBase(issue, new Set([1]))).toEqual({ number: 2, title: 't', body: '' })
  })

  it('keeps an open numeric base and any named base', () => {
    expect(normalizeBase({ number: 2, title: 't', body: '', base: 1 }, new Set()).base).toBe(1)
    expect(
      normalizeBase({ number: 2, title: 't', body: '', base: 'develop' }, new Set([1])).base,
    ).toBe('develop')
  })
})

describe('resolveBaseRef', () => {
  const issue = (base?: number | string): Issue => ({
    number: 4,
    title: 't',
    body: '',
    ...(base !== undefined ? { base } : {}),
  })

  it('maps a numeric base to the base issue’s loop/<n> branch', async () => {
    expect(await resolveBaseRef('unused', issue(3))).toEqual({ ref: 'loop/3', name: 'loop/3' })
    expect(await resolveBaseRef('unused', issue('3'))).toEqual({ ref: 'loop/3', name: 'loop/3' })
  })

  it('passes a named base through, stripping origin/ for the PR base name', async () => {
    expect(await resolveBaseRef('unused', issue('develop'))).toEqual({
      ref: 'develop',
      name: 'develop',
    })
    expect(await resolveBaseRef('unused', issue('origin/feature-x'))).toEqual({
      ref: 'origin/feature-x',
      name: 'feature-x',
    })
  })

  it('defaults to the configured integration branch; explicit bases still win', async () => {
    expect(await resolveBaseRef('unused', issue(), 'feature/h2-permissions')).toEqual({
      ref: 'origin/feature/h2-permissions',
      name: 'feature/h2-permissions',
    })
    expect(await resolveBaseRef('unused', issue(3), 'feature/h2-permissions')).toEqual({
      ref: 'loop/3',
      name: 'loop/3',
    })
    expect(await resolveBaseRef('unused', issue('origin/x'), 'feature/h2-permissions')).toEqual({
      ref: 'origin/x',
      name: 'x',
    })
  })

  it('defaults to the repo’s own default branch (origin/HEAD)', async () => {
    dir = await mkdtemp(join(tmpdir(), 'treadle-base-'))
    const bare = join(dir, 'bare')
    const clone = join(dir, 'clone')
    await mkdir(bare, { recursive: true })
    git(bare, 'init', '--bare', '-b', 'develop')
    git(dir, 'clone', bare, 'clone')
    git(clone, 'config', 'user.email', 't@t')
    git(clone, 'config', 'user.name', 't')
    await writeFile(join(clone, 'f'), 'x\n')
    git(clone, 'add', '-A')
    git(clone, 'commit', '-m', 'init')
    git(clone, 'push', 'origin', 'develop')
    expect(await resolveBaseRef(clone, issue())).toEqual({
      ref: 'origin/develop',
      name: 'develop',
    })
  })

  it('falls back to origin/main, then main, without origin/HEAD', async () => {
    dir = await mkdtemp(join(tmpdir(), 'treadle-base-'))
    const repo = join(dir, 'repo')
    const bare = join(dir, 'bare')
    await mkdir(repo, { recursive: true })
    await mkdir(bare, { recursive: true })
    git(bare, 'init', '--bare', '-b', 'main')
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.email', 't@t')
    git(repo, 'config', 'user.name', 't')
    await writeFile(join(repo, 'f'), 'x\n')
    git(repo, 'add', '-A')
    git(repo, 'commit', '-m', 'init')
    expect(await resolveBaseRef(repo, issue())).toEqual({ ref: 'main', name: 'main' })
    // A fetched remote without origin/HEAD: origin/main wins.
    git(repo, 'remote', 'add', 'origin', bare)
    git(repo, 'push', 'origin', 'main')
    git(repo, 'fetch', 'origin')
    expect(await resolveBaseRef(repo, issue())).toEqual({ ref: 'origin/main', name: 'main' })
  })
})

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

  it('prefers the explicit per-issue baseline over the repo-level snapshot', async () => {
    const { repoDir, worktreeDir } = await setupRepos()
    await writeFile(join(worktreeDir, 'src', 'items.ts'), 'export const y = 2\n')
    await writeFile(join(worktreeDir, '.treadle-unit.json'), JSON.stringify({ numTotalTests: 5 }))
    git(worktreeDir, 'add', '-A')
    git(worktreeDir, 'commit', '-m', 'work')
    // The repo-level snapshot says 3; the per-issue baseline says 10 (a
    // branch created when the suite was bigger — e.g. it counts an unmerged
    // sibling's tests). The explicit baseline wins.
    const withBaseline = await workPresent({
      repoDir,
      worktreeDir,
      baseRef: 'main',
      changedPaths: ['src/**'],
      requireNewTests: true,
      unitReportPath: '.treadle-unit.json',
      baseCount: 10,
    })
    expect(withBaseline.present).toBe(false)
    expect(withBaseline.detail).toContain('10 → 5')
    const withGrownBaseline = await workPresent({
      repoDir,
      worktreeDir,
      baseRef: 'main',
      changedPaths: ['src/**'],
      requireNewTests: true,
      unitReportPath: '.treadle-unit.json',
      baseCount: 3,
    })
    expect(withGrownBaseline.present).toBe(true)
  })
})
