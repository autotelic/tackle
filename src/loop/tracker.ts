import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { LoopConfig } from '../config.ts'
import { BUDGET_RESET_MARKER, parseReceipt, type Receipt } from '../receipt.ts'
import { branchExists, gh, ghJson, git } from './git-exec.ts'
import {
  markdownComment,
  markdownIssueUrl,
  markdownListReady,
  markdownListWorking,
  markdownReadLabels,
  markdownReadReceiptHistory,
  markdownRelabel,
  markdownRemoveLabel,
} from './markdown-tracker.ts'

export { BUDGET_RESET_MARKER } from '../receipt.ts'
export { gh, ghJson, git } from './git-exec.ts'

/**
 * The issue-tracker surface (#17, ADR-0002). The Loop's tracker is selected
 * by `issues.tracker` in loop.config.ts: `github` (default; issues, labels
 * and comments via the gh CLI) or `markdown` (issues as markdown files in a
 * synced git repo — see docs/markdown-issues.md). Every function below
 * dispatches on the config; the two implementations agree on semantics, with
 * GitHub's shapes (labels, blockedBy nodes, open/closed states) as the
 * common vocabulary.
 */

export type Issue = {
  number: number
  title: string
  body: string
  /**
   * Stacked-PR base (#17): which ref/issue this issue branches from.
   * undefined → the repo's default branch; a number (or numeric string) →
   * that issue's loop/<n> branch; any other string → a git ref ('develop',
   * 'origin/x'). GitHub issues declare it with a `Base: <ref>` body line,
   * markdown issues with `base:` frontmatter.
   */
  base?: number | string
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

/** Parse a `Base: <ref>` line out of an issue body (#17). */
export function parseBaseFromBody(body: string): number | string | undefined {
  const value = body.match(/^base:\s*(\S+)\s*$/im)?.[1]
  if (value === undefined) return undefined
  if (/^\d+$/.test(value)) return Number.parseInt(value, 10)
  return value
}

function withParsedBase(issue: Issue): Issue {
  const base = parseBaseFromBody(issue.body)
  return base === undefined ? issue : { ...issue, base }
}

/**
 * Normalize an issue's declared base against what's actually merged (#17):
 * a numeric base whose issue is closed (merged/done) means the stack below
 * has landed — the issue branches from the default branch instead.
 */
export function normalizeBase(issue: Issue, closedNumbers: Set<number>): Issue {
  if (typeof issue.base === 'number' && closedNumbers.has(issue.base)) {
    const { base: _base, ...rest } = issue
    return rest
  }
  return issue
}

// ── GitHub implementation ───────────────────────────────────────────────

async function githubListReady(repoDir: string, readyLabel: string): Promise<Issue[]> {
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
  const withBases = issues.map(withParsedBase)
  // One extra call, only when a ready issue declares a numeric base.
  const closedNumbers = withBases.some((issue) => typeof issue.base === 'number')
    ? new Set(
        (
          await ghJson<{ number: number }[]>(
            repoDir,
            'issue',
            'list',
            '--state',
            'closed',
            '--json',
            'number',
            '--limit',
            '100',
          )
        ).map((issue) => issue.number),
      )
    : new Set<number>()
  const ready: Issue[] = []
  for (const issue of withBases.map((i) => normalizeBase(i, closedNumbers))) {
    if (hasOpenBlocker(issue)) continue
    // Stacking gate (#17): a numeric base branches from that issue's
    // loop/<n> branch, so the issue can't start until the base issue has.
    if (typeof issue.base === 'number' && !(await branchExists(repoDir, `loop/${issue.base}`)))
      continue
    ready.push(issue)
  }
  return ready.sort((a, b) => a.number - b.number)
}

async function githubListWorking(repoDir: string, workingLabel: string): Promise<Issue[]> {
  const issues = await ghJson<Issue[]>(
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
  return issues.map(withParsedBase)
}

async function githubRelabel(
  repoDir: string,
  issue: number,
  remove: string,
  add: string,
): Promise<void> {
  await gh(repoDir, 'issue', 'edit', String(issue), '--remove-label', remove, '--add-label', add)
}

async function githubRemoveLabel(repoDir: string, issue: number, label: string): Promise<void> {
  await gh(repoDir, 'issue', 'edit', String(issue), '--remove-label', label)
}

async function githubComment(repoDir: string, issue: number, body: string): Promise<void> {
  await gh(repoDir, 'issue', 'comment', String(issue), '--body', body)
}

async function githubIssueUrl(repoDir: string, issue: number): Promise<string | null> {
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

async function githubReadLabels(repoDir: string, issue: number): Promise<string[]> {
  return ghJson<string[]>(
    repoDir,
    'issue',
    'view',
    String(issue),
    '--json',
    'labels',
    '--jq',
    '[.labels[].name]',
  )
}

/**
 * Receipts from an issue's comments (#8): how budgets and stall history are
 * recovered after a restart. A Retry with a hint starts a fresh budget (#9):
 * receipts before the latest reset marker are history, not budget.
 */
async function githubReadReceiptHistory(repoDir: string, issue: number): Promise<Receipt[]> {
  const result = await ghJson<{ comments: { body: string }[] }>(
    repoDir,
    'issue',
    'view',
    String(issue),
    '--json',
    'comments',
  )
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

// ── Dispatch ────────────────────────────────────────────────────────────

function markdownDir(config: LoopConfig): string {
  const dir = config.issues.dir
  if (!dir) throw new Error('markdown tracker selected but issues.dir is not set')
  return dir
}

/** The queue: open ready issues with no open blockers, lowest number first. */
export async function listReadyIssues(repoDir: string, config: LoopConfig): Promise<Issue[]> {
  if (config.issues.tracker === 'markdown')
    return markdownListReady(repoDir, markdownDir(config), config.issues.ready)
  return githubListReady(repoDir, config.issues.ready)
}

export async function listWorkingIssues(repoDir: string, config: LoopConfig): Promise<Issue[]> {
  if (config.issues.tracker === 'markdown')
    return markdownListWorking(markdownDir(config), config.issues.working)
  return githubListWorking(repoDir, config.issues.working)
}

export async function relabel(
  repoDir: string,
  config: LoopConfig,
  issue: number,
  remove: string,
  add: string,
): Promise<void> {
  if (config.issues.tracker === 'markdown')
    return markdownRelabel(markdownDir(config), issue, remove, add)
  return githubRelabel(repoDir, issue, remove, add)
}

export async function removeLabel(
  repoDir: string,
  config: LoopConfig,
  issue: number,
  label: string,
): Promise<void> {
  if (config.issues.tracker === 'markdown')
    return markdownRemoveLabel(markdownDir(config), issue, label)
  return githubRemoveLabel(repoDir, issue, label)
}

export async function comment(
  repoDir: string,
  config: LoopConfig,
  issue: number,
  body: string,
): Promise<void> {
  if (config.issues.tracker === 'markdown') return markdownComment(markdownDir(config), issue, body)
  return githubComment(repoDir, issue, body)
}

export async function issueUrl(
  repoDir: string,
  config: LoopConfig,
  issue: number,
): Promise<string | null> {
  if (config.issues.tracker === 'markdown') return markdownIssueUrl(markdownDir(config), issue)
  return githubIssueUrl(repoDir, issue)
}

export async function readLabels(
  repoDir: string,
  config: LoopConfig,
  issue: number,
): Promise<string[]> {
  if (config.issues.tracker === 'markdown') return markdownReadLabels(markdownDir(config), issue)
  return githubReadLabels(repoDir, issue)
}

/** Receipts from the issue's history (#8): comments on GitHub, log files on markdown. */
export async function readReceiptHistory(
  repoDir: string,
  config: LoopConfig,
  issue: number,
): Promise<Receipt[]> {
  if (config.issues.tracker === 'markdown')
    return markdownReadReceiptHistory(markdownDir(config), issue)
  return githubReadReceiptHistory(repoDir, issue)
}

// ── Base resolution (#17, stacked PRs) ──────────────────────────────────

export type BaseRef = {
  /** Ref to branch the worktree from and diff against (e.g. origin/develop, loop/3). */
  ref: string
  /** Branch name for `gh pr create --base` (e.g. develop, loop/3). */
  name: string
}

/**
 * What the issue's branch starts from: an explicit `base` (a number or
 * numeric string → that issue's loop/<n> branch; anything else → the ref as
 * given); otherwise the integration branch when one is configured
 * (ADR-0003's feature-branch shift); otherwise the repo's own default branch
 * (origin/HEAD, falling back to origin/main, then main).
 */
export async function resolveBaseRef(
  repoDir: string,
  issue: Issue,
  integrationBranch?: string,
): Promise<BaseRef> {
  if (issue.base !== undefined) {
    const issueNumber =
      typeof issue.base === 'number'
        ? issue.base
        : /^\d+$/.test(issue.base.trim())
          ? Number.parseInt(issue.base.trim(), 10)
          : undefined
    if (issueNumber !== undefined)
      return { ref: `loop/${issueNumber}`, name: `loop/${issueNumber}` }
    const base = String(issue.base)
    return { ref: base, name: base.replace(/^origin\//, '') }
  }
  if (integrationBranch) return { ref: `origin/${integrationBranch}`, name: integrationBranch }
  const head = await git(
    repoDir,
    'symbolic-ref',
    '--quiet',
    '--short',
    'refs/remotes/origin/HEAD',
  ).then(
    (value) => value,
    () => '',
  )
  if (head) return { ref: head, name: head.replace(/^origin\//, '') }
  // origin/HEAD unset (a fresh or fetch-only clone): ask the remote itself.
  const lsRemote = await git(repoDir, 'ls-remote', '--symref', 'origin', 'HEAD').then(
    (value) => value,
    () => '',
  )
  const remoteBranch = lsRemote.match(/^ref: refs\/heads\/(\S+)\s+HEAD$/m)?.[1]
  if (remoteBranch) return { ref: `origin/${remoteBranch}`, name: remoteBranch }
  const hasMain = await git(repoDir, 'rev-parse', '--verify', 'origin/main').then(
    () => true,
    () => false,
  )
  return hasMain ? { ref: 'origin/main', name: 'main' } : { ref: 'main', name: 'main' }
}

// ── The work-present guard (#9's Feature done) ──────────────────────────

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
