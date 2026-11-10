import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type AgentSessionEvent,
  createAgentSession,
  defineTool,
  SessionManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

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
  | { type: 'session.started' }
  | { type: 'session.blocked'; question: string }
  | { type: 'session.unblocked' }
  | { type: 'session.nudge'; turns: number; text: string }
  | { type: 'session.terminal'; outcome: SessionOutcome }

export type RunSessionOptions = {
  /** The worktree the Session works in. */
  cwd: string
  prompt: string
  /** Abort past this many turns (budgets.maxTurnsPerSession). */
  maxTurns: number
  /** Wall-clock cap (budgets.sessionTimeoutMinutes). */
  timeoutMs: number
  /** How long ask_human waits for an answer (budgets.askHumanTimeoutMinutes). */
  askHumanTimeoutMs: number
  /** The human channel (terminal or TelePi, #14). */
  askHuman: (question: string, signal?: AbortSignal) => Promise<string>
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
}) => Promise<{ session: SessionLike }>

const defaultCreateSession: CreateSessionLike = async (options) => {
  const { session } = await createAgentSession({
    cwd: options.cwd,
    sessionManager: options.sessionManager as SessionManager,
    customTools: options.customTools,
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

function nudgeText(fraction: 'half' | 'four-fifths', turns: number, maxTurns: number): string {
  return fraction === 'half'
    ? `Budget note from the harness (not the user): this session is ${turns} of ${maxTurns} turns in. ` +
        'Start converging now: decide the smallest landable increment of your issue and what it still ' +
        'needs, then write the code and the tests before you explore further, and bring PROGRESS.md up ' +
        'to date. Exploration you cannot land is exploration the next session pays for again.'
    : `Budget note from the harness (not the user): ${turns} of ${maxTurns} turns are gone. ` +
        'Stop exploring and land it: get the code and tests written and PROGRESS.md current. If the ' +
        "issue can't fully land in the remaining turns, leave the branch passing its checks and write " +
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
  let abortReason: string | null = null
  let blockedQuestion: string | null = null

  // Budget pressure (Volta, the nudge action): at half and four-fifths of
  // the turn budget, push the session toward landing an increment instead
  // of dying mid-exploration at the cap. Injected as a user-role message,
  // marked so the agent knows it is the harness, not the person.
  const nudgedAt = new Set<number>()
  const maybeNudge = () => {
    const half = Math.floor(options.maxTurns / 2)
    const fourFifths = Math.floor((options.maxTurns * 4) / 5)
    const fraction = turns === half ? 'half' : turns === fourFifths ? 'four-fifths' : null
    if (fraction === null || nudgedAt.has(turns)) return
    nudgedAt.add(turns)
    const text = nudgeText(fraction, turns, options.maxTurns)
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

  const createSession = deps.createSession ?? defaultCreateSession
  const { session } = await createSession({
    cwd: options.cwd,
    sessionManager: SessionManager.inMemory(),
    customTools: [askHumanTool],
  })

  const unsubscribe = session.subscribe((event) => {
    log.write(jsonl({ ts: new Date().toISOString(), event }))
    if (event.type === 'turn_end') {
      turns += 1
      maybeNudge()
      if (turns >= options.maxTurns && abortReason === null) {
        abortReason = `turn cap ${options.maxTurns} reached`
        void session.abort()
      }
    }
  })

  const timeout = setTimeout(() => {
    if (abortReason === null) {
      abortReason = `session timeout after ${Math.round(options.timeoutMs / 60_000)} minutes`
      void session.abort()
    }
  }, options.timeoutMs)

  emit({ type: 'session.started' })
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
