/**
 * Deterministic audit summariser for Treadle session logs — no LLM turns.
 *
 * Treadle's rule is that deterministic work runs in code, not inside LLM turns.
 * This script is the up-front half of an audit: it reads every session log's
 * JSONL event stream and produces compact, machine-derivable summaries so an
 * agent (or a human) never has to open a raw log to answer "what has the Loop
 * been doing and where did the money go".
 *
 * Usage:
 *   node scripts/audit-summary.ts [options] [sessionsDir ...]
 *
 *   sessionsDir     one or more .treadle/sessions dirs (default: ./.treadle/sessions)
 *   --out <dir>     where to write the JSON + MD (default: <sessionsDir>/../audit)
 *   --receipts      enrich from GitHub Receipt comments via gh (slug from origin)
 *   --log-dir <dir> enrich from a markdown tracker's log/<issue>/*.md receipt
 *                   files instead (what the forestbuilder loop uses); implied
 *                   enrichment, no --receipts needed
 *
 * Output: one MD table (stdout + file) and one JSON file with full per-session
 * detail. All numbers derive from the logs; --receipts only adds Receipt fields
 * (budget, checkpoint, official terminal/reason) where logs are absent.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { promisify } from 'node:util'

const sh = promisify(execFile)

/** gh is not always on a non-interactive ssh PATH; try the common homes. */
async function ghPath(): Promise<string> {
  for (const candidate of ['gh', '/opt/homebrew/bin/gh', '/usr/local/bin/gh']) {
    try {
      await sh(candidate, ['--version'])
      return candidate
    } catch {
      // try the next home
    }
  }
  throw new Error('gh not found (needed for --receipts)')
}

type ToolExec = { name: string; startTs: string }

type ReceiptLike = {
  issue: number
  pass: number
  budget: number
  terminal: string
  reason?: string
  turns: number
  costUsd?: number
  sessionLogPath: string
  checkpoint: string
}

type SessionSummary = {
  log: string
  issue: number | null
  pass: number | null
  startedAt: string | null
  endedAt: string | null
  durationMs: number
  turns: number
  model: string | null
  costUsd: number
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number }
  tools: Record<string, { count: number; ms: number }>
  bashCommandCount: number
  testRunCommands: string[]
  askHumanCalls: number
  nudges: number
  blockedQuestions: string[]
  errors: string[]
  terminal: string | null
  terminalReason: string | null
  lastAssistantText: string | null
  receipt: ReceiptLike | null
  flags: string[]
}

/** Commands that execute a test suite — what run_checks will own. */
const TEST_RUN =
  /\b(?:vitest|npx\s+vitest|pnpm(?:\s+\S+)?\s+test|npm\s+test|npm\s+run\s+test|yarn\s+test|node\s+--test|mocha|jest|playwright\s+test|pytest|go\s+test|cargo\s+test)\b/

type AssistantMessageLike = {
  role?: string
  model?: string
  stopReason?: string
  errorMessage?: string
  content?: Array<{
    type: string
    text?: string
    name?: string
    arguments?: { command?: string }
  }>
  usage?: {
    input?: number
    output?: number
    cacheRead?: number
    cacheWrite?: number
    totalTokens?: number
    cost?: { total?: number }
  }
}

const ISSUE_PASS = /issue-(\d+)-pass-(\d+)-/
const RECEIPT_BLOCK = /<!-- treadle:receipt\s*([\s\S]*?)\s*-->/

function asNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function textBlocks(message: AssistantMessageLike | undefined): string {
  if (!message?.content) return ''
  return message.content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n')
}

function issuePassOf(path: string): { issue: number | null; pass: number | null } {
  const match = ISSUE_PASS.exec(basename(path))
  return match ? { issue: Number(match[1]), pass: Number(match[2]) } : { issue: null, pass: null }
}

async function summarizeLog(path: string): Promise<SessionSummary> {
  const raw = await readFile(path, 'utf8')
  const { issue, pass } = issuePassOf(path)
  const summary: SessionSummary = {
    log: path,
    issue,
    pass,
    startedAt: null,
    endedAt: null,
    durationMs: 0,
    turns: 0,
    model: null,
    costUsd: 0,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    tools: {},
    bashCommandCount: 0,
    testRunCommands: [],
    askHumanCalls: 0,
    nudges: 0,
    blockedQuestions: [],
    errors: [],
    terminal: null,
    terminalReason: null,
    lastAssistantText: null,
    receipt: null,
    flags: [],
  }

  let firstTs: string | null = null
  let lastTs: string | null = null
  let lastModel: string | null = null
  const pending = new Map<string, ToolExec>()

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let row: { ts?: string; event?: Record<string, unknown> }
    try {
      row = JSON.parse(line)
    } catch {
      continue
    }
    const event = row.event ?? {}
    if (typeof row.ts === 'string') {
      if (!firstTs) firstTs = row.ts
      lastTs = row.ts
    }

    switch (event.type) {
      case 'turn_start': {
        summary.turns++
        break
      }
      case 'turn_end': {
        const message = event.message as AssistantMessageLike | undefined
        if (message?.role !== 'assistant') break
        if (typeof message.model === 'string') lastModel = message.model
        const usage = message.usage
        if (usage) {
          summary.costUsd += asNumber(usage.cost?.total)
          summary.tokens.input += asNumber(usage.input)
          summary.tokens.output += asNumber(usage.output)
          summary.tokens.cacheRead += asNumber(usage.cacheRead)
          summary.tokens.cacheWrite += asNumber(usage.cacheWrite)
          summary.tokens.total += asNumber(usage.totalTokens)
        }
        if (message.stopReason === 'error' && message.errorMessage) {
          summary.errors.push(message.errorMessage)
        }
        const text = textBlocks(message)
        if (text) summary.lastAssistantText = text
        for (const part of message.content ?? []) {
          if (part.type !== 'toolCall' || part.name !== 'bash') continue
          const command = part.arguments?.command
          if (typeof command !== 'string' || !command) continue
          summary.bashCommandCount++
          if (TEST_RUN.test(command)) summary.testRunCommands.push(command.slice(0, 200))
        }
        break
      }
      case 'tool_execution_start': {
        if (typeof event.toolCallId === 'string' && typeof event.toolName === 'string') {
          pending.set(event.toolCallId, { name: event.toolName, startTs: row.ts ?? '' })
          if (event.toolName === 'ask_human') summary.askHumanCalls++
        }
        break
      }
      case 'tool_execution_end': {
        const started =
          typeof event.toolCallId === 'string' ? pending.get(event.toolCallId) : undefined
        if (started) {
          pending.delete(event.toolCallId)
          const name = started.name
          const bucket = summary.tools[name] ?? { count: 0, ms: 0 }
          summary.tools[name] = bucket
          bucket.count++
          const start = Date.parse(started.startTs)
          const end = Date.parse(row.ts ?? '')
          if (Number.isFinite(start) && Number.isFinite(end)) bucket.ms += Math.max(0, end - start)
        }
        break
      }
      case 'session.started': {
        if (event.model?.id)
          lastModel = `${String(event.model.provider ?? '')}/${String(event.model.id)}`
        break
      }
      case 'session.blocked': {
        if (typeof event.question === 'string') summary.blockedQuestions.push(event.question)
        break
      }
      case 'session.nudge': {
        summary.nudges++
        break
      }
      case 'session.terminal': {
        const outcome = event.outcome ?? {}
        summary.terminal = typeof outcome.terminal === 'string' ? outcome.terminal : null
        summary.terminalReason = typeof outcome.reason === 'string' ? outcome.reason : null
        if (typeof outcome.costUsd === 'number') summary.costUsd = outcome.costUsd
        break
      }
      default:
        break
    }
  }

  summary.model = lastModel
  summary.startedAt = firstTs
  summary.endedAt = lastTs
  const start = firstTs ? Date.parse(firstTs) : NaN
  const end = lastTs ? Date.parse(lastTs) : NaN
  summary.durationMs = Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, end - start) : 0
  summary.errors = summary.errors.slice(0, 10)
  summary.blockedQuestions = summary.blockedQuestions.map((question) => question.slice(0, 300))
  summary.lastAssistantText = summary.lastAssistantText?.slice(0, 500) ?? null
  return summary
}

async function findLogs(dirs: string[]): Promise<string[]> {
  const logs: string[] = []
  for (const dir of dirs) {
    const entries = await readdir(dir)
    for (const entry of entries) {
      if (entry.endsWith('.jsonl') && ISSUE_PASS.test(entry)) logs.push(join(dir, entry))
    }
  }
  return logs.sort()
}

async function repoSlug(repoRoot: string): Promise<string | null> {
  try {
    const url = (await sh('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'])).stdout.trim()
    const ssh = url.match(/git@[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/)
    const https = url.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?(?:$|\/)/)
    return ssh?.[1] ?? https?.[1] ?? null
  } catch {
    return null
  }
}

/** Receipts from a markdown tracker's log/<issue>/*.md files (timestamped, #8). */
async function loadReceiptsFromLogDir(logDir: string): Promise<Map<string, ReceiptLike>> {
  const byLog = new Map<string, ReceiptLike>()
  const walk = async (dir: string): Promise<string[]> => {
    const files: string[] = []
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) files.push(...(await walk(path)))
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(path)
    }
    return files
  }
  for (const path of await walk(logDir)) {
    const match = RECEIPT_BLOCK.exec(await readFile(path, 'utf8'))
    if (!match) continue
    try {
      const receipt = JSON.parse(match[1]) as ReceiptLike
      if (typeof receipt.sessionLogPath === 'string') {
        byLog.set(basename(receipt.sessionLogPath), receipt)
      }
    } catch {
      // A malformed receipt says nothing; skip it.
    }
  }
  return byLog
}

/** Attach whatever receipts matched, and list the ones with no log on disk. */
async function applyReceipts(
  summaries: SessionSummary[],
  receipts: Map<string, ReceiptLike>,
  effectiveOut: string,
): Promise<void> {
  for (const session of summaries) {
    const receipt = receipts.get(basename(session.log))
    if (!receipt) continue
    session.receipt = receipt
    if (!session.terminal) {
      session.terminal = receipt.terminal
      session.terminalReason = receipt.reason ?? null
    }
    if (session.costUsd === 0 && typeof receipt.costUsd === 'number')
      session.costUsd = receipt.costUsd
  }
  const unmatched = [...receipts.keys()].filter(
    (name) => !summaries.some((s) => basename(s.log) === name),
  )
  if (unmatched.length > 0) {
    await writeFile(join(effectiveOut, 'receipts-without-logs.txt'), `${unmatched.join('\n')}\n`)
  }
}

async function loadReceipts(slug: string): Promise<Map<string, ReceiptLike>> {
  const byLog = new Map<string, ReceiptLike>()
  const gh = await ghPath()
  const { stdout } = await sh(gh, ['api', '--paginate', `repos/${slug}/issues/comments`], {
    maxBuffer: 256 * 1024 * 1024,
  })
  for (const comment of JSON.parse(stdout) as Array<{ body?: string }>) {
    const match = RECEIPT_BLOCK.exec(comment.body ?? '')
    if (!match) continue
    try {
      const receipt = JSON.parse(match[1]) as ReceiptLike
      if (typeof receipt.sessionLogPath === 'string') {
        byLog.set(basename(receipt.sessionLogPath), receipt)
      }
    } catch {
      // A malformed receipt says nothing; skip it.
    }
  }
  return byLog
}

function attachFlags(summaries: SessionSummary[]): void {
  const rank = (key: (session: SessionSummary) => number) =>
    [...summaries].sort((a, b) => key(b) - key(a)).slice(0, 3)
  for (const session of rank((s) => s.costUsd))
    if (session.costUsd > 0) session.flags.push('top-cost')
  for (const session of rank((s) => s.durationMs))
    if (session.durationMs > 0) session.flags.push('slowest')
  for (const session of rank((s) => s.turns))
    if (session.turns > 0) session.flags.push('most-turns')
  for (const session of summaries) {
    if (session.terminal === 'failed') session.flags.push('failed')
    if (session.terminal === 'blocked-on-human') session.flags.push('blocked-on-human')
    if (session.nudges > 0) session.flags.push('nudged')
    if (session.errors.some((error) => /402|insufficient|credit|quota/i.test(error))) {
      session.flags.push('provider-error')
    }
  }
}

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

function shortDuration(ms: number): string {
  if (ms >= 60_000) return `${String(Math.round(ms / 60_000))}m`
  return `${String(Math.round(ms / 1000))}s`
}

function cell(text: string): string {
  return text.replaceAll('|', '/').replaceAll('\n', ' ')
}

function renderMd(
  summaries: SessionSummary[],
  totals: {
    sessions: number
    costUsd: number
    turns: number
    tokens: number
  },
): string {
  const lines: string[] = []
  lines.push('# Treadle audit summary')
  lines.push('')
  lines.push(
    'Generated by scripts/audit-summary.ts (deterministic, no LLM) — ' +
      totals.sessions +
      ' sessions, ' +
      money(totals.costUsd) +
      ', ' +
      totals.turns +
      ' turns, ' +
      (totals.tokens / 1000).toFixed(0) +
      'k tokens.',
  )
  lines.push('')
  lines.push(
    '| issue/pass | terminal | reason | cost | turns | top tools | tests | ask | duration | flags |',
  )
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const session of summaries) {
    const label =
      session.issue !== null
        ? `${String(session.issue)}/${String(session.pass)}`
        : basename(session.log)
    const tools = Object.entries(session.tools)
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3)
      .map(([name, bucket]) => `${name}x${bucket.count}`)
      .join(' ')
    const reason = (session.terminalReason ?? '').slice(0, 80)
    lines.push(
      '| ' +
        cell(label) +
        ' | ' +
        cell(session.terminal ?? '?') +
        ' | ' +
        cell(reason) +
        ' | ' +
        money(session.costUsd) +
        ' | ' +
        session.turns +
        ' | ' +
        cell(tools) +
        ' | ' +
        session.testRunCommands.length +
        ' | ' +
        session.askHumanCalls +
        ' | ' +
        shortDuration(session.durationMs) +
        ' | ' +
        cell(session.flags.join(', ')) +
        ' |',
    )
  }
  lines.push('')

  const testRuns = new Map<string, number>()
  for (const session of summaries)
    for (const command of session.testRunCommands)
      testRuns.set(command, (testRuns.get(command) ?? 0) + 1)
  if (testRuns.size > 0) {
    lines.push('## Test-run commands (what run_checks would own)')
    lines.push('')
    for (const [command, count] of [...testRuns.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12))
      lines.push(`- ${count}x \`${command.replace(/\\/g, '\\\\').slice(0, 160)}\``)
    lines.push('')
  }

  const flagged = summaries.filter((session) => session.flags.length > 0)
  if (flagged.length > 0) {
    lines.push('## Flagged sessions')
    lines.push('')
    for (const session of flagged) {
      const label =
        session.issue !== null ? `#${session.issue} pass ${session.pass}` : basename(session.log)
      lines.push(`- **${label}** — ${session.flags.join(', ')}`)
      if (session.terminalReason) lines.push(`  - reason: ${session.terminalReason}`)
      for (const question of session.blockedQuestions) lines.push(`  - asked: ${question}`)
    }
    lines.push('')
  }

  const byIssue = new Map<number, SessionSummary[]>()
  for (const session of summaries) {
    if (session.issue === null) continue
    const bucket = byIssue.get(session.issue) ?? []
    bucket.push(session)
    byIssue.set(session.issue, bucket)
  }
  lines.push('## Per-issue rollup')
  lines.push('')
  lines.push('| issue | passes | cost | turns | terminals |')
  lines.push('|---|---|---|---|---|')
  for (const [issue, sessions] of [...byIssue.entries()].sort((a, b) => a[0] - b[0])) {
    const cost = sessions.reduce((sum, session) => sum + session.costUsd, 0)
    const turns = sessions.reduce((sum, session) => sum + session.turns, 0)
    const terminals = sessions.map((session) => session.terminal ?? '?').join(' ')
    lines.push(
      '| #' +
        issue +
        ' | ' +
        sessions.length +
        ' | ' +
        money(cost) +
        ' | ' +
        turns +
        ' | ' +
        cell(terminals) +
        ' |',
    )
  }
  return `${lines.join('\n')}\n`
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const dirs: string[] = []
  let outDir: string | null = null
  let logDir: string | null = null
  let wantReceipts = false
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--out') {
      index++
      outDir = resolve(argv[index])
    } else if (arg === '--log-dir') {
      index++
      logDir = resolve(argv[index])
    } else if (arg === '--receipts') {
      wantReceipts = true
    } else if (!arg.startsWith('--')) {
      dirs.push(resolve(arg))
    } else {
      throw new Error(`unknown option: ${arg}`)
    }
  }
  if (dirs.length === 0) dirs.push(resolve('.treadle/sessions'))
  const effectiveOut = outDir ?? join(dirs[0], '..', 'audit')
  await mkdir(effectiveOut, { recursive: true })

  const logs = await findLogs(dirs)
  if (logs.length === 0) throw new Error(`no session logs found in: ${dirs.join(', ')}`)

  const summaries: SessionSummary[] = []
  for (const log of logs) summaries.push(await summarizeLog(log))

  if (logDir) {
    try {
      await applyReceipts(summaries, await loadReceiptsFromLogDir(logDir), effectiveOut)
    } catch (error) {
      process.stderr.write(
        `--log-dir skipped: ${error instanceof Error ? error.message : String(error)}\n`,
      )
    }
  } else if (wantReceipts) {
    const repoRoot = resolve(dirs[0], '..', '..')
    const slug = await repoSlug(repoRoot)
    if (slug) {
      try {
        await applyReceipts(summaries, await loadReceipts(slug), effectiveOut)
      } catch (error) {
        process.stderr.write(
          `--receipts skipped: ${error instanceof Error ? error.message : String(error)}\n`,
        )
      }
    } else {
      process.stderr.write(`--receipts skipped: no origin slug for ${repoRoot}\n`)
    }
  }

  attachFlags(summaries)

  const totals = {
    sessions: summaries.length,
    costUsd: summaries.reduce((sum, session) => sum + session.costUsd, 0),
    turns: summaries.reduce((sum, session) => sum + session.turns, 0),
    tokens: summaries.reduce((sum, session) => sum + session.tokens.total, 0),
  }

  const stamp = new Date().toISOString().replaceAll(':', '-')
  const jsonPath = join(effectiveOut, `audit-summary-${stamp}.json`)
  const mdPath = join(effectiveOut, `audit-summary-${stamp}.md`)
  await writeFile(jsonPath, JSON.stringify({ totals, sessions: summaries }, null, 2))
  const md = renderMd(summaries, totals)
  await writeFile(mdPath, md)
  process.stdout.write(md)
  process.stdout.write(`\nJSON: ${jsonPath}\nMD:   ${mdPath}\n`)
}

await main()
