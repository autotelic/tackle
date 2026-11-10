import { execFile } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { Effect } from 'effect'
import { runChecks } from '../checks.ts'
import type { LoopConfig } from '../config.ts'
import type { HumanChannel } from '../human-channel.ts'
import { buildSessionPrompt } from '../prompt.ts'
import { type Receipt, renderReceipt } from '../receipt.ts'
import type { CheckReport, FailureSetEntry } from '../report.ts'
import { runSession, type SessionOutcome } from '../session.ts'
import { extractHandoff } from './distill.ts'
import type { NightlyBudget } from './nightly.ts'
import { isProviderFailure } from './provider.ts'
import { isStalled, matchRule, type RuleContext } from './rules.ts'
import {
  comment,
  gh,
  git,
  type Issue,
  issueUrl,
  listReadyIssues,
  readReceiptHistory,
  relabel,
  removeLabel,
  resolveBaseRef,
  workPresent,
} from './tracker.ts'

const execFileAsync = promisify(execFile)

/**
 * One issue's Pass loop as an Effect program (#15). The parent machine invokes
 * this per issue; it owns budgets, stall detection, the rules table (#6), the
 * Feature done guard, parking, and Pause/retry on infrastructure failures
 * (#9). Re-entry after a restart recovers budgets and history from the
 * issue's Receipts (#8). Escalation on park is the parent's job (it must
 * outlive this program).
 */

export type IssueLoopResult =
  | { kind: 'pr-ready'; issue: number; passesUsed: number }
  | {
      kind: 'parked'
      issue: number
      passesUsed: number
      reason: 'budget' | 'stalled' | 'blocked' | 'no-rule'
    }
  | { kind: 'stopped-cap'; issue: number; passesUsed: number }

export type IssueLoopDeps = {
  repoDir: string
  config: LoopConfig
  issue: Issue
  human: HumanChannel
  /** Telegram notices to Ed (pause/resume, PR ready, baseline trouble). */
  notify: (text: string) => Promise<void>
  /** Loop-wide nightly budget (#9 counts Passes; #18 makes it durable and adds dollars). */
  passesTonight: NightlyBudget
  /** Re-entering a working issue after a restart: the branch already exists. */
  resume?: boolean
  /** Injectable for tests. */
  runSessionFn?: typeof runSession
  runChecksFn?: typeof runChecks
  sleepFn?: (ms: number) => Effect.Effect<void>
}

const INFRA_BACKOFF_MINUTES = [1, 5, 15]
const PROBE_MINUTES = 15

function qaPath(repoDir: string, issue: number): string {
  return join(repoDir, '.treadle', 'qa', `issue-${issue}.jsonl`)
}

export async function appendQa(
  repoDir: string,
  issue: number,
  entry: { question: string; answer?: string },
): Promise<void> {
  const path = qaPath(repoDir, issue)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`)
}

/** The latest pass log for an issue (re-entry distillation); probes excluded. */
export async function latestSessionLog(treadleDir: string, issue: number): Promise<string | null> {
  try {
    const names = await readdir(join(treadleDir, 'sessions'))
    const mine = names
      .filter((name) => name.startsWith(`issue-${issue}-pass-`) && !name.includes('probe'))
      .sort()
    return mine.length > 0 ? join(treadleDir, 'sessions', mine[mine.length - 1] as string) : null
  } catch {
    return null
  }
}

async function readQa(
  repoDir: string,
  issue: number,
): Promise<{ question: string; answer?: string }[]> {
  try {
    const text = await readFile(qaPath(repoDir, issue), 'utf8')
    return text
      .trim()
      .split('\n')
      .filter((l) => l.length > 0)
      .map((l) => JSON.parse(l) as { question: string; answer?: string })
  } catch {
    return []
  }
}

/** Retry Checks on infrastructure failure with backoff, then Pause and probe (#9). */
function checksWithPause(args: {
  run: () => Promise<CheckReport>
  notify: (text: string) => Promise<void>
  issue: number
  sleepFn: (ms: number) => Effect.Effect<void>
}): Effect.Effect<CheckReport, Error> {
  const minute = 60_000
  return Effect.gen(function* () {
    let report = yield* Effect.tryPromise(() => args.run())
    let attempt = 0
    while (report.infrastructureFailure && attempt < INFRA_BACKOFF_MINUTES.length) {
      const waitMinutes = INFRA_BACKOFF_MINUTES[attempt] as number
      yield* Effect.tryPromise(() =>
        args.notify(
          `Infrastructure failure on issue #${args.issue} (${report.infrastructureFailure?.kind}). ` +
            `Retrying in ${waitMinutes} min.`,
        ),
      )
      yield* args.sleepFn(waitMinutes * minute)
      report = yield* Effect.tryPromise(() => args.run())
      attempt += 1
    }
    if (report.infrastructureFailure) {
      yield* Effect.tryPromise(() =>
        args.notify(
          `Treadle PAUSED: ${report.infrastructureFailure?.detail}. ` +
            `Probing every ${PROBE_MINUTES} min; no Passes until it recovers.`,
        ),
      )
      while (report.infrastructureFailure) {
        yield* args.sleepFn(PROBE_MINUTES * minute)
        report = yield* Effect.tryPromise(() => args.run())
      }
      yield* Effect.tryPromise(() => args.notify('Treadle resumed: the harness is healthy again.'))
    }
    return report
  })
}

/**
 * Sessions get the same #9 treatment as Checks: a provider failure retries
 * the Pass with backoff (1, 5, 15 min), then the Loop Pauses — no Passes,
 * a cheap probe Session every 15 minutes, a message on pause and resume.
 * Only a non-provider outcome reaches the caller, so infra never burns
 * the issue budget or the nightly cap.
 */
function sessionWithPause(args: {
  run: () => Promise<SessionOutcome>
  probe: () => Promise<boolean>
  notify: (text: string) => Promise<void>
  issue: number
  sleepFn: (ms: number) => Effect.Effect<void>
}): Effect.Effect<SessionOutcome, Error> {
  const minute = 60_000
  return Effect.gen(function* () {
    let outcome = yield* Effect.tryPromise(() => args.run())
    let retries = 0
    let paused = false
    while (isProviderFailure(outcome.reason)) {
      if (retries < INFRA_BACKOFF_MINUTES.length) {
        const waitMinutes = INFRA_BACKOFF_MINUTES[retries] as number
        yield* Effect.tryPromise(() =>
          args.notify(
            `Provider failure on issue #${args.issue} (${outcome.reason?.slice(0, 120)}). ` +
              `Retrying the Pass in ${waitMinutes} min.`,
          ),
        )
        retries += 1
        yield* args.sleepFn(waitMinutes * minute)
      } else {
        if (!paused) {
          yield* Effect.tryPromise(() =>
            args.notify(
              `Treadle PAUSED: the provider keeps failing (${outcome.reason?.slice(0, 120)}). ` +
                `Probing every ${PROBE_MINUTES} min; no budget is being spent.`,
            ),
          )
          paused = true
        }
        yield* args.sleepFn(PROBE_MINUTES * minute)
        const healthy = yield* Effect.tryPromise(() => args.probe()).pipe(
          Effect.orElseSucceed(() => false),
        )
        if (!healthy) continue
        yield* Effect.tryPromise(() =>
          args.notify('Treadle resumed: the provider is answering again.'),
        )
        paused = false
        retries = 0
      }
      outcome = yield* Effect.tryPromise(() => args.run())
    }
    return outcome
  })
}

export function runIssueLoop(deps: IssueLoopDeps): Effect.Effect<IssueLoopResult, Error> {
  const { repoDir, config, issue, human, notify } = deps
  const runChecksFn = deps.runChecksFn ?? runChecks
  const runSessionFn = deps.runSessionFn ?? runSession
  const sleepFn = deps.sleepFn ?? ((ms: number) => Effect.sleep(ms))
  const budget = config.budgets.passesPerIssue
  const nightlyCap = config.budgets.passesPerNight
  const branch = `loop/${issue.number}`
  const worktreeDir = join(repoDir, '.treadle', 'worktrees', String(issue.number))
  const treadleDir = join(repoDir, '.treadle')

  const tryP = <A>(f: () => Promise<A>) =>
    Effect.tryPromise({ try: f, catch: (e) => (e instanceof Error ? e : new Error(String(e))) })

  return Effect.gen(function* () {
    // ── Claim and set up ────────────────────────────────────────────────
    if (!deps.resume) {
      yield* tryP(() =>
        relabel(repoDir, config, issue.number, config.issues.ready, config.issues.working),
      )
    }
    yield* tryP(() => git(repoDir, 'fetch', 'origin'))
    // Stacked PRs (#17): the issue's base decides what the branch starts
    // from — the repo's default branch, another issue's loop/<n> branch, or
    // a named ref.
    const base = yield* tryP(() => resolveBaseRef(repoDir, issue))
    // A parked issue keeps its loop/<n> branch; re-picking it continues the
    // branch (its Checkpoint) rather than starting over from main. Likewise,
    // a killed run leaves the worktree behind — reuse it (#8's leftovers).
    const branchExists = yield* tryP(() => git(repoDir, 'rev-parse', '--verify', branch)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    const resumeLike = deps.resume || branchExists !== ''
    const worktrees = yield* tryP(() => git(repoDir, 'worktree', 'list', '--porcelain'))
    const alreadyThere = worktrees.split('\n').some((line) => line === `worktree ${worktreeDir}`)
    if (!alreadyThere) {
      if (resumeLike) {
        yield* tryP(() => git(repoDir, 'worktree', 'add', worktreeDir, branch))
      } else {
        yield* tryP(() => git(repoDir, 'worktree', 'add', worktreeDir, '-b', branch, base.ref))
      }
    }
    yield* tryP(() => installDeps(worktreeDir))
    const vision = yield* tryP(() => readFile(join(worktreeDir, 'VISION.md'), 'utf8'))

    // ── Budgets and history from Receipts (#8/#9) ───────────────────────
    const history = yield* tryP(() => readReceiptHistory(repoDir, config, issue.number))
    const counted = history.filter((r) => r.checks !== null && 'outcome' in r.checks)
    const ruleContext: RuleContext = {
      passesUsed: counted.length,
      budget,
      frontierHistory: counted.map((r) => (r.checks as { frontier: number }).frontier),
      failureSets: counted.map((r) =>
        (r.checks as { failureSet: FailureSetEntry[] }).failureSet.map(
          (e) => `${e.check}${e.test ? ` › ${e.test}` : ''}`,
        ),
      ),
    }
    let passSeq = history.length
    let costSoFarUsd = history.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

    // ── Baseline Checks before spending budget (#13) ────────────────────
    const baseline = yield* checksWithPause({
      run: () =>
        runChecksFn(config, {
          repoDir: worktreeDir,
          outDir: join(treadleDir, `checks-issue-${issue.number}-baseline-${stamp()}`),
          issue: issue.number,
          pass: 0,
        }),
      notify,
      issue: issue.number,
      sleepFn,
    })
    if (baseline.outcome !== 'checks.passed') {
      yield* tryP(() =>
        notify(
          `Baseline checks failed on a fresh branch for #${issue.number} — the harness or base ` +
            'branch is broken, not the issue. Back to ready without spending budget.',
        ),
      )
      yield* tryP(() => git(repoDir, 'worktree', 'remove', worktreeDir, '--force'))
      yield* tryP(() =>
        relabel(repoDir, config, issue.number, config.issues.working, config.issues.ready),
      )
      return { kind: 'parked', issue: issue.number, passesUsed: 0, reason: 'no-rule' }
    }

    // ── The Pass loop ───────────────────────────────────────────────────
    // Seconda volta on re-entry: an interrupted Session (killed by a
    // restart) left its log behind — distil the handoff for its
    // continuation, or the next Session re-explores from zero.
    let previousNote: string | null = null
    if (deps.resume) {
      const leftover = yield* tryP(() => latestSessionLog(treadleDir, issue.number))
      if (leftover !== null) {
        previousNote = yield* tryP(() =>
          extractHandoff({
            worktreeDir,
            baseRef: base.ref,
            sessionLogPath: leftover,
            terminal: 'failed',
            reason: 'interrupted by a restart',
          }),
        )
      }
    }
    let lastReport: CheckReport | null = null
    let lastReportDir: string | null = null
    const tried: string[] = []

    for (;;) {
      if (ruleContext.passesUsed >= budget) {
        yield* tryP(() => parkWithSummary('budget'))
        return {
          kind: 'parked',
          issue: issue.number,
          passesUsed: ruleContext.passesUsed,
          reason: 'budget',
        }
      }
      if (deps.passesTonight.passes() >= nightlyCap) {
        yield* tryP(() =>
          notify(
            `Nightly cap of ${nightlyCap} Passes reached ` +
              `($${deps.passesTonight.costUsd().toFixed(2)} today). Treadle stopping.`,
          ),
        )
        return { kind: 'stopped-cap', issue: issue.number, passesUsed: ruleContext.passesUsed }
      }
      const nightlyCostCap = config.budgets.maxCostPerNightUsd
      if (nightlyCostCap !== undefined && deps.passesTonight.costUsd() >= nightlyCostCap) {
        yield* tryP(() =>
          notify(
            `Nightly dollar cap of $${nightlyCostCap} reached ` +
              `($${deps.passesTonight.costUsd().toFixed(2)} across ${deps.passesTonight.passes()} Passes). ` +
              'Treadle stopping.',
          ),
        )
        return { kind: 'stopped-cap', issue: issue.number, passesUsed: ruleContext.passesUsed }
      }

      const pass = ++passSeq
      const passNumber = ruleContext.passesUsed + 1
      const costCap = config.budgets.maxCostPerIssueUsd
      if (costCap !== undefined && costSoFarUsd >= costCap) {
        yield* tryP(() => parkWithSummary('budget'))
        return {
          kind: 'parked',
          issue: issue.number,
          passesUsed: ruleContext.passesUsed,
          reason: 'budget',
        }
      }
      // ── Session (seed rule 1: the fix prompt carries the check report) ──
      const prompt = buildSessionPrompt({
        vision,
        issue,
        progressNote: yield* tryP(() => readProgressNote(worktreeDir)),
        lastReport,
        lastReportDir,
        previousSessionNote: previousNote,
        pass: passNumber,
        budget,
        protectedPaths: config.protectedPaths,
        qa: yield* tryP(() => readQa(repoDir, issue.number)),
      })
      const sessionLogPath = join(
        treadleDir,
        'sessions',
        `issue-${issue.number}-pass-${pass}-${stamp()}.jsonl`,
      )
      // #9: provider failures Pause, they don't burn the Pass. The wrapper
      // retries with backoff, then Pauses and probes until the provider is
      // back, and only a non-provider outcome reaches the budget below.
      const outcome = yield* sessionWithPause({
        run: () =>
          runSessionFn({
            cwd: worktreeDir,
            prompt,
            maxTurns: config.budgets.maxTurnsPerSession,
            timeoutMs: config.budgets.sessionTimeoutMinutes * 60_000,
            askHumanTimeoutMs: config.budgets.askHumanTimeoutMinutes * 60_000,
            askHuman: human.askHuman,
            logPath: sessionLogPath,
          }),
        probe: async () => {
          const probe = await runSessionFn({
            cwd: worktreeDir,
            prompt: 'Reply with exactly: ok',
            maxTurns: 2,
            timeoutMs: 120_000,
            askHumanTimeoutMs: 60_000,
            askHuman: async () => '',
            logPath: join(treadleDir, 'sessions', `issue-${issue.number}-probe-${stamp()}.jsonl`),
          })
          return probe.terminal === 'completed'
        },
        notify,
        issue: issue.number,
        sleepFn,
      })
      yield* tryP(() => deps.passesTonight.recordPass(outcome.costUsd))
      // Seconda volta: a failed Session usually leaves no note, and the
      // retry must not re-pay for its exploration — distil the handoff
      // deterministically from what it left behind.
      if (outcome.lastAssistantText !== null) {
        previousNote = outcome.lastAssistantText
      } else {
        previousNote = yield* tryP(() =>
          extractHandoff({
            worktreeDir,
            baseRef: base.ref,
            sessionLogPath,
            terminal: outcome.terminal,
            ...(outcome.reason !== undefined ? { reason: outcome.reason } : {}),
          }),
        )
      }
      costSoFarUsd += outcome.costUsd
      if (previousNote) {
        tried.push(`Pass ${passNumber}: ${outcome.terminal} — ${previousNote.slice(0, 300)}`)
      }

      const reverted = yield* tryP(() => revertProtected(worktreeDir, config.protectedPaths))
      const sha = yield* tryP(() =>
        checkpoint(
          worktreeDir,
          branch,
          `treadle: pass ${passNumber} checkpoint for #${issue.number} (${outcome.terminal})`,
        ),
      )

      // ── Blocked-on-human: park; the answer watcher resumes (#8/#9) ────
      if (outcome.terminal === 'blocked-on-human') {
        const question = outcome.reason ?? '(no question recorded)'
        yield* tryP(() => appendQa(repoDir, issue.number, { question }))
        yield* tryP(() =>
          postReceipt({
            issue: issue.number,
            pass,
            budget,
            terminal: outcome.terminal,
            reason: outcome.reason,
            turns: outcome.turns,
            costUsd: outcome.costUsd,
            sessionLogPath,
            checkpoint: sha,
            checks: null,
          }),
        )
        yield* tryP(() =>
          comment(
            repoDir,
            config,
            issue.number,
            `**Question from the Session:**\n\n${question}\n\n` +
              'Answer with /treadle whenever you like — the question stays open, and the Loop ' +
              'picks the issue back up when your answer lands.',
          ),
        )
        yield* tryP(() => notify(`Treadle needs you on issue #${issue.number}: ${question}`))
        yield* tryP(() =>
          relabel(repoDir, config, issue.number, config.issues.working, config.issues.parked),
        )
        yield* tryP(() => git(repoDir, 'worktree', 'remove', worktreeDir, '--force'))
        return {
          kind: 'parked',
          issue: issue.number,
          passesUsed: ruleContext.passesUsed,
          reason: 'blocked',
        }
      }

      // ── Checks, with #9's Pause semantics ─────────────────────────────
      const reportDir = join(treadleDir, `checks-issue-${issue.number}-pass-${pass}-${stamp()}`)
      lastReportDir = reportDir
      const report = yield* checksWithPause({
        run: () =>
          runChecksFn(config, {
            repoDir: worktreeDir,
            outDir: reportDir,
            issue: issue.number,
            pass,
          }),
        notify,
        issue: issue.number,
        sleepFn,
      })
      lastReport = report
      ruleContext.passesUsed += 1
      ruleContext.frontierHistory.push(report.frontier)
      ruleContext.failureSets.push(
        report.failureSet.map((e) => `${e.check}${e.test ? ` › ${e.test}` : ''}`),
      )

      yield* tryP(() =>
        postReceipt({
          issue: issue.number,
          pass,
          budget,
          terminal: outcome.terminal,
          reason: outcome.reason,
          turns: outcome.turns,
          costUsd: outcome.costUsd,
          sessionLogPath,
          checkpoint: reverted.length > 0 ? `${sha} (reverted ${reverted.join(', ')})` : sha,
          checks: {
            outcome: report.outcome as 'checks.passed' | 'checks.failed',
            frontier: report.frontier,
            failureSet: report.failureSet,
            reportDir,
          },
        }),
      )

      // ── Feature done (#9: checks.passed ∧ work present) ───────────────
      if (report.outcome === 'checks.passed') {
        const unitStep = config.checks.find((c) => c.report?.format === 'vitest-json')
        const present = yield* tryP(() =>
          workPresent({
            repoDir,
            worktreeDir,
            baseRef: base.ref,
            changedPaths: config.featureDone.changedPaths,
            requireNewTests: config.featureDone.requireNewTests,
            unitReportPath: unitStep?.report?.path ?? '.treadle/reports/unit.json',
          }),
        )
        if (present.present) {
          yield* tryP(() => openPrIfNeeded())
          const rule = matchRule(config.rules ?? [], 'feature.done', 'feature-check', ruleContext)
          if (rule?.action.type === 'effect' && rule.action.effect === 'mark-ready-and-notify') {
            yield* tryP(() => gh(repoDir, 'pr', 'ready', branch))
            const url =
              (yield* tryP(() => issueUrl(repoDir, config, issue.number))) ?? `#${issue.number}`
            yield* tryP(() =>
              notify(
                `PR ready for review: #${issue.number} "${issue.title}" (${present.detail}). ${url}`,
              ),
            )
          } else {
            yield* tryP(() =>
              notify(
                `Draft PR open for #${issue.number} "${issue.title}" (${present.detail}); ` +
                  'no feature.done rule matched, leaving it a draft.',
              ),
            )
          }
          // The open PR is the done marker (#5); the issue keeps no label.
          yield* tryP(() => removeLabel(repoDir, config, issue.number, config.issues.working))
          yield* tryP(() => git(repoDir, 'worktree', 'remove', worktreeDir, '--force'))
          return { kind: 'pr-ready', issue: issue.number, passesUsed: ruleContext.passesUsed }
        }
        // Green checks with no work: the Pass counts as failed (#9).
        previousNote =
          `The Checks passed but the branch shows no work present (${present.detail}). ` +
          'That Pass counted as failed. Implement the acceptance criteria for real, with the ' +
          'tests the Vision demands.'
        lastReport = null
        lastReportDir = null
        continue
      }

      // ── checks.failed: stalled, or the rules table decides (#6) ───────
      if (isStalled(ruleContext)) {
        yield* tryP(() => parkWithSummary('stalled'))
        return {
          kind: 'parked',
          issue: issue.number,
          passesUsed: ruleContext.passesUsed,
          reason: 'stalled',
        }
      }
      const fixRule = matchRule(config.rules ?? [], 'checks.failed', 'evaluating', ruleContext)
      if (fixRule?.action.type === 'session' && fixRule.action.session === 'fix-checks') {
        continue // seed rule 1: another Session with the check report
      }
      yield* tryP(() => parkWithSummary(ruleContext.passesUsed >= budget ? 'budget' : 'no-rule'))
      return {
        kind: 'parked',
        issue: issue.number,
        passesUsed: ruleContext.passesUsed,
        reason: ruleContext.passesUsed >= budget ? 'budget' : 'no-rule',
      }
    }

    // ── Helpers ─────────────────────────────────────────────────────────
    async function postReceipt(receipt: Receipt): Promise<void> {
      await comment(repoDir, config, issue.number, renderReceipt(receipt))
    }

    async function parkWithSummary(reason: 'budget' | 'stalled' | 'no-rule'): Promise<void> {
      const why =
        reason === 'budget'
          ? `budget of ${budget} Passes used`
          : reason === 'stalled'
            ? 'stalled: the Failure set stopped shrinking'
            : 'no rule matched checks.failed'
      const summary =
        `**Parked (${why}).**\n\n` +
        (tried.length > 0
          ? `What the Sessions tried:\n${tried.map((t) => `- ${t}`).join('\n')}\n\n`
          : '') +
        'The last Failure set is in the latest Receipt above.'
      await comment(repoDir, config, issue.number, summary)
      await relabel(repoDir, config, issue.number, config.issues.working, config.issues.parked)
      await git(repoDir, 'worktree', 'remove', worktreeDir, '--force')
    }

    async function openPrIfNeeded(): Promise<void> {
      const existing = await gh(repoDir, 'pr', 'list', '--head', branch, '--json', 'number')
      if ((JSON.parse(existing) as unknown[]).length > 0) return
      const body =
        config.issues.tracker === 'markdown'
          ? `Built by Treadle from markdown issue ${String(issue.number).padStart(3, '0')} "${issue.title}". ` +
            `Receipts (one per Pass) are in the tracker repo under log/${String(issue.number).padStart(3, '0')}/.`
          : `Closes #${issue.number}\n\nBuilt by Treadle. Receipts (one per pass) are in the issue comments.`
      await gh(
        repoDir,
        'pr',
        'create',
        '--draft',
        '--base',
        base.name,
        '--head',
        branch,
        '--title',
        `${issue.title} (#${issue.number})`,
        '--body',
        body,
      )
    }
  })
}

async function installDeps(worktreeDir: string): Promise<void> {
  await execFileAsync('zsh', ['-lic', 'pnpm install --frozen-lockfile'], {
    cwd: worktreeDir,
    env: { ...process.env, CI: 'true' },
  })
}

function stamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

async function readProgressNote(worktreeDir: string): Promise<string | null> {
  try {
    return await readFile(join(worktreeDir, 'PROGRESS.md'), 'utf8')
  } catch {
    return null
  }
}

async function revertProtected(worktreeDir: string, protectedPaths: string[]): Promise<string[]> {
  if (protectedPaths.length === 0) return []
  const status = await git(worktreeDir, 'status', '--porcelain', '--', ...protectedPaths)
  const touched = status
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3))
  if (touched.length === 0) return []
  await git(worktreeDir, 'checkout', '--', ...touched)
  return touched
}

async function checkpoint(worktreeDir: string, branch: string, message: string): Promise<string> {
  // Guardrail (#16): the Loop only ever pushes loop/* branches.
  if (!branch.startsWith('loop/')) throw new Error(`refusing to push non-loop branch: ${branch}`)
  await git(worktreeDir, 'add', '-A')
  // Scratch dirs (check reports) never belong in the PR, wherever in the
  // tree they live (suites report from package dirs) and whatever the
  // repo's .gitignore says.
  await git(worktreeDir, 'reset', '--', ':(glob)**/.treadle/').catch(() => undefined)
  const status = await git(worktreeDir, 'status', '--porcelain')
  // --no-verify: the Checkpoint is the Loop's bookkeeping, not agent work —
  // the repo's pre-commit hooks (husky/lint-staged) must not gate it. The
  // agent's own commits inside the Session still run the hooks, as they
  // should.
  if (status.length > 0) await git(worktreeDir, 'commit', '-m', message, '--no-verify')
  const sha = await git(worktreeDir, 'rev-parse', 'HEAD')
  await git(worktreeDir, 'push', '-u', 'origin', branch)
  return sha
}

/** Which issues are ready right now, answered-first (#9). */
export async function pickNextIssue(
  repoDir: string,
  config: LoopConfig,
  answeredFirst: (issue: number) => boolean,
): Promise<Issue | null> {
  const ready = await listReadyIssues(repoDir, config)
  if (ready.length === 0) return null
  return ready.find((issue) => answeredFirst(issue.number)) ?? (ready[0] as Issue)
}
