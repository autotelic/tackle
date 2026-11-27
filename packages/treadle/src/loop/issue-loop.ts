import { execFile } from 'node:child_process'
import { appendFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { Effect } from 'effect'
import { passConsumesBudget } from '../budget.ts'
import { runChecks } from '../checks.ts'
import type { LoopConfig } from '../config.ts'
import { assertConfigCurrent } from '../config.ts'
import type { HumanChannel } from '../human-channel.ts'
import { buildSessionPrompt } from '../prompt.ts'
import { type Receipt, renderReceipt } from '../receipt.ts'
import type { CheckReport, FailureSetEntry } from '../report.ts'
import { runSession, type SessionOutcome } from '../session.ts'
import { extractHandoff } from './distill.ts'
import { formatFailure, lastFetchFailure } from './netlog.ts'
import type { NightlyBudget } from './nightly.ts'
import { isProviderFailure } from './provider.ts'
import { rebaseResolvingScratch } from './rebase.ts'
import { isStalled, matchRule, type RuleContext } from './rules.ts'
import {
  comment,
  gh,
  ghJson,
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

/**
 * The per-issue test-count baseline (feature-branch era): the unit report
 * the fresh branch's baseline Checks just produced, saved under the repo's
 * .treadle so re-entries and later Passes compare against the branch's own
 * starting count. The repo-level snapshot goes stale the moment a worktree
 * is removed — it once carried an unmerged branch's tests and made every
 * later issue's `workPresent` fail its test-count guard.
 */
function testBaselinePath(treadleDir: string, issue: number): string {
  return join(treadleDir, `test-baseline-${issue}.json`)
}

async function saveTestBaseline(
  treadleDir: string,
  issue: number,
  worktreeDir: string,
  unitReportPath: string,
): Promise<void> {
  const source = await readFile(join(worktreeDir, unitReportPath), 'utf8').catch(() => null)
  if (source === null) return
  const parsed = JSON.parse(source) as { numTotalTests?: number }
  if (typeof parsed.numTotalTests !== 'number') return
  await mkdir(dirname(testBaselinePath(treadleDir, issue)), { recursive: true })
  await writeFile(
    testBaselinePath(treadleDir, issue),
    JSON.stringify({ numTotalTests: parsed.numTotalTests, at: new Date().toISOString() }),
  )
}

async function readTestBaseline(treadleDir: string, issue: number): Promise<number | null> {
  try {
    const parsed = JSON.parse(await readFile(testBaselinePath(treadleDir, issue), 'utf8')) as {
      numTotalTests?: number
    }
    return typeof parsed.numTotalTests === 'number' ? parsed.numTotalTests : null
  } catch {
    return null
  }
}

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
  /** The config's hash at load. Absent in unit tests, which have no config file. */
  configHash?: string
}

const INFRA_BACKOFF_MINUTES = [1, 5, 15]
/**
 * A session that ends this fast with no turn never contacted the provider. The
 * ladder is for real outages, where waiting can help; this cannot be waited out.
 */
const DEAD_POOL_MS = 20_000

/**
 * The transport cause behind a provider failure, when this process saw one. The
 * SDK reduces every transport error to "Connection error."; this names the code
 * so a notice says ECONNRESET or ENOTFOUND instead of leaving it to guesswork.
 */
function causeSuffix(): string {
  const failure = lastFetchFailure()
  if (failure === null) return ''
  return ` Cause: ${formatFailure(failure)}.`
}
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
 * the Pass with backoff (1, 5, 15 min), then the process EXITS — launchd's
 * KeepAlive restarts it within the throttle interval. A probe used to run
 * in-process instead, and that is why: pi's SDK installs a pooled undici
 * dispatcher for model calls, and a provider that caps connection lifetime
 * (the go inference route drops them around seven minutes) leaves the pool
 * holding a silently dead socket — every later request in that process fails
 * instantly, probes included, while any fresh process works. A restart is the
 * only cure, and KeepAlive makes it cheap. Only a non-provider outcome reaches
 * the caller, so infra never burns the issue budget or the nightly cap.
 */
export function sessionWithPause(args: {
  run: () => Promise<SessionOutcome>
  notify: (text: string) => Promise<void>
  issue: number
  sleepFn: (ms: number) => Effect.Effect<void>
  exitFn: (code: number) => void
}): Effect.Effect<SessionOutcome, Error> {
  const minute = 60_000
  return Effect.gen(function* () {
    let outcome = yield* Effect.tryPromise(() => args.run())
    let retries = 0
    while (isProviderFailure(outcome.reason)) {
      // A session that produced no turn and died within seconds never reached
      // the provider: the process's connection pool is poisoned, and retrying
      // INSIDE it cannot help. Measured on the collab loop: 22 passes hit this,
      // 66 retries, zero recoveries — every one was cured by a restart and by
      // nothing else. So exit at once instead of burning 21 minutes of ladder.
      if (outcome.turns === 0 && outcome.durationMs < DEAD_POOL_MS) {
        yield* Effect.tryPromise(() =>
          args.notify(
            `Treadle EXITING: no request left this process (${outcome.reason?.slice(0, 80)} ` +
              `after ${Math.round(outcome.durationMs / 1000)}s). The connection pool is dead; ` +
              `KeepAlive restarts us in under a minute and the pass re-enters.`,
          ),
        )
        args.exitFn(255)
        return outcome
      }
      if (retries < INFRA_BACKOFF_MINUTES.length) {
        const waitMinutes = INFRA_BACKOFF_MINUTES[retries] as number
        yield* Effect.tryPromise(() =>
          args.notify(
            `Provider failure on issue #${args.issue} (${outcome.reason?.slice(0, 120)}). ` +
              `Retrying the Pass in ${waitMinutes} min.${causeSuffix()}`,
          ),
        )
        retries += 1
        yield* args.sleepFn(waitMinutes * minute)
      } else {
        yield* Effect.tryPromise(() =>
          args.notify(
            `Treadle EXITING: the provider keeps failing (${outcome.reason?.slice(0, 120)}). ` +
              `KeepAlive restarts us with a fresh connection pool in under a minute; ` +
              `working issues re-enter where they left off.`,
          ),
        )
        args.exitFn(255)
        // Unreachable in a live process; the type needs a tail for the generator.
        return outcome
      }
      outcome = yield* Effect.tryPromise(() => args.run())
    }
    return outcome
  })
}

export function runIssueLoop(deps: IssueLoopDeps): Effect.Effect<IssueLoopResult, Error> {
  const { repoDir, config, issue, human, notify } = deps
  const runChecksFn = deps.runChecksFn ?? runChecks
  const configHash = deps.configHash
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
    // from — the integration branch (ADR-0003), another issue's loop/<n>
    // branch, a named ref, or the repo's default branch.
    const base = yield* tryP(() => resolveBaseRef(repoDir, issue, config.integrationBranch))
    // A parked issue keeps its loop/<n> branch; re-picking it continues the
    // branch (its Checkpoint) rather than starting over from main. Likewise,
    // a killed run leaves the worktree behind — reuse it (#8's leftovers).
    const branchExists = yield* tryP(() => git(repoDir, 'rev-parse', '--verify', branch)).pipe(
      Effect.orElseSucceed(() => ''),
    )
    const resumeLike = deps.resume || branchExists !== ''
    // A force-removed worktree (operator cleanup, a crashed run) leaves a
    // stale "prunable" entry: without a prune, `alreadyThere` is true for a
    // directory that no longer exists, `worktree add` is skipped, and the
    // install spawn ENOENTs on the missing cwd (#20).
    yield* tryP(() => git(repoDir, 'worktree', 'prune'))
    const worktrees = yield* tryP(() => git(repoDir, 'worktree', 'list', '--porcelain'))
    const alreadyThere = worktrees.split('\n').some((line) => line === `worktree ${worktreeDir}`)
    if (!alreadyThere) {
      if (resumeLike) {
        // Re-entry reuses the issue's own branch. If it no longer exists
        // (operator reset), resume semantics can't hold: back to ready with
        // a notify instead of a loud `invalid reference` crash (#20).
        if (branchExists === '') {
          yield* tryP(() =>
            notify(
              `#${issue.number}: branch ${branch} is gone — resetting the issue to ${config.issues.ready} (nothing was on the branch).`,
            ),
          )
          yield* tryP(() =>
            relabel(repoDir, config, issue.number, config.issues.working, config.issues.ready),
          )
          return { kind: 'parked', issue: issue.number, passesUsed: 0, reason: 'no-rule' }
        }
        yield* tryP(() => git(repoDir, 'worktree', 'add', worktreeDir, branch))
      } else {
        yield* tryP(() => git(repoDir, 'worktree', 'add', worktreeDir, '-b', branch, base.ref))
        // A fresh branch inherits the base's PROGRESS.md in a stack, but
        // the note is per-issue memory — the new issue starts it clean.
        yield* tryP(() => rm(join(worktreeDir, 'PROGRESS.md'), { force: true }))
      }
    }
    yield* tryP(() => runStep(worktreeDir, config.install ?? 'true'))
    // Hoisted: the narrowing does not survive into the arrow.
    const build = config.build
    if (build !== undefined) yield* tryP(() => runStep(worktreeDir, build))
    const vision = yield* tryP(() => readFile(join(worktreeDir, 'VISION.md'), 'utf8'))

    // Where the branch stands, deterministically from git: sessions burn
    // turns discovering base staleness and then ask the human about it
    // (issues #14 and #15 both did). The facts go into every prompt.
    const branchFacts = {
      baseRef: base.ref,
      integrationDrift: yield* tryP(() =>
        config.integrationBranch
          ? git(
              worktreeDir,
              'rev-list',
              '--count',
              `HEAD..origin/${config.integrationBranch}`,
            ).then(
              (stdout) => (Number.isFinite(Number(stdout)) ? Number(stdout) : null),
              () => null,
            )
          : Promise.resolve(null),
      ),
    }

    // ── Budgets and history from Receipts (#8/#9) ───────────────────────
    const history = yield* tryP(() => readReceiptHistory(repoDir, config, issue.number))
    // #18: the budget counts CONSUMING passes; a failed pass that shrank
    // the frontier is progress-exempt (its receipt carries progressExempt).
    // Stall detection sees every pass's frontier — exempt ones included —
    // so a shrinking-then-flatlining issue still trips the breaker.
    const withChecks = history.filter((r) => r.checks !== null && 'outcome' in r.checks)
    const consumed = withChecks.filter(
      (r) => (r.checks as { progressExempt?: boolean }).progressExempt !== true,
    )
    const absoluteCeiling = config.budgets.maxPassesPerIssue ?? budget * 2
    const ruleContext: RuleContext = {
      passesUsed: consumed.length,
      budget,
      frontierHistory: withChecks.map((r) => (r.checks as { frontier: number }).frontier),
      failureSets: withChecks.map((r) =>
        (r.checks as { failureSet: FailureSetEntry[] }).failureSet.map(
          (e) => `${e.check}${e.test ? ` › ${e.test}` : ''}`,
        ),
      ),
    }
    let passSeq = history.length
    let costSoFarUsd = history.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)

    // ── The gate must be the gate that was loaded ──────────────────────
    // A config read at startup is not the config running this pass: a checks list edited while the loop
    // was alive never ran, and the pass still reported green. Refuse instead of under-running the review.
    if (deps.configHash !== undefined) {
      const drifted = yield* Effect.tryPromise({
        try: () => assertConfigCurrent(join(repoDir, 'loop.config.ts'), deps.configHash as string),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      }).pipe(
        Effect.as<'ok'>('ok'),
        Effect.catch((error) =>
          Effect.succeed<'stale' | 'ok'>(error.name === 'StaleConfigError' ? 'stale' : 'ok'),
        ),
      )
      if (drifted === 'stale') {
        yield* tryP(() =>
          notify(
            `#${issue.number}: the loop config changed since it was loaded — refusing to run checks ` +
              'under a gate that did not run. Restart the loop.',
          ),
        )
        yield* tryP(() =>
          postReceipt({
            issue: issue.number,
            pass: 0,
            budget,
            terminal: 'stale-config',
            reason: 'StaleConfig',
            turns: 0,
            sessionLogPath: '',
            checkpoint: issue.number.toString(),
            checks: {
              infrastructureFailure:
                'StaleConfig: loop.config.ts changed since load; no check from the new file has run',
              reportDir: '',
            },
          }),
        )
        yield* tryP(() =>
          relabel(repoDir, config, issue.number, config.issues.working, config.issues.parked),
        )
        yield* tryP(() => git(repoDir, 'worktree', 'remove', worktreeDir, '--force'))
        return { kind: 'parked', issue: issue.number, passesUsed: 0, reason: 'no-rule' }
      }
    }

    // ── Baseline Checks before spending budget (#13) ────────────────────
    // The baseline guards the HARNESS, not the issue: it bounces only on a
    // fresh branch (nothing the agent did can be failing yet). A resumed
    // branch carries in-progress work — known-failing checks are the
    // issue's state, and bouncing would ping-pong forever.
    if (!resumeLike) {
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
      // The fresh branch's own suite count is this issue's test baseline:
      // workPresent compares later Passes against the branch's starting
      // point, never against a repo-level snapshot (which goes stale and
      // once carried an unmerged branch's tests).
      const unitStep = config.checks.find((c) => c.report?.format === 'vitest-json')
      yield* tryP(() =>
        saveTestBaseline(
          treadleDir,
          issue.number,
          worktreeDir,
          unitStep?.report?.path ?? '.treadle/reports/unit.json',
        ),
      )
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
      if (ruleContext.passesUsed >= budget || passSeq >= absoluteCeiling) {
        const why = ruleContext.passesUsed >= budget ? 'budget' : 'absolute ceiling'
        yield* tryP(() => notify(`#${issue.number}: parked — ${why}`))
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
        branchFacts,
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
            ...(config.model ? { model: config.model } : {}),
            maxTurns: config.budgets.maxTurnsPerSession,
            timeoutMs: config.budgets.sessionTimeoutMinutes * 60_000,
            askHumanTimeoutMs: config.budgets.askHumanTimeoutMinutes * 60_000,
            askHuman: human.askHuman,
            logPath: sessionLogPath,
            // Mid-session checks through the same deterministic runner the
            // post-pass Checks use: the agent declares, the loop executes.
            // The runaway-cost bound per Session (#18); wall-clock and the
            // turn backstop come from the same budgets block.
            ...(config.budgets.maxCostPerSessionUsd !== undefined
              ? { maxCostUsd: config.budgets.maxCostPerSessionUsd }
              : {}),
            // Hot-adopts at the pick boundary with the rest of the config.
            ...(config.budgets.maxCheckRunsPerSession !== undefined
              ? { maxCheckRuns: config.budgets.maxCheckRunsPerSession }
              : {}),
            runChecks: () => {
              const reportDir = join(
                treadleDir,
                `checks-issue-${issue.number}-pass-${passNumber}-inflight-${stamp()}`,
              )
              return runChecksFn(config, {
                repoDir: worktreeDir,
                outDir: reportDir,
                issue: issue.number,
                pass: passNumber,
              }).then((report) => ({ report, reportDir }))
            },
          }),
        notify,
        issue: issue.number,
        sleepFn,
        exitFn: (code) => process.exit(code),
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
      if (sha === null) {
        // The branch conflicts with its remote tip (moved under the session
        // by a rebase) — a person resolves it. The pass's commits are safe
        // on the local branch; the next pick resumes from them.
        yield* tryP(() => parkWithSummary('conflict'))
        return {
          kind: 'parked',
          issue: issue.number,
          passesUsed: ruleContext.passesUsed,
          reason: 'blocked',
        }
      }

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
      // #18: a failed pass that shrank the frontier is verified progress —
      // it doesn't consume the budget, and its receipt says so, so recovery
      // after a restart reaches the same count.
      const previousFrontier = lastReport?.frontier ?? null
      const progressExempt =
        report.outcome === 'checks.failed' &&
        !passConsumesBudget({ previousFrontier, frontier: report.frontier })
      lastReport = report
      if (!progressExempt) ruleContext.passesUsed += 1
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
            ...(progressExempt ? { progressExempt: true } : {}),
          },
        }),
      )

      // ── Feature done (#9: checks.passed ∧ work present) ───────────────
      if (report.outcome === 'checks.passed') {
        const unitStep = config.checks.find((c) => c.report?.format === 'vitest-json')
        const baseline = yield* tryP(() => readTestBaseline(treadleDir, issue.number))
        const present = yield* tryP(() =>
          workPresent({
            repoDir,
            worktreeDir,
            baseRef: base.ref,
            changedPaths: config.featureDone.changedPaths,
            requireNewTests: config.featureDone.requireNewTests,
            unitReportPath: unitStep?.report?.path ?? '.treadle/reports/unit.json',
            baseCount: baseline,
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
      // Every receipt names the gate it passed: the hash and the checks as loaded.
      await comment(
        repoDir,
        config,
        issue.number,
        renderReceipt({
          ...receipt,
          ...(configHash === undefined ? {} : { configHash }),
          declaredChecks: config.checks.map((check) => ({
            name: check.name,
            run: check.run,
            timeoutSeconds: check.timeoutSeconds,
          })),
        }),
      )
    }

    async function parkWithSummary(
      reason: 'budget' | 'stalled' | 'no-rule' | 'conflict',
    ): Promise<void> {
      const why =
        reason === 'budget'
          ? `budget of ${budget} Passes used`
          : reason === 'stalled'
            ? 'stalled: the Failure set stopped shrinking'
            : reason === 'conflict'
              ? `the branch conflicts with origin/${branch} — rebase it by hand, then set the issue ready (the session's commits are safe on the local branch)`
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

/**
 * Run a step from the config in the issue's worktree.
 *
 * `sh -c`, never `zsh -lic`: a login interactive shell needs a terminal it does not have on an
 * unattended run, and its startup files leak `can't change option: zle` into every log. The command
 * is the repo's own — hardcoding `pnpm install` made `install` in the config a lie, which is how a
 * repo that has to build before its checks could never say so.
 */
async function runStep(worktreeDir: string, command: string): Promise<void> {
  await execFileAsync('sh', ['-c', command], {
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

/**
 * Commit and push the pass's checkpoint. Returns the checkpoint SHA, or
 * `null` when the branch conflicts with the remote tip: the remote moved
 * under the live worktree (maintenance or a hand rebase — routine under
 * the feature-branch shift), the branch's own commits don't replay cleanly
 * onto it, and pushing is a human's rebase away. The commits are safe on
 * the local branch either way; the caller parks the issue with a note.
 */
async function checkpoint(
  worktreeDir: string,
  branch: string,
  message: string,
): Promise<string | null> {
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
  // The remote branch can move under a live worktree — maintenance or a
  // human rebases the branch while a Session runs (the feature-branch shift
  // makes hand-rebases routine). A plain non-fast-forward rejection must
  // not kill the issue loop: fetch, rebase the branch's own commits onto
  // the remote tip, and retry once. Rebasing (never force-pushing) keeps
  // any human version of the branch intact. A rebase CONFLICT (the branch
  // carries pre-rewrite lineage, say) parks the issue instead — the loop
  // must not die on a state a person has to resolve.
  let conflicted = false
  await git(worktreeDir, 'push', '-u', 'origin', branch).catch(async () => {
    await git(worktreeDir, 'fetch', 'origin', branch)
    // The engine's own scratch note is not a reason to park: a conflict on it
    // is resolved by dropping the file, the same rule maintenance applies.
    const rebased = await rebaseResolvingScratch(worktreeDir, `origin/${branch}`).then(
      () => true,
      () => {
        git(worktreeDir, 'rebase', '--abort').catch(() => undefined)
        return false
      },
    )
    if (!rebased) {
      conflicted = true
      return
    }
    await git(worktreeDir, 'push', '-u', 'origin', branch, '--force-with-lease')
  })
  return conflicted ? null : sha
}

/** Which issues are ready right now, answered-first (#9). */
export async function pickNextIssue(
  repoDir: string,
  config: LoopConfig,
  answeredFirst: (issue: number) => boolean,
  /** Injectable for tests. */
  countOpenPrsFn?: (repoDir: string) => Promise<number>,
): Promise<Issue | null> {
  const cap = config.budgets.maxOpenLoopPrs
  if (cap !== undefined && cap > 0) {
    const countOpenPrs =
      countOpenPrsFn ??
      (async (dir: string) => {
        const prs = await ghJson<{ headRefName: string }[]>(
          dir,
          'pr',
          'list',
          '--state',
          'open',
          '--json',
          'headRefName',
          '--limit',
          '100',
        )
        return prs.filter((pr) => pr.headRefName.startsWith('loop/')).length
      })
    const open = await countOpenPrs(repoDir).catch(() => 0)
    if (open >= cap) return null
  }
  const ready = await listReadyIssues(repoDir, config)
  if (ready.length === 0) return null
  return ready.find((issue) => answeredFirst(issue.number)) ?? (ready[0] as Issue)
}
