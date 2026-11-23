/**
 * The markdown tracker (#17, ADR-0002): issues as markdown files with
 * frontmatter in a directory — usually a git repo the Loop syncs before
 * reading and after every write. Receipts and notes are timestamped files
 * under log/<issue>/. Humans own the issue files; the Loop owns log/ and the
 * `state:` frontmatter line, so offline syncs merge cleanly.
 * See docs/markdown-issues.md.
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { BUDGET_RESET_MARKER, parseReceipt, type Receipt } from '../receipt.ts'
import { branchExists, git } from './git-exec.ts'
import type { Issue } from './tracker.ts'

type FrontmatterValue = string | number | Array<string | number>

/**
 * A deliberately small frontmatter reader: `key: value` scalars and
 * `[a, b]` inline arrays. Unquoted values may carry a trailing `# comment`.
 */
export function parseFrontmatter(text: string): {
  attrs: Record<string, FrontmatterValue>
  body: string
} {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match?.[1]) return { attrs: {}, body: text }
  const attrs: Record<string, FrontmatterValue> = {}
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!kv?.[1] || kv[2] === undefined) continue
    const raw = kv[2].trim()
    if (raw === '') continue
    if (raw.startsWith('[') && raw.endsWith(']')) {
      const items = raw
        .slice(1, -1)
        .split(',')
        .map((item) => scalar(item.trim()))
        .filter((item): item is string | number => item !== undefined)
      attrs[kv[1]] = items
      continue
    }
    const value = scalar(raw)
    if (value !== undefined) attrs[kv[1]] = value
  }
  return { attrs, body: text.slice(match[0].length) }
}

function scalar(raw: string): string | number | undefined {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1)
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) return raw.slice(1, -1)
  // Unquoted: a trailing comment is not part of the value.
  const value = raw.replace(/\s+#.*$/, '')
  if (value === '') return undefined
  if (/^-?\d+$/.test(value)) return Number.parseInt(value, 10)
  return value
}

/** A numeric-looking base names another issue ("stack on loop/<n>"). */
function baseAsIssueNumber(base: FrontmatterValue | undefined): number | undefined {
  if (typeof base === 'number') return base
  if (typeof base === 'string' && /^\d+$/.test(base.trim())) return Number.parseInt(base.trim(), 10)
  return undefined
}

export type IssueFile = {
  number: number
  path: string
  title: string
  /** The markdown body with frontmatter stripped — what Sessions work from. */
  body: string
  state?: string
  base?: string | number
  blockedBy: number[]
}

/** Read every issue file in <dir>/issues/ (`<number>-<slug>.md`). */
export async function readIssueFiles(dir: string): Promise<IssueFile[]> {
  const issuesDir = join(dir, 'issues')
  let names: string[]
  try {
    names = await readdir(issuesDir)
  } catch {
    return []
  }
  const files: IssueFile[] = []
  for (const name of names.sort()) {
    const match = name.match(/^(\d+)-.+\.md$/)
    if (!match?.[1]) continue
    const number = Number.parseInt(match[1], 10)
    const path = join(issuesDir, name)
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      continue
    }
    const { attrs, body } = parseFrontmatter(text)
    const blockedRaw = attrs.blocked_by
    const blockedValues = Array.isArray(blockedRaw)
      ? blockedRaw
      : blockedRaw !== undefined
        ? [blockedRaw]
        : []
    const state = attrs.state
    const base = attrs.base
    files.push({
      number,
      path,
      title:
        typeof attrs.title === 'string'
          ? attrs.title
          : (headingOf(body) ??
            name.replace(/^\d+-/, '').replace(/\.md$/, '').replaceAll('-', ' ')),
      body,
      ...(typeof state === 'string' ? { state } : {}),
      ...(typeof base === 'string' || typeof base === 'number' ? { base } : {}),
      blockedBy: blockedValues
        .map((value) => baseAsIssueNumber(value))
        .filter((value): value is number => value !== undefined),
    })
  }
  const seen = new Set<number>()
  for (const file of files) {
    if (seen.has(file.number))
      console.warn(`markdown tracker: duplicate issue number ${file.number} (${file.path})`)
    seen.add(file.number)
  }
  return files
}

function headingOf(body: string): string | undefined {
  const match = body.match(/^#\s+(.+)$/m)
  return match?.[1]?.trim()
}

function toIssue(file: IssueFile, byNumber: Map<number, IssueFile>): Issue {
  return {
    number: file.number,
    title: file.title,
    body: file.body,
    ...(file.base !== undefined ? { base: file.base } : {}),
    blockedBy: {
      // A blocker is open until its file says `state: done`; a missing
      // reference blocks (conservative — same shape as GitHub's truncated
      // blockedBy falling back to totalCount).
      nodes: file.blockedBy.map((n) => ({
        number: n,
        state: byNumber.get(n)?.state === 'done' ? 'CLOSED' : 'OPEN',
      })),
      totalCount: file.blockedBy.length,
    },
  }
}

/**
 * A working issue whose numeric base is done (merged) drops the base: the
 * stack has landed below it, so diffs and any new PR resolve against the
 * integration/default branch. Without this, a re-entered stacked issue
 * whose parent branch was deleted after the merge crashes on the dead ref
 * (the ready queue already normalizes this — the working queue must too).
 */
function normalizeDoneBase(issue: Issue, byNumber: Map<number, IssueFile>): Issue {
  const baseNumber = typeof issue.base === 'number' ? issue.base : undefined
  if (baseNumber !== undefined && byNumber.get(baseNumber)?.state === 'done') {
    delete issue.base
  }
  return issue
}

/** The queue: `state: ready`, no open blockers, lowest number first. */
export async function markdownListReady(
  repoDir: string,
  dir: string,
  readyLabel: string,
): Promise<Issue[]> {
  await syncPull(dir)
  const files = await readIssueFiles(dir)
  const byNumber = new Map(files.map((file) => [file.number, file]))
  const ready: Issue[] = []
  for (const file of files) {
    if (file.state !== readyLabel) continue
    if (file.blockedBy.some((n) => byNumber.get(n)?.state !== 'done')) continue
    const issue = toIssue(file, byNumber)
    const baseNumber = baseAsIssueNumber(file.base)
    if (baseNumber !== undefined && byNumber.get(baseNumber)?.state === 'done') {
      // The base issue is merged (done): the stack has landed below this
      // issue, so it branches from the default branch — no gate.
      delete issue.base
      ready.push(issue)
      continue
    }
    // Stacking gate (#17): a numeric base branches from that issue's
    // loop/<n> branch, so the issue can't start until the base issue has.
    if (baseNumber !== undefined && !(await branchExists(repoDir, `loop/${baseNumber}`))) continue
    ready.push(issue)
  }
  return ready.sort((a, b) => a.number - b.number)
}

export async function markdownListWorking(dir: string, workingLabel: string): Promise<Issue[]> {
  await syncPull(dir)
  const files = await readIssueFiles(dir)
  const byNumber = new Map(files.map((file) => [file.number, file]))
  return files
    .filter((file) => file.state === workingLabel)
    .map((file) => normalizeDoneBase(toIssue(file, byNumber), byNumber))
}

async function findIssueFile(dir: string, issue: number): Promise<IssueFile | undefined> {
  const files = await readIssueFiles(dir)
  return files.find((file) => file.number === issue)
}

export async function markdownRelabel(
  dir: string,
  issue: number,
  _remove: string,
  add: string,
): Promise<void> {
  const file = await findIssueFile(dir, issue)
  if (!file) throw new Error(`markdown tracker: no issue file for #${issue}`)
  const text = await readFile(file.path, 'utf8')
  await writeFile(file.path, setState(text, add))
  await commitAndPush(dir, `treadle: #${issue} → ${add}`)
}

/**
 * The Loop clears the state once the PR is open (#5): a stateless issue is
 * out of every queue but still blocks its dependents until a person marks it
 * `state: done` — the same shape as GitHub's label-less open issue.
 */
export async function markdownRemoveLabel(
  dir: string,
  issue: number,
  _label: string,
): Promise<void> {
  const file = await findIssueFile(dir, issue)
  if (!file) return
  const text = await readFile(file.path, 'utf8')
  await writeFile(file.path, removeState(text))
  await commitAndPush(dir, `treadle: #${issue} state cleared (PR open)`)
}

export async function markdownComment(dir: string, issue: number, body: string): Promise<void> {
  const logDir = join(dir, 'log', String(issue).padStart(3, '0'))
  await mkdir(logDir, { recursive: true })
  // The suffix keeps same-millisecond writes from colliding; the fixed-width
  // ISO timestamp prefix keeps filename sort chronological.
  await writeFile(join(logDir, `${stamp()}-${Math.random().toString(36).slice(2, 8)}.md`), body)
  await commitAndPush(dir, `treadle: note on #${issue}`)
}

/** The issue's "labels": its single state value, or none. */
export async function markdownReadLabels(dir: string, issue: number): Promise<string[]> {
  const file = await findIssueFile(dir, issue)
  return file?.state !== undefined ? [file.state] : []
}

/** The issue file's absolute path — the markdown-tracker analogue of a URL. */
export async function markdownIssueUrl(dir: string, issue: number): Promise<string | null> {
  const file = await findIssueFile(dir, issue)
  return file?.path ?? null
}

/**
 * Receipts from an issue's log files (#8): filename timestamps sort
 * chronologically, the budget-reset marker truncates history (#9), exactly
 * as issue comments do on the GitHub tracker.
 */
export async function markdownReadReceiptHistory(dir: string, issue: number): Promise<Receipt[]> {
  const logDir = join(dir, 'log', String(issue).padStart(3, '0'))
  let names: string[]
  try {
    names = await readdir(logDir)
  } catch {
    return []
  }
  const bodies: string[] = []
  for (const name of names.filter((n) => n.endsWith('.md')).sort()) {
    try {
      bodies.push(await readFile(join(logDir, name), 'utf8'))
    } catch {
      // Partially written; skip it this cycle.
    }
  }
  let resetAt = -1
  for (const [i, body] of bodies.entries()) {
    if (body.includes(BUDGET_RESET_MARKER)) resetAt = i
  }
  const receipts: Receipt[] = []
  for (const body of bodies.slice(resetAt + 1)) {
    const receipt = parseReceipt(body)
    if (receipt) receipts.push(receipt)
  }
  return receipts.sort((a, b) => a.pass - b.pass)
}

/** Set the `state:` line, preserving everything else in the file. */
export function setState(text: string, state: string): string {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return `---\nstate: ${state}\n---\n\n${text}`
  const lines = (match[1] ?? '').split('\n')
  const index = lines.findIndex((line) => /^state\s*:/.test(line))
  const next =
    index >= 0
      ? [...lines.slice(0, index), `state: ${state}`, ...lines.slice(index + 1)]
      : [`state: ${state}`, ...lines]
  return `---\n${next.join('\n')}\n---\n${text.slice(match[0].length)}`
}

/** Remove the `state:` line; drop the frontmatter block if nothing else remains. */
export function removeState(text: string): string {
  const match = text.match(/^---\n([\s\S]*?)\n---\n?/)
  if (!match) return text
  const kept = (match[1] ?? '').split('\n').filter((line) => !/^state\s*:/.test(line))
  const rest = text.slice(match[0].length)
  if (kept.every((line) => line.trim().length === 0)) return rest.replace(/^\n/, '')
  return `---\n${kept.join('\n')}\n---\n${rest}`
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

async function isGitRepo(dir: string): Promise<boolean> {
  return await git(dir, 'rev-parse', '--git-dir').then(
    () => true,
    () => false,
  )
}

async function upstreamOf(dir: string): Promise<string | null> {
  const upstream = await git(
    dir,
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ).then(
    (value) => value,
    () => '',
  )
  return upstream.length > 0 ? upstream : null
}

/**
 * Pull the tracker repo (#17). Offline-tolerant: a failed fetch keeps the
 * local state — the local clone is the truth until the laptop's edits can
 * reach the bare repo again. A diverged upstream (a laptop push raced the
 * Loop's) is rebased; loop-written files are disjoint from human edits by
 * convention, so the rebase applies.
 */
export async function syncPull(dir: string): Promise<void> {
  if (!(await isGitRepo(dir))) return
  const upstream = await upstreamOf(dir)
  if (!upstream) return
  await git(dir, 'fetch').catch(() => undefined)
  try {
    await git(dir, 'merge', '--ff-only', upstream)
  } catch {
    await git(dir, 'rebase', '--autostash', upstream).catch((error: unknown) => {
      console.warn(`markdown tracker sync failed, continuing with local state: ${String(error)}`)
    })
  }
}

/** Commit and push tracker-repo writes (#8: state is written as it happens). */
export async function commitAndPush(dir: string, message: string): Promise<void> {
  if (!(await isGitRepo(dir))) return
  const status = await git(dir, 'status', '--porcelain')
  if (status.length === 0) return
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-m', message)
  if (await upstreamOf(dir)) {
    await git(dir, 'push').catch((error: unknown) => {
      console.warn(`markdown tracker push failed (the next write retries): ${String(error)}`)
    })
  }
}
