import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ExtensionAPI, ResourceLoader } from '@earendil-works/pi-coding-agent'
import {
  type AgentSessionEvent,
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { CheckReport } from './report.ts'

/**
 * Drive one Session through the Pi SDK (#12): start it against a worktree,
 * log every event to a per-Session JSONL file, enforce the turn and wall-clock
 * caps, and observe it to a Terminal state (GLOSSARY.md, #5).
 */

export type SessionTerminalState = 'completed' | 'failed' | 'blocked-on-human'

export type SessionOutcome = {
  terminal: SessionTerminalState
  /** Error message or cap reason for failed; the question for blocked-on-human. */
  reason?: string
  turns: number
  durationMs: number
  logPath: string
  lastAssistantText: string | null
  /** Dollar cost of the Session, per pi's own accounting (#16 cost caps). */
  costUsd: number
  tokens: number
}

/** Loop-level events the driver emits, including the ask_human tool's session.blocked. */
export type SessionDriverEvent =
  | { type: 'session.started'; model?: { readonly provider: string; readonly id: string } }
  | { type: 'session.blocked'; question: string }
  | { type: 'session.unblocked' }
  | { type: 'session.nudge'; turns: number; text: string }
  /** The run_checks tool was called; the deterministic runner takes it from here. */
  | { type: 'session.checks_requested' }
  | {
      type: 'session.checks_result'
      outcome: 'checks.passed' | 'checks.failed' | 'infrastructure-failure' | 'refused' | 'error'
      frontier?: number
      failureCount?: number
      reportDir?: string
      detail?: string
    }
  | { type: 'session.terminal'; outcome: SessionOutcome }

export type RunSessionOptions = {
  /** The worktree the Session works in. */
  cwd: string
  prompt: string
  /** Abort past this many turns (budgets.maxTurnsPerSession). */
  maxTurns: number
  /** Wall-clock cap (budgets.sessionTimeoutMinutes). */
  timeoutMs: number
  /**
   * Dollar cap per Session (budgets.maxCostPerSessionUsd): enforced on the
   * Session's own cost accounting at each turn boundary. The wall-clock cap
   * and the turn backstop still apply; this is the runaway-cost bound (#18).
   */
  maxCostUsd?: number
  /** How long ask_human waits for an answer (budgets.askHumanTimeoutMinutes). */
  askHumanTimeoutMs: number
  /** The human channel (terminal or TelePi, #14). */
  askHuman: (question: string, signal?: AbortSignal) => Promise<string>
  /**
   * When present, the Session gets the run_checks tool and the bash
   * test-command deny-pattern: the agent declares what should run, the
   * loop's deterministic runner executes it (same runner as the post-pass
   * Checks), and the structured Failure set comes back as the tool result.
   */
  runChecks?: () => Promise<{ report: CheckReport; reportDir: string }>
  /**
   * Cap on mid-session run_checks calls (budgets.maxCheckRunsPerSession).
   * Four, not two: issue 004 (2026-11-26) spent its two runs, fixed what the
   * second run found, and was refused the confirming run — the agent asked
   * for exactly what the cap then denied.
   */
  maxCheckRuns?: number
  /** The model for this and every Session; resolved against the agent's catalog. */
  model?: { readonly provider: string; readonly id: string }
  /** Per-Session JSONL event log. */
  logPath: string
  onEvent?: (event: SessionDriverEvent) => void
}

/** The slice of AgentSession the driver uses, so tests can substitute a fake. */
export type SessionLike = {
  subscribe: (listener: (event: AgentSessionEvent) => void) => () => void
  prompt: (text: string) => Promise<void>
  abort: () => Promise<void>
  dispose: () => void
  agent: { state: { errorMessage?: string } }
  getLastAssistantText: () => string | undefined
  getSessionStats: () => { tokens: { total: number }; cost: number }
}

export type CreateSessionLike = (options: {
  cwd: string
  sessionManager: unknown
  customTools: ToolDefinition[]
  /** Present when run_checks is armed: carries the bash deny-pattern factory. */
  resourceLoader?: unknown
  /** Resolved by runSession against the agent's catalog; unchanged when unset. */
  modelRuntime?: ModelRuntime
  model?: ReturnType<ModelRuntime['getModel']>
}) => Promise<{ session: SessionLike }>

const defaultCreateSession: CreateSessionLike = async (options) => {
  const { session } = await createAgentSession({
    cwd: options.cwd,
    ...(options.modelRuntime ? { modelRuntime: options.modelRuntime } : {}),
    ...(options.model ? { model: options.model, thinkingLevel: 'high' as const } : {}),
    sessionManager: options.sessionManager as SessionManager,
    customTools: options.customTools,
    // The deny-pattern loader (run_checks armed): dropping this silently
    // disarms the extension while the tool still exists — the exact bug the
    // live verification caught on 2026-11-19 (probe fired, bash ran pnpm test).
    ...('resourceLoader' in options && options.resourceLoader
      ? { resourceLoader: options.resourceLoader as ResourceLoader }
      : {}),
  })
  return { session }
}

export type RunSessionDeps = {
  createSession?: CreateSessionLike
}

function jsonl(value: unknown): string {
  try {
    return `${JSON.stringify(value)}\n`
  } catch {
    return `${JSON.stringify({ note: 'unserializable event' })}\n`
  }
}

function createAskHumanTool(hooks: {
  askHuman: (question: string, signal?: AbortSignal) => Promise<string>
  timeoutMs: number
  onBlocked: (question: string) => void
  onUnblocked: () => void
  onTimeout: (question: string) => void
}): ToolDefinition {
  return defineTool({
    name: 'ask_human',
    label: 'Ask human',
    description:
      'Ask the human overseeing this session a question when you cannot proceed or need ' +
      'judgement. The session stays alive while waiting; the answer comes back as the tool ' +
      'result. Use sparingly — a question with no answer within the timeout ends the session ' +
      'blocked-on-human.',
    promptSnippet: 'ask a human for judgement and wait for the answer',
    parameters: Type.Object({
      question: Type.String({
        description: 'The question for the human, with enough context to answer.',
      }),
    }),
    execute: async (_toolCallId, params, signal) => {
      hooks.onBlocked(params.question)
      type WaitResult =
        | { kind: 'answer'; text: string }
        | { kind: 'timeout' }
        | { kind: 'aborted' }
        | { kind: 'channel-error'; detail: string }
      const wait = await new Promise<WaitResult>((resolve) => {
        let settled = false
        // Cancel the channel's wait however this settles, so an unanswered
        // question's watcher doesn't get its answer eaten by a dead wait.
        const cancelWait = new AbortController()
        const timer = setTimeout(() => finish({ kind: 'timeout' }), hooks.timeoutMs)
        const onAbort = () => finish({ kind: 'aborted' })
        const finish = (result: WaitResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          signal?.removeEventListener('abort', onAbort)
          cancelWait.abort()
          resolve(result)
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        hooks.askHuman(params.question, cancelWait.signal).then(
          (text) => finish({ kind: 'answer', text }),
          (error) => finish({ kind: 'channel-error', detail: String(error) }),
        )
      })
      hooks.onUnblocked()
      if (wait.kind === 'timeout' || wait.kind === 'channel-error') {
        hooks.onTimeout(params.question)
        const why =
          wait.kind === 'timeout'
            ? `No answer arrived within ${Math.round(hooks.timeoutMs / 60_000)} minutes`
            : `The human channel failed (${wait.detail})`
        return {
          content: [
            {
              type: 'text',
              text:
                `${why}. Do not keep working and do not call ask_human again: end your ` +
                'turn now. The loop will park this issue and ask the human.',
            },
          ],
          details: { timedOut: wait.kind === 'timeout' },
        }
      }
      if (wait.kind === 'aborted') {
        return {
          content: [
            { type: 'text', text: 'The session was aborted while waiting for the answer.' },
          ],
          details: { timedOut: false },
        }
      }
      return { content: [{ type: 'text', text: wait.text }], details: { timedOut: false } }
    },
  })
}

/**
 * Commands that execute a test suite — run_checks owns these, not the agent's
 * bash. Segment-scoped (stops at ; & |) so `pnpm install && pnpm test` matches
 * the second segment, while `pnpm install` alone never matches.
 */
export const TEST_RUN_COMMAND =
  /(?:^|[\s;&`|(])(?:\b(?:vitest|mocha|jest|pytest)\b|\b(?:npx|pnpm|npm|yarn)\b[^;&|`]*\btest\b|\bnode\s+--test\b|\bgo\s+test\b|\bcargo\s+test\b|\bplaywright\s+test\b)/

export const RUN_CHECKS_DENY_REASON =
  'Test suites are run by the loop, not inside your turns: call the run_checks tool ' +
  'instead (it owns the canonical invocation — env, ports, DB stack — and returns the ' +
  'structured failure set). Reading files and logs with bash is unaffected.'

/** The bash deny-pattern: test-execution commands are refused with the way out named. */
export function createTestCommandDenyFactory(): {
  name: string
  hidden: boolean
  factory: (pi: ExtensionAPI) => void
} {
  return {
    name: 'treadle-test-command-deny',
    hidden: true,
    factory: (pi) => {
      pi.on('tool_call', (event) => {
        if (event.toolName !== 'bash') return
        const command = (event.input as { command?: unknown } | undefined)?.command
        if (typeof command !== 'string' || !TEST_RUN_COMMAND.test(command)) return
        return { block: true, reason: RUN_CHECKS_DENY_REASON }
      })
    },
  }
}

/** The run_checks tool result, rendered compactly from the deterministic report. */
function renderCheckResult(report: CheckReport, reportDir: string): string {
  const lines: string[] = []
  if (report.infrastructureFailure) {
    lines.push(
      `INFRASTRUCTURE FAILURE — ${report.infrastructureFailure.kind}: ${report.infrastructureFailure.detail}`,
    )
    lines.push(
      'The Loop Pauses on these instead of spending budget. Do not retry and do not work ' +
        'around it: end your turn and describe exactly what you observed in your final message.',
    )
  } else if (report.outcome === 'checks.passed') {
    lines.push(
      'checks.passed — the full Check suites are green against your branch. End your turn ' +
        'now; the loop runs its own post-pass Checks and takes it from here.',
    )
  } else {
    lines.push(
      `checks.failed — frontier ${report.frontier}. Fix what the failure set names; then ` +
        'you may call run_checks once more if the session budget allows.',
    )
    for (const entry of report.failureSet.slice(0, 8)) {
      const where = entry.test ? `${entry.check} › ${entry.test}` : entry.check
      lines.push(`- ${where}${entry.detail ? ` — ${entry.detail.slice(0, 200)}` : ''}`)
    }
  }
  lines.push(`Full report: ${reportDir}/checks.json; per-Check logs: ${reportDir}/logs/.`)
  return lines.join('\n')
}

type RunChecksDetails = {
  refused?: boolean
  outcome?: 'checks.passed' | 'checks.failed' | 'infrastructure-failure' | 'error'
  frontier?: number
  failureCount?: number
  reportDir?: string
  error?: string
}

type RunChecksToolResult = {
  content: Array<{ type: 'text'; text: string }>
  details: RunChecksDetails
}

function checkToolResult(text: string, details: RunChecksDetails): RunChecksToolResult {
  return { content: [{ type: 'text', text }], details }
}

function createRunChecksTool(hooks: {
  runChecks: () => Promise<{ report: CheckReport; reportDir: string }>
  maxRuns: number
  onRequested: () => void
  onResult: (result: {
    outcome: 'checks.passed' | 'checks.failed' | 'infrastructure-failure' | 'refused' | 'error'
    frontier?: number
    failureCount?: number
    reportDir?: string
    detail?: string
  }) => void
}): ToolDefinition {
  let runsLeft = hooks.maxRuns
  return defineTool({
    name: 'run_checks',
    label: 'Run checks',
    description:
      'Run the repository Check suites (typecheck, lint gates, test suites, REST gate) ' +
      "through the loop's deterministic runner: same runner, same env, same ports as the " +
      'post-pass Checks. Call it after your work is written, before you end your turn — ' +
      'the structured failure set comes back as the tool result. Runs at most ' +
      `${hooks.maxRuns}× per session.`,
    promptSnippet: 'run the repository check suites and get the structured failure set',
    parameters: Type.Object({}),
    execute: async (_toolCallId, _params, _signal) => {
      if (runsLeft <= 0) {
        hooks.onResult({ outcome: 'refused', detail: `${hooks.maxRuns}-run cap reached` })
        return checkToolResult(
          'run_checks is disabled for this session. The loop runs the full Checks ' +
            'after your session; write the work, keep the branch commitable, and end your turn.',
          { refused: true },
        )
      }
      runsLeft--
      hooks.onRequested()
      try {
        const { report, reportDir } = await hooks.runChecks()
        const outcome = report.infrastructureFailure
          ? 'infrastructure-failure'
          : (report.outcome ?? 'error')
        hooks.onResult({
          outcome,
          frontier: report.frontier,
          failureCount: report.failureSet.length,
          reportDir,
        })
        return checkToolResult(renderCheckResult(report, reportDir), {
          outcome,
          frontier: report.frontier,
          failureCount: report.failureSet.length,
          reportDir,
        })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        hooks.onResult({ outcome: 'error', detail })
        return checkToolResult(
          `The checks runner failed to run (${detail}). End your turn and describe ` +
            'what happened in your final message.',
          { error: detail },
        )
      }
    },
  })
}

function nudgeText(
  fraction: 'half' | 'four-fifths',
  elapsedMin: number,
  budgetMin: number,
): string {
  return fraction === 'half'
    ? `Budget note from the harness (not the user): this session is ${elapsedMin} of ~${budgetMin} minutes in. ` +
        'Start converging now: decide the smallest landable increment of your issue and what it still ' +
        'needs, then write the code and the tests before you explore further, and bring PROGRESS.md up ' +
        'to date. Exploration you cannot land is exploration the next session pays for again.'
    : `Budget note from the harness (not the user): ${elapsedMin} of ~${budgetMin} minutes are gone. ` +
        'Stop exploring and land it: get the code and tests written and PROGRESS.md current. If the ' +
        "issue can't fully land in the remaining time, leave the branch passing its checks and write " +
        'exactly what is left into PROGRESS.md so the next session starts from the truth.'
}

export async function runSession(
  options: RunSessionOptions,
  deps: RunSessionDeps = {},
): Promise<SessionOutcome> {
  const startedAt = Date.now()
  await mkdir(dirname(options.logPath), { recursive: true })
  const log: WriteStream = createWriteStream(options.logPath)
  const emit = (event: SessionDriverEvent) => {
    log.write(jsonl({ ts: new Date().toISOString(), driver: event }))
    options.onEvent?.(event)
  }

  let turns = 0
  let sessionCostUsd = 0
  let abortReason: string | null = null
  let blockedQuestion: string | null = null

  // Budget pressure (Volta, the nudge action): at half and four-fifths of
  // the wall-clock budget, push the session toward landing an increment
  // instead of dying mid-exploration at a cap. Injected as a user-role
  // message, marked so the agent knows it is the harness, not the person.
  const nudgedAt = new Set<string>()
  const maybeNudge = () => {
    const elapsed = Date.now() - startedAt
    const fraction =
      elapsed >= options.timeoutMs * 0.8
        ? 'four-fifths'
        : elapsed >= options.timeoutMs / 2
          ? 'half'
          : null
    if (fraction === null || nudgedAt.has(fraction)) return
    nudgedAt.add(fraction)
    const text = nudgeText(
      fraction as 'half' | 'four-fifths',
      Math.round(elapsed / 60_000),
      Math.round(options.timeoutMs / 60_000),
    )
    emit({ type: 'session.nudge', turns, text })
    void session.prompt(text).catch((error: unknown) => {
      log.write(
        jsonl({
          ts: new Date().toISOString(),
          driver: { type: 'session.nudge-failed', detail: String(error) },
        }),
      )
    })
  }

  const askHumanTool = createAskHumanTool({
    askHuman: options.askHuman,
    timeoutMs: options.askHumanTimeoutMs,
    onBlocked: (question) => emit({ type: 'session.blocked', question }),
    onUnblocked: () => emit({ type: 'session.unblocked' }),
    onTimeout: (question) => {
      blockedQuestion = question
    },
  })

  // run_checks + the bash deny-pattern arm together: refusing test commands
  // is only fair when the loop's own runner is reachable in the same session.
  const customTools: ToolDefinition[] = [askHumanTool]
  let resourceLoader: DefaultResourceLoader | undefined
  if (options.runChecks !== undefined) {
    const runChecksTool = createRunChecksTool({
      runChecks: options.runChecks,
      maxRuns: options.maxCheckRuns ?? 4,
      onRequested: () => emit({ type: 'session.checks_requested' }),
      onResult: (result) => emit({ type: 'session.checks_result', ...result }),
    })
    customTools.push(runChecksTool)
    resourceLoader = new DefaultResourceLoader({
      cwd: options.cwd,
      agentDir: getAgentDir(),
      extensionFactories: [createTestCommandDenyFactory()],
    })
    await resourceLoader.reload()
  }

  // Loop-scoped model selection (#17 extension): resolve against the
  // agent's catalog (bundled + cached overlay, offline-safe) and pin the
  // same runtime on the session, so its auth and catalog are the ones the
  // model resolved from. Absent: pi's default, untouched.
  let modelRuntime: ModelRuntime | undefined
  let model: ReturnType<ModelRuntime['getModel']> | undefined
  if (options.model) {
    modelRuntime = await ModelRuntime.create()
    model = modelRuntime.getModel(options.model.provider, options.model.id)
    if (!model) {
      // Refused before any session exists: the config names a model this
      // catalog has never heard of.
      const missingModel = `model not in catalog: ${options.model.provider}/${options.model.id}`
      const missingOutcome: SessionOutcome = {
        terminal: 'failed',
        reason: missingModel,
        turns: 0,
        durationMs: Date.now() - startedAt,
        logPath: options.logPath,
        lastAssistantText: null,
        costUsd: 0,
        tokens: 0,
      }
      emit({ type: 'session.terminal', outcome: missingOutcome })
      return missingOutcome
    }
  }

  const createSession = deps.createSession ?? defaultCreateSession
  const { session } = await createSession({
    cwd: options.cwd,
    sessionManager: SessionManager.inMemory(),
    customTools,
    ...(resourceLoader ? { resourceLoader } : {}),
    ...(modelRuntime ? { modelRuntime } : {}),
    ...(model ? { model } : {}),
  })

  const unsubscribe = session.subscribe((event) => {
    log.write(jsonl({ ts: new Date().toISOString(), event }))
    if (event.type === 'turn_end') {
      turns += 1
      const usage = (event as { message?: { usage?: { cost?: { total?: number } } } }).message
        ?.usage
      if (typeof usage?.cost?.total === 'number') sessionCostUsd += usage.cost.total
      maybeNudge()
      if (abortReason === null) {
        if (options.maxCostUsd !== undefined && sessionCostUsd >= options.maxCostUsd) {
          abortReason = `session $ cap ${options.maxCostUsd} reached ($${sessionCostUsd.toFixed(2)})`
          void session.abort()
        } else if (turns >= options.maxTurns) {
          // Backstop only: wall-clock and dollars are the budgets (#18);
          // a session this long means the caps never fired.
          abortReason = `turn backstop ${options.maxTurns} reached`
          void session.abort()
        }
      }
    }
  })

  const timeout = setTimeout(() => {
    if (abortReason === null) {
      abortReason = `session timeout after ${Math.round(options.timeoutMs / 60_000)} minutes`
      void session.abort()
    }
  }, options.timeoutMs)

  emit({ type: 'session.started', ...(options.model ? { model: options.model } : {}) })
  let promptError: unknown = null
  try {
    await session.prompt(options.prompt)
  } catch (error) {
    promptError = error
  } finally {
    clearTimeout(timeout)
    unsubscribe()
  }

  const errorMessage = session.agent.state.errorMessage
  const stats = session.getSessionStats()
  let outcome: SessionOutcome
  const base = {
    turns,
    durationMs: Date.now() - startedAt,
    logPath: options.logPath,
    lastAssistantText: session.getLastAssistantText() ?? null,
    costUsd: stats.cost,
    tokens: stats.tokens.total,
  }
  if (abortReason !== null) {
    outcome = { ...base, terminal: 'failed', reason: abortReason }
  } else if (errorMessage) {
    outcome = { ...base, terminal: 'failed', reason: errorMessage }
  } else if (promptError !== null) {
    outcome = { ...base, terminal: 'failed', reason: String(promptError) }
  } else if (blockedQuestion !== null) {
    outcome = { ...base, terminal: 'blocked-on-human', reason: blockedQuestion }
  } else {
    outcome = { ...base, terminal: 'completed' }
  }

  emit({ type: 'session.terminal', outcome })
  session.dispose()
  await new Promise((resolve) => log.end(resolve))
  return outcome
}
