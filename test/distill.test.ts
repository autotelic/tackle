import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractHandoff } from '../src/loop/distill.ts'
import { latestSessionLog } from '../src/loop/issue-loop.ts'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd })

let dirs: string[] = []
afterEach(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true })
  dirs = []
})

async function makeWorktree(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'treadle-distill-'))
  dirs.push(dir)
  git(dir, 'init', '-b', 'main')
  git(dir, 'config', 'user.email', 't@t')
  git(dir, 'config', 'user.name', 't')
  await writeFile(join(dir, 'app.ts'), 'export const x = 1\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', 'base')
  git(dir, 'checkout', '-b', 'loop/1')
  await writeFile(join(dir, 'migration.ts'), 'export const migration = true\n')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-m', 'work')
  return dir
}

function sessionLog(entries: unknown[]): string {
  return (
    entries.map((e) => JSON.stringify({ ts: '2026-11-09T00:00:00Z', event: e })).join('\n') + '\n'
  )
}

function thinkingEvent(thinking: string): unknown {
  return {
    type: 'message_update',
    assistantMessageEvent: {
      type: 'thinking_delta',
      delta: thinking.at(-1),
      partial: { role: 'assistant', content: [{ type: 'thinking', thinking }] },
    },
  }
}

async function writeLog(dir: string, entries: unknown[]): Promise<string> {
  const path = join(dir, 'session.jsonl')
  await mkdir(dir, { recursive: true })
  await writeFile(path, sessionLog(entries))
  return path
}

describe('extractHandoff', () => {
  it('assembles the progress note, diff summary, and last thinking', async () => {
    const worktree = await makeWorktree()
    await writeFile(
      join(worktree, 'PROGRESS.md'),
      '# Progress\n\nMigration written, 4 of 12 checks.\n',
    )
    const logPath = await writeLog(worktree, [
      thinkingEvent('First the schema said something else.'),
      thinkingEvent('The Company in the glossary maps to the client table.'),
    ])

    const handoff = await extractHandoff({
      worktreeDir: worktree,
      baseRef: 'main',
      sessionLogPath: logPath,
      terminal: 'failed',
      reason: 'turn cap 100 reached',
    })

    expect(handoff).toContain('ended (failed — turn cap 100 reached) without a handoff note')
    expect(handoff).toContain('Migration written, 4 of 12 checks.')
    expect(handoff).toContain('Branch state vs main:')
    expect(handoff).toContain('insertion')
    expect(handoff).toContain('The Company in the glossary maps to the client table.')
    expect(handoff).not.toContain('First the schema said something else.')
    expect(handoff).toContain('smaller increment')
  })

  it('says so when there is no PROGRESS.md, and skips a log that cannot be read', async () => {
    const worktree = await makeWorktree()
    const handoff = await extractHandoff({
      worktreeDir: worktree,
      baseRef: 'main',
      sessionLogPath: join(worktree, 'no-such-log.jsonl'),
      terminal: 'failed',
    })
    expect(handoff).toContain('No PROGRESS.md exists.')
    expect(handoff).not.toContain('last substantive thinking')
  })

  it('latestSessionLog picks the newest pass log and skips probes', async () => {
    const dir = await makeWorktree()
    const sessions = join(dir, 'sessions')
    await mkdir(sessions, { recursive: true })
    await writeFile(join(sessions, 'issue-1-pass-1-2026-01-01.jsonl'), '')
    await writeFile(join(sessions, 'issue-1-pass-2-2026-01-02.jsonl'), '')
    await writeFile(join(sessions, 'issue-1-pass-1-probe-2026-01-03.jsonl'), '')
    await writeFile(join(sessions, 'issue-2-pass-1-2026-01-04.jsonl'), '')
    expect(await latestSessionLog(dir, 1)).toBe(join(sessions, 'issue-1-pass-2-2026-01-02.jsonl'))
    expect(await latestSessionLog(join(dir, 'nope'), 1)).toBeNull()
  })

  it('truncates the thinking tail, end-weighted', async () => {
    const worktree = await makeWorktree()
    const long = 'x'.repeat(1200) + 'THE-IMPORTANT-END'
    const logPath = await writeLog(worktree, [thinkingEvent(long)])
    const handoff = await extractHandoff({
      worktreeDir: worktree,
      baseRef: 'main',
      sessionLogPath: logPath,
      terminal: 'failed',
    })
    expect(handoff).toContain('THE-IMPORTANT-END')
    expect(handoff.length).toBeLessThan(2000)
  })
})
