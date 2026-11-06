import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { parseReceipt, type Receipt } from '../receipt.ts'

const execFileAsync = promisify(execFile)

/** GitHub/git operations for the Loop — the state store (#8). */

export async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd })
  return stdout.trim()
}

export async function gh(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('gh', args, { cwd })
  return stdout.trim()
}

export async function ghJson<T>(cwd: string, ...args: string[]): Promise<T> {
  return JSON.parse(await gh(cwd, ...args)) as T
}

export type Issue = {
  number: number
  title: string
  body: string
  blockedBy?: { nodes: { number: number; state: string }[]; totalCount: number }
}

/**
 * GitHub's native blocking edges (#9's "no open blockers"): an issue is
 * blocked while any issue that blocks it is still open. Treadle depends on
 * the GitHub primitive only — whoever declared the edge.
 */
export function hasOpenBlocker(issue: Issue): boolean {
  const blockedBy = issue.blockedBy
  if (!blockedBy) return false
  if (blockedBy.nodes.length > 0) return blockedBy.nodes.some((node) => node.state === 'OPEN')
  return blockedBy.totalCount > 0
}

/** The queue: open ready issues with no open blockers, lowest number first. */
export async function listReadyIssues(repoDir: string, readyLabel: string): Promise<Issue[]> {
  const issues = await ghJson<Issue[]>(
    repoDir,
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    readyLabel,
    '--json',
    'number,title,body,blockedBy',
    '--limit',
    '50',
  )
  return issues.filter((issue) => !hasOpenBlocker(issue)).sort((a, b) => a.number - b.number)
}

export async function listWorkingIssues(repoDir: string, workingLabel: string): Promise<Issue[]> {
  return ghJson<Issue[]>(
    repoDir,
    'issue',
    'list',
    '--state',
    'open',
    '--label',
    workingLabel,
    '--json',
    'number,title,body',
    '--limit',
    '50',
  )
}

export async function relabel(
  repoDir: string,
  issue: number,
  remove: string,
  add: string,
): Promise<void> {
  await gh(repoDir, 'issue', 'edit', String(issue), '--remove-label', remove, '--add-label', add)
}

export async function removeLabel(repoDir: string, issue: number, label: string): Promise<void> {
  await gh(repoDir, 'issue', 'edit', String(issue), '--remove-label', label)
}

export async function comment(repoDir: string, issue: number, body: string): Promise<void> {
  await gh(repoDir, 'issue', 'comment', String(issue), '--body', body)
}

export async function issueUrl(repoDir: string, issue: number): Promise<string | null> {
  const nwo = await gh(
    repoDir,
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '--jq',
    '.nameWithOwner',
  ).then(
    (s) => s.trim(),
    () => null,
  )
  return nwo ? `https://github.com/${nwo}/issues/${issue}` : null
}

/**
 * Receipts from an issue's comments (#8): how budgets and stall history are
 * recovered after a restart.
 */
/** Hidden marker the Retry escalation posts: budgets count from here (#9). */
export const BUDGET_RESET_MARKER = '<!-- treadle:budget-reset -->'

export async function readReceiptHistory(repoDir: string, issue: number): Promise<Receipt[]> {
  const result = await ghJson<{ comments: { body: string }[] }>(
    repoDir,
    'issue',
    'view',
    String(issue),
    '--json',
    'comments',
  )
  // A Retry with a hint starts a fresh budget (#9): receipts before the
  // latest reset marker are history, not budget.
  let resetAt = -1
  for (const [i, { body }] of result.comments.entries()) {
    if (body.includes(BUDGET_RESET_MARKER)) resetAt = i
  }
  const receipts: Receipt[] = []
  for (const { body } of result.comments.slice(resetAt + 1)) {
    const receipt = parseReceipt(body)
    if (receipt) receipts.push(receipt)
  }
  return receipts.sort((a, b) => a.pass - b.pass)
}

/**
 * Work present (#9's Feature done guard): the branch changes code in
 * featureDone.changedPaths and (when requireNewTests) the unit test report
 * counts more tests than the base branch's.
 */
export async function workPresent(options: {
  repoDir: string
  worktreeDir: string
  baseRef: string
  changedPaths: string[]
  requireNewTests: boolean
  unitReportPath: string
}): Promise<{ present: boolean; detail: string }> {
  const diff = await git(
    options.worktreeDir,
    'diff',
    '--name-only',
    `${options.baseRef}...HEAD`,
    '--',
    ...options.changedPaths,
  )
  if (diff.length === 0) {
    return { present: false, detail: `no changes in ${options.changedPaths.join(', ')}` }
  }
  if (!options.requireNewTests) return { present: true, detail: 'code changes present' }

  const current = await countTests(join(options.worktreeDir, options.unitReportPath))
  const base = await countTests(join(options.repoDir, options.unitReportPath))
  if (current === null) return { present: false, detail: 'no unit test report on the branch' }
  if (base !== null && current <= base) {
    return { present: false, detail: `test count did not grow (${base} → ${current})` }
  }
  return { present: true, detail: `code changes + tests grew (${base ?? '?'} → ${current})` }
}

async function countTests(reportPath: string): Promise<number | null> {
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8')) as { numTotalTests?: number }
    return typeof report.numTotalTests === 'number' ? report.numTotalTests : null
  } catch {
    return null
  }
}
