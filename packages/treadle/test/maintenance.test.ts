import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { type MaintenanceDeps, maintenance } from '../src/maintenance.ts'

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()

let dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

/**
 * A bare origin with develop, a working clone, and loop/1 → loop/2 → loop/3
 * stacked branches, with loop/1 already merged into develop (fast-forward).
 */
async function makeWorld(options?: { loop1Merged?: boolean; watermark?: boolean }) {
  const originDir = await makeDir('treadle-mt-origin-')
  git(originDir, 'init', '--bare', '-b', 'develop')
  const repoDir = await makeDir('treadle-mt-repo-')
  git(repoDir, 'clone', originDir, '.')
  git(repoDir, 'config', 'user.email', 't@t')
  git(repoDir, 'config', 'user.name', 't')
  await writeFile(join(repoDir, 'app.txt'), 'base\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'base')
  git(repoDir, 'push', 'origin', 'develop')

  git(repoDir, 'checkout', '-b', 'loop/1')
  await writeFile(join(repoDir, 'one.txt'), 'one\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'issue 1')
  git(repoDir, 'push', 'origin', 'loop/1')

  if (options?.loop1Merged !== false) {
    git(repoDir, 'checkout', 'develop')
    // --no-ff: a real merge (GitHub squash/merge-commit) puts new SHAs on the
    // default branch, so a dependent's rebase has work to do. A ff merge
    // leaves the base tip SHA identical and the rebase is a correct no-op.
    git(repoDir, 'merge', '--no-ff', '-m', 'merge loop/1', 'loop/1')
    git(repoDir, 'push', 'origin', 'develop')
  }

  git(repoDir, 'checkout', '-b', 'loop/2', 'loop/1')
  await writeFile(join(repoDir, 'two.txt'), 'two\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'issue 2')
  git(repoDir, 'push', 'origin', 'loop/2')

  git(repoDir, 'checkout', '-b', 'loop/3', 'loop/2')
  await writeFile(join(repoDir, 'three.txt'), 'three\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'issue 3')
  git(repoDir, 'push', 'origin', 'loop/3')
  git(repoDir, 'checkout', 'develop')

  const trackerDir = await makeDir('treadle-mt-tracker-')
  await mkdir(join(trackerDir, 'issues'), { recursive: true })
  git(trackerDir, 'init', '-b', 'main')
  git(trackerDir, 'config', 'user.email', 't@t')
  git(trackerDir, 'config', 'user.name', 't')
  if (options?.watermark !== false) {
    // Yesterday: everything the tests do is after the watermark.
    const yesterday = `${new Date(Date.now() - 86_400_000).toISOString()}\n`
    await writeFile(join(trackerDir, '.treadle-maintenance-watermark'), yesterday)
    await mkdir(join(repoDir, '.treadle'), { recursive: true })
    await writeFile(join(repoDir, '.treadle', 'maintenance-watermark'), yesterday)
  }
  return { repoDir, originDir, trackerDir }
}

async function writeIssue(trackerDir: string, name: string, frontmatter: string): Promise<void> {
  await writeFile(join(trackerDir, 'issues', name), `---\n${frontmatter}\n---\n# ${name}\n`)
  git(trackerDir, 'add', '-A')
  git(trackerDir, 'commit', '-m', name)
}

const config = (trackerDir: string, tracker: 'markdown' | 'github' = 'markdown') =>
  ({
    issues: {
      tracker,
      dir: trackerDir,
      ready: 'ready',
      working: 'working',
      parked: 'parked',
    },
  }) as never

function fakeGh(handlers: Record<string, unknown>): {
  deps: MaintenanceDeps
  ghCalls: string[]
} {
  const ghCalls: string[] = []
  const table = { 'pr list --state open': [], ...handlers }
  const prefixes = Object.keys(table).sort((a, b) => b.length - a.length)
  const deps: MaintenanceDeps = {
    ghFn: (async (_repoDir: string, ...args: string[]) => {
      ghCalls.push(args.join(' '))
      return ''
    }) as MaintenanceDeps['ghFn'],
    ghJsonFn: (async (_repoDir: string, ...args: string[]) => {
      const key = args.join(' ')
      for (const prefix of prefixes) {
        if (key.startsWith(prefix)) return table[prefix as keyof typeof table]
      }
      throw new Error(`unexpected ghJson call: ${key}`)
    }) as MaintenanceDeps['ghJsonFn'],
  }
  return { deps, ghCalls }
}

const nowIso = () => new Date().toISOString()

/**
 * The feature-branch-shift world (ADR-0003): a bare origin with develop and
 * an integration branch feature/x at develop's tip, loop/1 branched from
 * feature/x, loop/2 stacked on loop/1 — neither merged.
 */
async function makeShiftWorld() {
  const originDir = await makeDir('treadle-sh-origin-')
  git(originDir, 'init', '--bare', '-b', 'develop')
  const repoDir = await makeDir('treadle-sh-repo-')
  git(repoDir, 'clone', originDir, '.')
  git(repoDir, 'config', 'user.email', 't@t')
  git(repoDir, 'config', 'user.name', 't')
  await writeFile(join(repoDir, 'app.txt'), 'base\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'base')
  git(repoDir, 'push', 'origin', 'develop')
  git(repoDir, 'push', 'origin', 'develop:refs/heads/feature/x')
  git(repoDir, 'fetch', 'origin')

  git(repoDir, 'checkout', '-b', 'loop/1', 'origin/feature/x')
  await writeFile(join(repoDir, 'one.txt'), 'one\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'issue 1')
  git(repoDir, 'push', 'origin', 'loop/1')

  git(repoDir, 'checkout', '-b', 'loop/2', 'loop/1')
  await writeFile(join(repoDir, 'two.txt'), 'two\n')
  git(repoDir, 'add', '-A')
  git(repoDir, 'commit', '-m', 'issue 2')
  git(repoDir, 'push', 'origin', 'loop/2')
  git(repoDir, 'checkout', 'develop')

  const trackerDir = await makeDir('treadle-sh-tracker-')
  await mkdir(join(trackerDir, 'issues'), { recursive: true })
  git(trackerDir, 'init', '-b', 'main')
  git(trackerDir, 'config', 'user.email', 't@t')
  git(trackerDir, 'config', 'user.name', 't')
  // Yesterday: everything the tests do is after the watermark.
  await writeFile(
    join(trackerDir, '.treadle-maintenance-watermark'),
    `${new Date(Date.now() - 86_400_000).toISOString()}\n`,
  )
  return { repoDir, originDir, trackerDir }
}

const shiftConfig = (trackerDir: string) =>
  ({
    issues: {
      tracker: 'markdown',
      dir: trackerDir,
      ready: 'ready',
      working: 'working',
      parked: 'parked',
    },
    integrationBranch: 'feature/x',
  }) as never

const loopPr = (
  number: number,
  headRefName: string,
  baseRefName: string,
  overrides: Record<string, unknown> = {},
) => ({
  number,
  headRefName,
  baseRefName,
  title: `Issue ${headRefName.slice(5)} (#${headRefName.slice(5)})`,
  isDraft: false,
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  ...overrides,
})

const notifyMessages: string[] = []
const notify = async (text: string) => {
  notifyMessages.push(text)
}

describe('maintenance', () => {
  it('marks the merged issue done, rebases the stack, retargets only the direct dependent', async () => {
    notifyMessages.length = 0
    const { repoDir, originDir, trackerDir } = await makeWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')
    await writeIssue(trackerDir, '003-c.md', 'base: 2')

    const { deps, ghCalls } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/2': [{ number: 12, baseRefName: 'loop/1' }],
      'pr list --state open --head loop/3': [{ number: 13, baseRefName: 'loop/2' }],
    })

    const before2 = git(repoDir, 'rev-parse', 'origin/loop/2')
    const before3 = git(repoDir, 'rev-parse', 'origin/loop/3')

    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.markedDone).toEqual([1])
    expect(report.rebased).toEqual([2, 3])
    expect(report.retargeted).toEqual([2])
    expect(report.conflicts).toEqual([])

    // Issue 1 is done in the tracker; the others are untouched.
    expect(await readFile(join(trackerDir, 'issues', '001-a.md'), 'utf8')).toContain('state: done')
    expect(await readFile(join(trackerDir, 'issues', '002-b.md'), 'utf8')).not.toContain('state:')

    // loop/1 is deleted remotely and locally.
    expect(() => git(originDir, 'rev-parse', '--verify', 'loop/1')).toThrow()
    expect(() => git(repoDir, 'rev-parse', '--verify', 'loop/1')).toThrow()

    // Both stacked branches moved and now contain the updated bases.
    const after2 = git(repoDir, 'rev-parse', 'origin/loop/2')
    const after3 = git(repoDir, 'rev-parse', 'origin/loop/3')
    expect(after2).not.toBe(before2)
    expect(after3).not.toBe(before3)
    git(repoDir, 'merge-base', '--is-ancestor', 'origin/develop', 'loop/2')
    git(repoDir, 'merge-base', '--is-ancestor', 'loop/2', 'loop/3')

    // loop/2's PR was retargeted to develop; loop/3's keeps its parent base.
    expect(ghCalls).toContain('pr edit 12 --base develop')
    expect(ghCalls).not.toContain('pr edit 13 --base develop')
  })

  it('leaves a conflicting branch untouched and reports it', async () => {
    notifyMessages.length = 0
    const { repoDir, trackerDir } = await makeWorld()
    // develop and loop/2 now disagree on one.txt's contents.
    await writeFile(join(repoDir, 'one.txt'), 'develop wins\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-m', 'develop changes one.txt')
    git(repoDir, 'push', 'origin', 'develop')
    git(repoDir, 'checkout', 'loop/2')
    await writeFile(join(repoDir, 'one.txt'), 'two wins\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-m', 'loop/2 changes one.txt')
    git(repoDir, 'push', 'origin', 'loop/2')
    git(repoDir, 'checkout', 'develop')

    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')

    const { deps, ghCalls } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/2': [{ number: 12, baseRefName: 'loop/1' }],
    })

    const before = git(repoDir, 'rev-parse', 'origin/loop/2')
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.conflicts).toEqual(['loop/2'])
    expect(report.rebased).toEqual([])
    expect(git(repoDir, 'rev-parse', 'origin/loop/2')).toBe(before)
    expect(() => git(repoDir, 'rev-parse', '--verify', 'rebase-merge')).toThrow()
    expect(ghCalls).not.toContain('pr edit 12 --base develop')
    expect(notifyMessages.some((m) => m.includes('loop/2'))).toBe(true)
  })

  it('never rebases a branch the loop is working, and stops below it', async () => {
    const { repoDir, trackerDir } = await makeWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'state: working\nbase: 1')
    await writeIssue(trackerDir, '003-c.md', 'base: 2')

    const { deps } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/2': [],
    })

    const before2 = git(repoDir, 'rev-parse', 'origin/loop/2')
    const before3 = git(repoDir, 'rev-parse', 'origin/loop/3')
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.skippedWorking).toEqual([2])
    expect(report.rebased).toEqual([])
    expect(git(repoDir, 'rev-parse', 'origin/loop/2')).toBe(before2)
    expect(git(repoDir, 'rev-parse', 'origin/loop/3')).toBe(before3)
    // The merged branch is still deleted; the rebase waits for issue 2.
    expect(report.deletedBranches).toEqual(['loop/1'])
  })

  it('parks an unsteered issue whose PR closed without merging', async () => {
    notifyMessages.length = 0
    const { repoDir, trackerDir } = await makeWorld({ loop1Merged: false })
    await writeIssue(trackerDir, '005-e.md', '')
    const { deps } = fakeGh({
      'pr list --state merged': [],
      'pr list --state closed': [{ number: 50, headRefName: 'loop/5', closedAt: nowIso() }],
    })
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.parked).toEqual([5])
    expect(await readFile(join(trackerDir, 'issues', '005-e.md'), 'utf8')).toContain(
      'state: parked',
    )
    expect(notifyMessages.some((m) => m.includes('closed without merging'))).toBe(true)
  })

  it('github tracker: rebases and retargets without touching issue labels', async () => {
    const { repoDir, originDir, trackerDir } = await makeWorld()
    const { deps, ghCalls } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/2': [{ number: 12, baseRefName: 'loop/1' }],
      'issue view 2 --json labels': { labels: [] },
      'issue list': [{ number: 2, body: 'Base: 1\n\nspec' }],
    })
    const report = await maintenance({
      repoDir,
      config: config(trackerDir, 'github'),
      withLock: false,
      deps,
      notify,
    })

    expect(report.markedDone).toEqual([]) // the PR's "Closes #" closes the GitHub issue
    expect(ghCalls.filter((c) => c.startsWith('issue edit'))).toEqual([])
    expect(report.rebased).toEqual([2])
    expect(ghCalls).toContain('pr edit 12 --base develop')
    expect(() => git(originDir, 'rev-parse', '--verify', 'loop/1')).toThrow()
  })

  it('acts on nothing before its first-ever watermark, then processes new merges', async () => {
    const { repoDir, trackerDir } = await makeWorld({ watermark: false })
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')

    const handlers = (mergedAt: string) => ({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/2': [{ number: 12, baseRefName: 'loop/1' }],
    })

    const first = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps: fakeGh(handlers(nowIso())).deps,
      notify,
    })
    expect(first.markedDone).toEqual([])
    expect(first.rebased).toEqual([])
    expect(await readFile(join(trackerDir, 'issues', '001-a.md'), 'utf8')).not.toContain(
      'state: done',
    )
    expect(git(repoDir, 'rev-parse', 'origin/loop/1')).not.toBe('')

    // A merge after the watermark is processed on the next run.
    const second = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps: fakeGh(handlers(new Date(Date.now() + 60_000).toISOString())).deps,
      notify,
    })
    expect(second.markedDone).toEqual([1])
    expect(second.rebased).toEqual([2])
    expect(second.deletedBranches).toEqual(['loop/1'])
  })

  it('skips merged branches the tracker does not know, without deleting them', async () => {
    const { repoDir, trackerDir } = await makeWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    const { deps } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
        { number: 19, headRefName: 'loop/9', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
    })
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.skippedMissing).toEqual([9])
    expect(report.errors).toEqual([])
    expect(report.markedDone).toEqual([1])
    expect(report.deletedBranches).toEqual(['loop/1']) // the known merge is processed
    expect(git(repoDir, 'rev-parse', 'origin/loop/3')).not.toBe('') // untouched era
  })

  it('never deletes a merged branch that has a live PR on it, as head or base', async () => {
    const { repoDir, trackerDir } = await makeWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    const handlers = (head: unknown[], base: unknown[]) => ({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/1': head,
      'pr list --state open --base loop/1': base,
    })

    const asHead = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps: fakeGh(handlers([{ number: 99 }], [])).deps,
      notify,
    })
    expect(asHead.deletedBranches).toEqual([])

    const asBase = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps: fakeGh(handlers([], [{ number: 98 }])).deps,
      notify,
    })
    expect(asBase.deletedBranches).toEqual([])
    expect(git(repoDir, 'rev-parse', 'origin/loop/1')).not.toBe('')
  })

  it('rebases cleanly even with a dirty main checkout', async () => {
    const { repoDir, trackerDir } = await makeWorld()
    await writeFile(join(repoDir, 'app.txt'), 'dirty edit\n') // tracked file, unstaged
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')
    const { deps, ghCalls } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/2': [{ number: 12, baseRefName: 'loop/1' }],
    })
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.conflicts).toEqual([])
    expect(report.rebased).toEqual([2])
    expect(ghCalls).toContain('pr edit 12 --base develop')
    expect(await readFile(join(repoDir, 'app.txt'), 'utf8')).toBe('dirty edit\n')
  })

  it('does not rebase a dependent whose own PR also merged', async () => {
    const { repoDir, trackerDir } = await makeWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')
    const { deps } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
        { number: 12, headRefName: 'loop/2', baseRefName: 'loop/1', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
    })
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })

    expect(report.rebased).toEqual([])
    expect(report.markedDone.sort()).toEqual([1, 2])
    expect(report.deletedBranches.sort()).toEqual(['loop/1', 'loop/2'])
  })

  it('auto-merge: merges a green stateless PR into the integration branch and opens the review PR', async () => {
    notifyMessages.length = 0
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')

    const pass1 = fakeGh({
      'pr list --state open': [loopPr(11, 'loop/1', 'feature/x'), loopPr(12, 'loop/2', 'loop/1')],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [],
    })
    const first = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: pass1.deps,
      notify,
    })
    expect(first.autoMerged).toEqual([1])
    expect(pass1.ghCalls.some((c) => c.startsWith('pr merge 11 --squash'))).toBe(true)
    expect(
      pass1.ghCalls.some((c) => c.startsWith('pr create --base develop --head feature/x')),
    ).toBe(true)
    expect(notifyMessages.some((m) => m.includes('Treadle merged #11'))).toBe(true)
    // The merged list was empty (static fake), so the done-marking waits
    // for the next pass.
    expect(first.markedDone).toEqual([])

    // Pass 2: GitHub now reports PR 11 as merged; the cascade machinery
    // marks the issue done, rebases the dependent onto the integration
    // branch, retargets its PR, and never re-opens the review PR.
    const pass2 = fakeGh({
      'pr list --state open': [loopPr(12, 'loop/2', 'loop/1')],
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'feature/x', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/1': [],
      'pr list --state open --base loop/1': [],
      'pr list --state all --head feature/x': [{ number: 99 }],
    })
    const second = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: pass2.deps,
      notify,
    })
    expect(second.markedDone).toEqual([1])
    expect(second.rebased).toEqual([2])
    expect(second.deletedBranches).toEqual(['loop/1'])
    expect(pass2.ghCalls).toContain('pr edit 12 --base feature/x')
    expect(pass2.ghCalls.some((c) => c.startsWith('pr create'))).toBe(false)
    expect(await readFile(join(trackerDir, 'issues', '001-a.md'), 'utf8')).toContain('state: done')
    git(repoDir, 'merge-base', '--is-ancestor', 'origin/feature/x', 'loop/2')
  })

  it('auto-merge: a stacked child waits for its parent to merge, then lands', async () => {
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')
    // Both PRs already target the integration branch (as a migrated stack
    // would): the child is green, the parent is not.
    const pass1 = fakeGh({
      'pr list --state open': [
        loopPr(11, 'loop/1', 'feature/x'),
        loopPr(12, 'loop/2', 'feature/x'),
      ],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [],
    })
    const first = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: pass1.deps,
      notify,
    })
    expect(first.autoMerged).toEqual([1])
    expect(pass1.ghCalls.some((c) => c.startsWith('pr merge 12'))).toBe(false)

    // Pass 2: GitHub reports the parent merged. Done-marking happens in the
    // merged-processing step, which runs after auto-merge — so the child is
    // still blocked this pass (its parent reads stateless at step time).
    const pass2 = fakeGh({
      'pr list --state open': [loopPr(12, 'loop/2', 'feature/x')],
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'feature/x', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
      'pr list --state open --head loop/1': [],
      'pr list --state open --base loop/1': [],
      'pr list --state open --head loop/2': [{ number: 12, baseRefName: 'feature/x' }],
      'pr list --state all --head feature/x': [{ number: 99 }],
    })
    const second = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: pass2.deps,
      notify,
    })
    expect(second.markedDone).toEqual([1])
    expect(second.autoMerged).toEqual([])
    expect(await readFile(join(trackerDir, 'issues', '001-a.md'), 'utf8')).toContain('state: done')

    // Pass 3: the parent is done in the tracker; the child may go now.
    const pass3 = fakeGh({
      'pr list --state open': [loopPr(12, 'loop/2', 'feature/x')],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [{ number: 99 }],
    })
    const third = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: pass3.deps,
      notify,
    })
    expect(third.autoMerged).toEqual([2])
  })

  it('auto-merge: merges green PRs lowest issue number first', async () => {
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', '')
    const { deps, ghCalls } = fakeGh({
      'pr list --state open': [
        loopPr(12, 'loop/2', 'feature/x'),
        loopPr(11, 'loop/1', 'feature/x'),
      ],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [],
    })
    const report = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps,
      notify,
    })
    expect(report.autoMerged).toEqual([1, 2])
    expect(ghCalls.findIndex((c) => c.startsWith('pr merge 11'))).toBeLessThan(
      ghCalls.findIndex((c) => c.startsWith('pr merge 12')),
    )
  })

  it('auto-merge: skips drafts, unclean PRs, foreign bases and steered issues', async () => {
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', 'state: ready')
    await writeIssue(trackerDir, '002-b.md', 'state: parked')
    const { deps, ghCalls } = fakeGh({
      'pr list --state open': [
        loopPr(11, 'loop/1', 'feature/x'), // issue 1 is ready — a human steered it
        loopPr(12, 'loop/2', 'feature/x'), // issue 2 is parked
        loopPr(13, 'loop/3', 'feature/x', { isDraft: true }),
        loopPr(14, 'loop/4', 'feature/x', { mergeStateStatus: 'BEHIND' }),
        loopPr(15, 'loop/5', 'develop'), // not the integration branch
        loopPr(16, 'loop/6', 'feature/x'), // issue 6 is not in the tracker
      ],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [],
    })
    const report = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps,
      notify,
    })
    expect(report.autoMerged).toEqual([])
    expect(ghCalls.some((c) => c.startsWith('pr merge'))).toBe(false)
    expect(ghCalls.some((c) => c.startsWith('pr create'))).toBe(false)
  })

  it('auto-merge: a PR conflicted only on the engine scratch note is rebased, not paged', async () => {
    notifyMessages.length = 0
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    // Both branches write the same root note: the conflict every pair of
    // sibling ticket branches used to hit. The loop drops it and moves on.
    git(repoDir, 'checkout', 'loop/1')
    await writeFile(join(repoDir, 'PROGRESS.md'), 'note from issue 1\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-m', 'note 1')
    git(repoDir, 'push', 'origin', 'loop/1')
    const before = git(repoDir, 'rev-parse', 'origin/loop/1')
    const handlers = {
      'pr list --state open': [
        loopPr(11, 'loop/1', 'feature/x', {
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
        }),
      ],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [],
    }
    const report = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: fakeGh(handlers).deps,
      notify,
    })
    expect(report.rebased).toEqual([1])
    expect(report.conflicts).toEqual([])
    expect(notifyMessages.some((m) => m.includes('needs to rebase it by hand'))).toBe(false)
    expect(notifyMessages.some((m) => m.includes('rebased loop/1'))).toBe(true)
    // The note survives: dropping it means dropping it from the merge, not
    // from the branch the session keeps working on.
    void before
    expect(
      execFileSync('git', ['show', 'origin/loop/1:PROGRESS.md'], {
        cwd: repoDir,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).toString(),
    ).toBe('note from issue 1\n')
  })

  it('auto-merge: a conflict outside the engine files still pages once, then stays silent', async () => {
    notifyMessages.length = 0
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    // Real code conflict: the integration branch changes app.txt after the
    // branch was cut, and the branch changes the same line.
    git(repoDir, 'checkout', 'feature/x')
    await writeFile(join(repoDir, 'app.txt'), 'integration change\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-m', 'integration moved')
    git(repoDir, 'push', 'origin', 'feature/x')
    git(repoDir, 'checkout', 'loop/1')
    await writeFile(join(repoDir, 'app.txt'), 'branch change\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-m', 'branch moved')
    git(repoDir, 'push', 'origin', 'loop/1')
    git(repoDir, 'checkout', 'develop')
    const handlers = {
      'pr list --state open': [
        loopPr(11, 'loop/1', 'feature/x', {
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
        }),
      ],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state all --head feature/x': [],
    }
    const report = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: fakeGh(handlers).deps,
      notify,
    })
    expect(report.conflicts).toEqual(['loop/1'])
    /* The page names the conflicted files and what each one is, instead of
     * asking a reader to find out which ones and guess whether they matter. */
    const nags = () =>
      notifyMessages.filter(
        (m) => m.includes('will not guess at code') && m.includes('conflicted file'),
      ).length
    expect(nags()).toBe(1)
    // Same state next pass: silent. Genuine code conflicts still dedupe.
    await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: fakeGh(handlers).deps,
      notify,
    })
    expect(nags()).toBe(1)
  })

  it('auto-merge: a hand branch (no tracker linkage) merges on green alone, branch cleaned up', async () => {
    const { repoDir, originDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    // A hand-authored branch off the integration branch with no loop/N name
    // and no issue file — e.g. the oracle or test-infra work.
    git(repoDir, 'checkout', '-b', 'feat/oracle', 'origin/feature/x')
    await writeFile(join(repoDir, 'oracle.txt'), 'oracle\n')
    git(repoDir, 'add', '-A')
    git(repoDir, 'commit', '-m', 'oracle')
    git(repoDir, 'push', 'origin', 'feat/oracle')
    git(repoDir, 'checkout', 'develop')

    const pass = fakeGh({
      'pr list --state open': [loopPr(21, 'feat/oracle', 'feature/x', { title: 'the oracle' })],
      'pr list --state merged': [],
      'pr list --state closed': [],
      'pr list --state open --base feat/oracle': [],
      'pr list --state all --head feature/x': [],
    })
    const report = await maintenance({
      repoDir,
      config: shiftConfig(trackerDir),
      withLock: false,
      deps: pass.deps,
      notify,
    })
    expect(report.autoMerged).toEqual(['feat/oracle'])
    expect(pass.ghCalls.some((c) => c.startsWith('pr merge 21 --squash'))).toBe(true)
    // No tracker state was consulted or written: no issues touched.
    expect(await readFile(join(trackerDir, 'issues', '001-a.md'), 'utf8')).not.toContain('state:')
    // The merged hand branch is deleted on the remote (no PRs stacked on it).
    expect(() => git(originDir, 'rev-parse', '--verify', 'feat/oracle')).toThrow()
    // The review PR opened on the first merge.
    expect(
      pass.ghCalls.some((c) => c.startsWith('pr create --base develop --head feature/x')),
    ).toBe(true)
  })

  it('without an integration branch, nothing auto-merges', async () => {
    const { repoDir, trackerDir } = await makeShiftWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    const { deps, ghCalls } = fakeGh({
      'pr list --state open': [loopPr(11, 'loop/1', 'feature/x')],
      'pr list --state merged': [],
      'pr list --state closed': [],
    })
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })
    expect(report.autoMerged).toEqual([])
    expect(ghCalls.some((c) => c.startsWith('pr merge'))).toBe(false)
  })

  it('collects per-PR errors and keeps going', async () => {
    const { repoDir, trackerDir } = await makeWorld()
    await writeIssue(trackerDir, '001-a.md', '')
    await writeIssue(trackerDir, '002-b.md', 'base: 1')
    const { deps } = fakeGh({
      'pr list --state merged': [
        { number: 11, headRefName: 'loop/1', baseRefName: 'develop', mergedAt: nowIso() },
      ],
      'pr list --state closed': [],
    })
    const original = deps.ghJsonFn
    deps.ghJsonFn = (async (repoDir2: string, ...args: string[]) => {
      const key = args.join(' ')
      if (key.startsWith('pr list --state open --head loop/2')) throw new Error('gh exploded')
      return original(repoDir2, ...args)
    }) as MaintenanceDeps['ghJsonFn']
    // The retarget of loop/2 throws mid-iteration; the pass reports it and
    // finishes instead of aborting.
    const report = await maintenance({
      repoDir,
      config: config(trackerDir),
      withLock: false,
      deps,
      notify,
    })
    expect(report.errors).toHaveLength(1)
    expect(report.errors[0]).toContain('loop/1')
    expect(report.errors[0]).toContain('gh exploded')
    expect(report.markedDone).toEqual([1])
  })
})
