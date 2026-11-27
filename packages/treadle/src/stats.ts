import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parseReceipt, type Receipt } from './receipt.ts'

/**
 * `treadle stats` — the numbers a budget conversation needs, read from what the
 * Loop already writes.
 *
 * Every question about the nightly caps ("is 24 passes the right bound?", "what
 * does a ticket cost?") was answered by hand from receipts three times in one
 * run. A Pass is not the unit anyone cares about: money and wall-clock are.
 *
 * Two sources, deliberately: receipts carry the Session's own accounting
 * (turns, dollars), and they are kept by the tracker whether or not the loop
 * clone still exists. Session logs are the only record of *time*, so they are
 * read when present and reported as coverage rather than extrapolated.
 */

/** One Pass as both sources describe it. */
export interface PassStat {
  readonly issue: number
  readonly pass: number
  readonly terminal: string
  readonly turns: number
  readonly costUsd: number
  /** The session's wall-clock span in minutes, when its log is still on disk. */
  readonly activeMinutes: number | null
}

/** Per-ticket totals across its Passes. */
export interface IssueStat {
  readonly issue: number
  readonly passes: number
  readonly turns: number
  readonly costUsd: number
  readonly activeMinutes: number
  /** The ticket's terminal state in the tracker, when known. */
  readonly state: string | null
}

export interface StatsReport {
  readonly issues: ReadonlyArray<IssueStat>
  readonly totals: {
    readonly issues: number
    readonly passes: number
    readonly turns: number
    readonly costUsd: number
    readonly activeMinutes: number
    /** How many Passes had a session log on disk: the coverage of the time figures. */
    readonly timedPasses: number
    readonly meanCostUsd: number
    readonly medianCostUsd: number
    readonly meanActiveMinutes: number
    readonly medianActiveMinutes: number
  }
}

/** The issue's state line from its markdown issue file, or null. */
async function issueStates(issuesDir: string): Promise<ReadonlyMap<number, string>> {
  const states = new Map<number, string>()
  const names = await readdir(issuesDir).catch(() => [] as string[])
  for (const name of names) {
    const match = name.match(/^(\d+)-.*\.md$/u)
    if (!match?.[1]) continue
    const text = await readFile(join(issuesDir, name), 'utf8').catch(() => '')
    const frontmatter = text.startsWith('---') ? (text.split('---')[1] ?? '') : ''
    const state = frontmatter.match(/^state:\s*(\S+)/mu)?.[1]
    if (state !== undefined) states.set(Number.parseInt(match[1], 10), state)
  }
  return states
}

/**
 * The span of a session log, in minutes. The Loop's own format stamps every
 * line with `{"ts":"<ISO>"}`, so the first and last lines bound the work.
 * A log that cannot be read is `null`, never a guess.
 */
async function sessionMinutes(logPath: string): Promise<number | null> {
  const text = await readFile(logPath, 'utf8').catch(() => null)
  if (text === null) return null
  const stamps: Array<number> = []
  for (const line of text.split('\n')) {
    const match = line.match(/^\{"ts":"([^"]+)"/u)
    if (match?.[1] === undefined) continue
    const at = Date.parse(match[1])
    if (Number.isFinite(at)) stamps.push(at)
  }
  if (stamps.length < 2) return null
  const first = Math.min(...stamps)
  const last = Math.max(...stamps)
  return (last - first) / 60_000
}

/** Read every receipt under the tracker's `log/<issue>/` tree. */
export async function readReceipts(dir: string | null): Promise<ReadonlyArray<Receipt>> {
  if (dir === null) return []
  const receipts: Receipt[] = []
  const logDir = join(dir, 'log')
  const issueDirs = await readdir(logDir).catch(() => [] as string[])
  for (const issueDir of issueDirs) {
    const files = await readdir(join(logDir, issueDir)).catch(() => [] as string[])
    for (const name of files) {
      if (!name.endsWith('.md')) continue
      const text = await readFile(join(logDir, issueDir, name), 'utf8').catch(() => '')
      const receipt = parseReceipt(text)
      if (receipt !== null) receipts.push(receipt)
    }
  }
  return receipts
}

const mean = (values: ReadonlyArray<number>): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

/** The median; the mean alone hid a 16× spread in one run. */
const median = (values: ReadonlyArray<number>): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0)
}

/**
 * The report: per-ticket and total, from receipts plus whatever session logs
 * survive. `sessionsDir` may be absent — the time columns then say so via
 * `timedPasses` rather than pretending the work took no time.
 */
export async function statsReport(options: {
  readonly trackerDir: string | null
  readonly sessionsDir: string | null
}): Promise<StatsReport> {
  const receipts = await readReceipts(options.trackerDir)
  const states =
    options.trackerDir === null
      ? new Map<number, string>()
      : await issueStates(join(options.trackerDir, 'issues'))
  const passes: PassStat[] = []
  for (const receipt of receipts) {
    const minutes =
      options.sessionsDir === null
        ? null
        : await sessionMinutes(join(options.sessionsDir, basename(receipt.sessionLogPath)))
    passes.push({
      issue: receipt.issue,
      pass: receipt.pass,
      terminal: receipt.terminal,
      turns: receipt.turns,
      costUsd: receipt.costUsd ?? 0,
      activeMinutes: minutes,
    })
  }
  const byIssue = new Map<number, PassStat[]>()
  for (const pass of passes) byIssue.set(pass.issue, [...(byIssue.get(pass.issue) ?? []), pass])
  const issues: IssueStat[] = [...byIssue]
    .map(([issue, issuePasses]) => ({
      issue,
      passes: issuePasses.length,
      turns: issuePasses.reduce((sum, pass) => sum + pass.turns, 0),
      costUsd: issuePasses.reduce((sum, pass) => sum + pass.costUsd, 0),
      activeMinutes: issuePasses.reduce((sum, pass) => sum + (pass.activeMinutes ?? 0), 0),
      state: states.get(issue) ?? null,
    }))
    .sort((left, right) => left.issue - right.issue)
  const costs = issues.map((issue) => issue.costUsd)
  const minutes = issues.filter((issue) => issue.passes > 0).map((issue) => issue.activeMinutes)
  return {
    issues,
    totals: {
      issues: issues.length,
      passes: passes.length,
      turns: passes.reduce((sum, pass) => sum + pass.turns, 0),
      costUsd: passes.reduce((sum, pass) => sum + pass.costUsd, 0),
      activeMinutes: minutes.reduce((sum, value) => sum + value, 0),
      timedPasses: passes.filter((pass) => pass.activeMinutes !== null).length,
      meanCostUsd: mean(costs),
      medianCostUsd: median(costs),
      meanActiveMinutes: mean(minutes),
      medianActiveMinutes: median(minutes),
    },
  }
}

/** `basename` without importing `node:path` for one call. */
function basename(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? path : path.slice(cut + 1)
}

/** The text rendering: a table a person can read, and the totals under it. */
export function renderStats(report: StatsReport): string {
  const lines: string[] = []
  lines.push('issue  state     passes  turns    cost   active')
  for (const issue of report.issues) {
    const active = issue.activeMinutes > 0 ? `${issue.activeMinutes.toFixed(0)}m` : '—'
    lines.push(
      `${String(issue.issue).padStart(5)}  ${(issue.state ?? '—').padEnd(8)}  ${String(issue.passes).padStart(6)}  ${String(issue.turns).padStart(5)}  $${issue.costUsd.toFixed(2).padStart(6)}  ${active.padStart(6)}`,
    )
  }
  const total = report.totals
  lines.push('')
  lines.push(
    `${total.issues} issue(s), ${total.passes} pass(es), ${total.turns} turns, $${total.costUsd.toFixed(2)}` +
      ` — mean $${total.meanCostUsd.toFixed(2)} / median $${total.medianCostUsd.toFixed(2)} per issue`,
  )
  lines.push(
    `active: ${(total.activeMinutes / 60).toFixed(1)} h over ${total.timedPasses}/${total.passes} passes with a session log` +
      ` — mean ${total.meanActiveMinutes.toFixed(0)} min / median ${total.medianActiveMinutes.toFixed(0)} min per issue`,
  )
  return `${lines.join('\n')}\n`
}
