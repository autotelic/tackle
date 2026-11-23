/**
 * Seconda volta, v1 (Volta design candidates, 2026-11-09 incident): when a
 * Session fails — turn cap, timeout, abort — the retry must not re-pay for
 * the exploration. The Checkpoint keeps the code; this distils the handoff
 * (what the agent had learned and where it got to) from what the run left
 * behind, deterministically: no agent turns, no check runs — Treadle's rule
 * is that deterministic work runs in loop code, not inside LLM turns.
 *
 * Sources, best first: the agent's own progress note, the branch's diff
 * summary, then the run's last substantive thinking, taken whole from the
 * session log's accumulating `partial` events (no delta reassembly).
 */
import { open, readFile } from 'node:fs/promises'
import { git } from './git-exec.ts'

const MAX_PROGRESS_NOTE = 1200
const MAX_THINKING = 600
const TAIL_BYTES = 4 * 1024 * 1024

async function readTail(path: string): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const { size } = await handle.stat()
    const start = Math.max(0, size - TAIL_BYTES)
    const buffer = Buffer.alloc(size - start)
    await handle.read(buffer, 0, buffer.length, start)
    // Only a mid-file start leaves a partial JSON row to drop.
    const lines = buffer.toString('utf8').split('\n')
    return (start > 0 ? lines.slice(1) : lines).join('\n')
  } finally {
    await handle.close()
  }
}

/** The run's last substantive thinking, from the accumulating partial events. */
function lastThinking(logText: string): string | null {
  let thinking: string | null = null
  for (const line of logText.split('\n')) {
    if (!line.includes('thinking_delta')) continue
    try {
      const event = (JSON.parse(line) as { event?: { assistantMessageEvent?: unknown } }).event
      const sub = event?.assistantMessageEvent as
        | { partial?: { content?: { type?: string; thinking?: string }[] } }
        | undefined
      for (const part of sub?.partial?.content ?? []) {
        if (part.type === 'thinking' && typeof part.thinking === 'string' && part.thinking) {
          thinking = part.thinking
        }
      }
    } catch {
      // A malformed row says nothing; keep scanning.
    }
  }
  return thinking
}

export async function extractHandoff(options: {
  worktreeDir: string
  baseRef: string
  /** The failed Session's event log. */
  sessionLogPath: string
  terminal: string
  reason?: string
}): Promise<string> {
  const sections: string[] = []
  const why = options.reason ? ` — ${options.reason}` : ''
  sections.push(
    `The previous session ended (${options.terminal}${why}) without a handoff note. ` +
      'Do not re-pay for its exploration; here is what it left behind:',
  )

  let progressNote: string | null = null
  try {
    progressNote = await readFile(`${options.worktreeDir}/PROGRESS.md`, 'utf8')
  } catch {
    progressNote = null
  }
  sections.push(
    progressNote !== null
      ? `PROGRESS.md so far:\n\n${progressNote.trim().slice(0, MAX_PROGRESS_NOTE)}`
      : 'No PROGRESS.md exists.',
  )

  const diffStat = await git(
    options.worktreeDir,
    'diff',
    '--shortstat',
    `${options.baseRef}...HEAD`,
  ).catch(() => '')
  if (diffStat) sections.push(`Branch state vs ${options.baseRef}: ${diffStat}`)

  const thinking = lastThinking(await readTail(options.sessionLogPath).catch(() => ''))
  if (thinking !== null) {
    sections.push(
      `Its last substantive thinking (may cut off mid-sentence):\n"""\n…${thinking.slice(-MAX_THINKING)}\n"""`,
    )
  }

  sections.push(
    'Land a smaller increment than the whole issue if that is what gets this Pass green; ' +
      'update PROGRESS.md so the next session starts from the truth.',
  )

  return sections.join('\n\n')
}
