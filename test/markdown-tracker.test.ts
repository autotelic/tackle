import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  markdownComment,
  markdownIssueUrl,
  markdownListReady,
  markdownListWorking,
  markdownReadLabels,
  markdownReadReceiptHistory,
  markdownRelabel,
  markdownRemoveLabel,
  parseFrontmatter,
  readIssueFiles,
  removeState,
  setState,
} from '../src/loop/markdown-tracker.ts'
import { type Receipt, renderReceipt } from '../src/receipt.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd }).toString().trim()

let dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
  vi.restoreAllMocks()
})

async function makeDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

async function makeTracker(): Promise<string> {
  const dir = await makeDir('treadle-md-')
  await mkdir(join(dir, 'issues'), { recursive: true })
  return dir
}

async function writeIssue(dir: string, name: string, text: string): Promise<void> {
  await writeFile(join(dir, 'issues', name), text)
}

function gitInit(dir: string): void {
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
}

const receipt = (pass: number): Receipt => ({
  issue: 1,
  pass,
  budget: 3,
  terminal: 'completed',
  turns: 12,
  sessionLogPath: '/tmp/session.jsonl',
  checkpoint: 'abcdef1234567890',
  checks: { outcome: 'checks.failed', frontier: 2, failureSet: [], reportDir: '/tmp/report' },
})

describe('parseFrontmatter', () => {
  it('parses scalars, arrays, quoted values and trailing comments', () => {
    const { attrs, body } = parseFrontmatter(
      [
        '---',
        'state: ready # picked next',
        'base: 3',
        'blocked_by: [1, 2, 03]',
        'title: "Relationship view"',
        'also: nothing special',
        '---',
        '',
        '# Body heading',
      ].join('\n'),
    )
    expect(attrs).toEqual({
      state: 'ready',
      base: 3,
      blocked_by: [1, 2, 3],
      title: 'Relationship view',
      also: 'nothing special',
    })
    expect(body).toBe('\n# Body heading')
  })

  it('treats a file without frontmatter as attribute-less', () => {
    const { attrs, body } = parseFrontmatter('# Just a heading\n')
    expect(attrs).toEqual({})
    expect(body).toBe('# Just a heading\n')
  })
})

describe('setState / removeState', () => {
  it('setState prepends frontmatter when the file has none', () => {
    expect(setState('# Title\n', 'ready')).toBe('---\nstate: ready\n---\n\n# Title\n')
  })

  it('setState replaces only the state line and preserves the rest', () => {
    const text =
      '---\nstate: ready\nbase: develop\nblocked_by: [2]\n---\n# Body\nstate: not-frontmatter\n'
    expect(setState(text, 'working')).toBe(
      '---\nstate: working\nbase: develop\nblocked_by: [2]\n---\n# Body\nstate: not-frontmatter\n',
    )
  })

  it('setState inserts into frontmatter that lacks a state line', () => {
    expect(setState('---\nbase: 2\n---\n# Body\n', 'ready')).toBe(
      '---\nstate: ready\nbase: 2\n---\n# Body\n',
    )
  })

  it('removeState drops the whole block when state was the only key', () => {
    expect(removeState('---\nstate: ready\n---\n\n# Body\n')).toBe('# Body\n')
  })

  it('removeState keeps other keys', () => {
    expect(removeState('---\nstate: parked\nbase: 2\n---\n# Body\n')).toBe(
      '---\nbase: 2\n---\n# Body\n',
    )
  })
})

describe('readIssueFiles', () => {
  it('reads numbered issues, ignores other files, derives the title', async () => {
    const dir = await makeTracker()
    await writeIssue(dir, '002-second.md', '---\nstate: ready\ntitle: Explicit\n---\nBody two\n')
    await writeIssue(dir, '001-first.md', '---\nstate: ready\n---\n# Heading title\n')
    await writeIssue(dir, '003-third.md', 'Body three only\n')
    await writeFile(join(dir, 'issues', 'notes.md'), 'not an issue\n')
    await writeFile(join(dir, 'issues', 'README.md'), 'not an issue\n')
    const files = await readIssueFiles(dir)
    expect(files.map((f) => [f.number, f.title, f.state ?? null])).toEqual([
      [1, 'Heading title', 'ready'],
      [2, 'Explicit', 'ready'],
      [3, 'third', null],
    ])
    expect(files[0]?.body).toBe('# Heading title\n')
    expect(files[2]?.body).toBe('Body three only\n')
  })
})

describe('markdownListReady / markdownListWorking', () => {
  it('lists ready issues lowest-first and working issues by state', async () => {
    const dir = await makeTracker()
    await writeIssue(dir, '002-b.md', '---\nstate: ready\n---\nB\n')
    await writeIssue(dir, '001-a.md', '---\nstate: ready\n---\nA\n')
    await writeIssue(dir, '003-c.md', '---\nstate: working\n---\nC\n')
    const repoDir = await makeDir('treadle-md-repo-')
    const ready = await markdownListReady(repoDir, dir, 'ready')
    expect(ready.map((i) => i.number)).toEqual([1, 2])
    const working = await markdownListWorking(dir, 'working')
    expect(working.map((i) => i.number)).toEqual([3])
  })

  it('keeps issues out of the queue while a blocker is not done', async () => {
    const dir = await makeTracker()
    await writeIssue(dir, '001-a.md', '---\nstate: ready\n---\nA\n')
    await writeIssue(dir, '002-b.md', '---\nstate: ready\nblocked_by: [1]\n---\nB\n')
    await writeIssue(dir, '003-c.md', '---\nstate: ready\nblocked_by: [99]\n---\nC (missing ref)\n')
    const repoDir = await makeDir('treadle-md-repo-')
    expect((await markdownListReady(repoDir, dir, 'ready')).map((i) => i.number)).toEqual([1])
    // A stateless file blocks its dependents (same as GitHub's label-less open issue).
    await writeIssue(dir, '001-a.md', '---\n---\nA (PR open)\n')
    expect((await markdownListReady(repoDir, dir, 'ready')).map((i) => i.number)).toEqual([])
    await writeIssue(dir, '001-a.md', '---\nstate: done\n---\nA (merged)\n')
    expect((await markdownListReady(repoDir, dir, 'ready')).map((i) => i.number)).toEqual([2])
  })

  it('gates a numeric base on the base issue’s loop/<n> branch existing', async () => {
    const dir = await makeTracker()
    await writeIssue(dir, '003-base.md', '---\nstate: ready\n---\nBase\n')
    await writeIssue(dir, '004-stacked.md', '---\nstate: ready\nbase: 3\n---\nStacked\n')
    const repoDir = await makeDir('treadle-md-repo-')
    gitInit(repoDir)
    git(repoDir, 'commit', '--allow-empty', '-m', 'init')

    const before = await markdownListReady(repoDir, dir, 'ready')
    expect(before.map((i) => i.number)).toEqual([3])

    git(repoDir, 'branch', 'loop/3')
    const after = await markdownListReady(repoDir, dir, 'ready')
    expect(after.map((i) => i.number)).toEqual([3, 4])
    expect(after[1]?.base).toBe(3)
  })
})

describe('markdownRelabel / markdownRemoveLabel / markdownReadLabels', () => {
  it('writes state changes and commits them', async () => {
    const dir = await makeTracker()
    gitInit(dir)
    await writeIssue(dir, '001-a.md', '---\nstate: ready\n---\n# A\n\nKeep this body.\n')
    git(dir, 'add', '-A')
    git(dir, 'commit', '-m', 'issues')

    await markdownRelabel(dir, 1, 'ready', 'working')
    expect(await readFile(join(dir, 'issues', '001-a.md'), 'utf8')).toBe(
      '---\nstate: working\n---\n# A\n\nKeep this body.\n',
    )
    expect(await markdownReadLabels(dir, 1)).toEqual(['working'])
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('treadle: #1 → working')
    expect(git(dir, 'status', '--porcelain')).toBe('')

    await markdownRemoveLabel(dir, 1, 'working')
    expect(await readFile(join(dir, 'issues', '001-a.md'), 'utf8')).toBe('# A\n\nKeep this body.\n')
    expect(await markdownReadLabels(dir, 1)).toEqual([])
    expect(git(dir, 'log', '-1', '--format=%s')).toBe('treadle: #1 state cleared (PR open)')
  })

  it('relabel fails loudly for a missing issue', async () => {
    const dir = await makeTracker()
    await expect(markdownRelabel(dir, 42, 'ready', 'working')).rejects.toThrow(/no issue file/)
  })
})

describe('markdownComment / markdownReadReceiptHistory / markdownIssueUrl', () => {
  it('round-trips receipts through log files and truncates at a budget reset', async () => {
    const dir = await makeTracker()
    await writeIssue(dir, '001-a.md', '---\nstate: working\n---\nA\n')

    await markdownComment(dir, 1, renderReceipt(receipt(1)))
    await markdownComment(dir, 1, 'a note that is not a receipt')
    await markdownComment(dir, 1, renderReceipt(receipt(2)))

    const logDir = join(dir, 'log', '001')
    const names = await readdir(logDir)
    expect(names).toHaveLength(3)
    expect(names).toEqual([...names].sort())

    const before = await markdownReadReceiptHistory(dir, 1)
    expect(before.map((r) => r.pass)).toEqual([1, 2])

    await markdownComment(dir, 1, '**Hint**\n\n<!-- treadle:budget-reset -->')
    await markdownComment(dir, 1, renderReceipt(receipt(3)))
    const after = await markdownReadReceiptHistory(dir, 1)
    expect(after.map((r) => r.pass)).toEqual([3])

    expect(await markdownIssueUrl(dir, 1)).toBe(join(dir, 'issues', '001-a.md'))
    expect(await markdownIssueUrl(dir, 42)).toBeNull()
  })
})

describe('sync', () => {
  it('pulls a human’s pushed edits and rebases the loop’s rejected push', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    // bare ← human clone and loop clone
    const bare = await makeDir('treadle-md-bare-')
    git(bare, 'init', '--bare', '-b', 'main')
    const human = await makeDir('treadle-md-human-')
    git(human, 'clone', bare, '.')
    git(human, 'config', 'user.email', 't@t')
    git(human, 'config', 'user.name', 't')
    await mkdir(join(human, 'issues'), { recursive: true })
    await writeIssue(human, '001-a.md', '---\nstate: ready\n---\nA\n')
    git(human, 'add', '-A')
    git(human, 'commit', '-m', 'issue 1')
    git(human, 'push', 'origin', 'main')

    const loop = await makeDir('treadle-md-loop-')
    git(loop, 'clone', bare, '.')
    git(loop, 'config', 'user.email', 't@t')
    git(loop, 'config', 'user.name', 't')

    // The human edits and pushes while the loop is mid-pass.
    await writeIssue(human, '002-b.md', '---\nstate: ready\n---\nB\n')
    git(human, 'add', '-A')
    git(human, 'commit', '-m', 'issue 2')
    git(human, 'push', 'origin', 'main')

    // The loop's receipt write commits locally; its push is rejected (bare moved on).
    await markdownComment(loop, 1, renderReceipt(receipt(1)))

    // The next read syncs: the rebase replays the loop's receipt on the human's commit.
    const ready = await markdownListReady(loop, loop, 'ready')
    expect(ready.map((i) => i.number)).toEqual([1, 2])
    expect(await markdownReadReceiptHistory(loop, 1)).toHaveLength(1)

    // And pushes work again afterwards.
    await markdownComment(loop, 1, renderReceipt(receipt(2)))
    expect(git(loop, 'rev-parse', 'HEAD')).toBe(git(loop, 'rev-parse', 'origin/main'))
  })
})
