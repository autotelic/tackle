import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Session-log retention.
 *
 * A pass writes its whole conversation to `.treadle/sessions/`, and nothing
 * ever removed them: two days of one project came to **13 GB**, with single
 * files up to 377 MB. The durable record is the Receipt in the tracker (who,
 * what, how many turns, what it cost), so the transcript is a debugging
 * convenience with a natural expiry.
 *
 * Two rules, both necessary:
 * - Age: a log older than `keepDays` goes.
 * - Recency: for an issue that is **still open**, the newest log stays however
 *   old — re-entry distils the previous Pass from that file, so pruning it
 *   would delete the one thing the Loop still reads. A finished issue has its
 *   Receipt, and nothing reads its transcript again.
 */

/** A session log's identity: which issue and pass it belongs to. */
const SESSION_NAME = /^issue-(\d+)-pass-(\d+)-/u

export interface PruneResult {
  readonly removed: number
  readonly removedBytes: number
  readonly kept: number
}

/**
 * Remove session logs older than `keepDays`, keeping each issue's newest.
 * Files that are not session logs are left alone; a log whose name cannot be
 * read is kept (never delete what the engine does not understand).
 */
export async function pruneSessions(options: {
  readonly sessionsDir: string
  readonly keepDays: number
  /** Issues that are not done: their newest log survives regardless of age. */
  readonly openIssues?: ReadonlySet<number>
  readonly now?: Date
}): Promise<PruneResult> {
  const openIssues = options.openIssues ?? new Set<number>()
  const now = options.now ?? new Date()
  const cutoff = now.getTime() - options.keepDays * 24 * 60 * 60 * 1000
  const names = await readdir(options.sessionsDir).catch(() => [] as string[])
  const logs: Array<{ name: string; issue: number; at: number; bytes: number }> = []
  for (const name of names) {
    const match = SESSION_NAME.exec(name)
    if (match?.[1] === undefined) continue
    const info = await stat(join(options.sessionsDir, name)).catch(() => null)
    if (info === null || !info.isFile()) continue
    logs.push({
      name,
      issue: Number.parseInt(match[1], 10),
      at: info.mtimeMs,
      bytes: info.size,
    })
  }
  const newest = new Map<number, string>()
  for (const log of logs) {
    const current = newest.get(log.issue)
    if (current === undefined) {
      newest.set(log.issue, log.name)
      continue
    }
    const currentLog = logs.find((candidate) => candidate.name === current)
    if (currentLog !== undefined && log.at > currentLog.at) newest.set(log.issue, log.name)
  }
  const keepNewest = new Set(newest.values())
  let removed = 0
  let removedBytes = 0
  for (const log of logs) {
    if (openIssues.has(log.issue) && keepNewest.has(log.name)) continue
    if (log.at >= cutoff) continue
    await rm(join(options.sessionsDir, log.name), { force: true }).catch(() => undefined)
    removed += 1
    removedBytes += log.bytes
  }
  return { removed, removedBytes, kept: logs.length - removed }
}
