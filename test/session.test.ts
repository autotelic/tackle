import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import {
  type RunSessionOptions,
  runSession,
  type SessionDriverEvent,
  type SessionLike,
} from '../src/session.ts'

type Emit = (event: AgentSessionEvent) => void
type Script = (
  fake: FakeSession,
  emit: Emit,
  getTools: () => ToolDefinition[],
) => Promise<void> | void

type ToolResult = { content: Array<{ type: string; text?: string }>; details: unknown }

class FakeSession implements SessionLike {
  agent = { state: {} as { errorMessage?: string } }
  aborted = false
  disposed = false
  toolResult: ToolResult | null = null
  prompts: string[] = []
  private listeners: Emit[] = []
  private script: Script

  constructor(script: Script) {
    this.script = script
  }

  subscribe(listener: Emit) {
    this.listeners.push(listener)
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener)
    }
  }

  emit(event: AgentSessionEvent) {
    for (const listener of this.listeners) listener(event)
  }

  getTools: () => ToolDefinition[] = () => []

  async prompt(_text: string) {
    this.prompts.push(_text)
    await this.script(this, (event) => this.emit(event), this.getTools)
  }

  async abort() {
    this.aborted = true
  }

  dispose() {
    this.disposed = true
  }

  getLastAssistantText() {
    return 'fake last text'
  }

  getSessionStats() {
    return { tokens: { total: 1000 }, cost: 0.01 }
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const ev = (event: unknown): AgentSessionEvent => event as AgentSessionEvent
const turnEnd = ev({ type: 'turn_end', message: {}, toolResults: [] })

function settle(emit: Emit) {
  emit(turnEnd)
  emit(ev({ type: 'agent_end', messages: [], willRetry: false }))
  emit(ev({ type: 'agent_settled', aborted: false }))
}

type CapturedCreate = {
  cwd: string
  sessionManager: unknown
  customTools: ToolDefinition[]
}

type AskHumanTool = {
  execute: (
    toolCallId: string,
    params: { question: string },
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details: unknown }>
}

let tmp: string | null = null

afterEach(async () => {
  if (tmp) await rm(tmp, { recursive: true, force: true })
  tmp = null
})

async function run(script: Script, overrides: Partial<RunSessionOptions> = {}) {
  tmp = await mkdtemp(join(tmpdir(), 'treadle-session-'))
  const fake = new FakeSession(script)
  let captured: CapturedCreate | null = null
  fake.getTools = () => captured?.customTools ?? []
  const events: SessionDriverEvent[] = []
  const outcome = await runSession(
    {
      cwd: tmp,
      prompt: 'do the thing',
      maxTurns: 10,
      timeoutMs: 10_000,
      askHumanTimeoutMs: 500,
      askHuman: async () => 'blue',
      logPath: join(tmp, 'session.jsonl'),
      onEvent: (event) => events.push(event),
      ...overrides,
    },
    {
      createSession: async (options) => {
        captured = options
        return { session: fake }
      },
    },
  )
  const log = await readFile(join(tmp, 'session.jsonl'), 'utf8')
  return {
    outcome,
    fake,
    captured,
    events,
    log: log
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l)),
  }
}

describe('runSession', () => {
  it('observes a clean run to completed and logs every event as JSONL', async () => {
    const { outcome, fake, log } = await run((_, emit) => {
      emit(ev({ type: 'agent_start' }))
      emit(ev({ type: 'turn_start' }))
      settle(emit)
    })
    expect(outcome.terminal).toBe('completed')
    expect(outcome.turns).toBe(1)
    expect(outcome.lastAssistantText).toBe('fake last text')
    expect(fake.disposed).toBe(true)

    const eventTypes = log.map((l) => l.event?.type ?? l.driver?.type)
    expect(eventTypes).toContain('agent_start')
    expect(eventTypes).toContain('turn_end')
    expect(eventTypes).toContain('session.started')
    expect(eventTypes.at(-1)).toBe('session.terminal')
  })

  it('nudges at half and four-fifths of the turn budget', async () => {
    const { fake, events } = await run(
      async (f, emit) => {
        if (f.prompts.length === 1) {
          for (let i = 0; i < 99; i++) emit(turnEnd) // settle() adds the 100th
          settle(emit)
        }
      },
      { maxTurns: 100 },
    )
    expect(fake.prompts).toHaveLength(3)
    expect(fake.prompts[1]).toContain('50 of 100 turns')
    expect(fake.prompts[1]).toContain('Start converging now')
    expect(fake.prompts[2]).toContain('80 of 100 turns')
    expect(fake.prompts[2]).toContain('Stop exploring')
    const nudges = events.filter((e) => e.type === 'session.nudge')
    expect(nudges).toHaveLength(2)
  })

  it('survives a nudge the session rejects, and nudges only at the budget fractions', async () => {
    const { fake, events, outcome } = await run(
      async (f, emit) => {
        if (f.prompts.length === 1) {
          for (let i = 0; i < 8; i++) emit(turnEnd) // settle() adds the 9th
          settle(emit)
        } else {
          throw new Error('prompt exploded')
        }
      },
      { maxTurns: 10 },
    )
    // Nudges at turns 5 and 8, never on other turns; both rejected, the
    // session still reaches its own terminal state rather than failing on
    // the harness's message.
    expect(events.filter((e) => e.type === 'session.nudge').map((e) => e.turns)).toEqual([5, 8])
    expect(fake.prompts).toHaveLength(3)
    expect(outcome.terminal).toBe('completed')
  })

  it('reports failed when the session ends with an error message', async () => {
    const { outcome } = await run((fake, emit) => {
      settle(emit)
      fake.agent.state.errorMessage = 'provider exploded'
    })
    expect(outcome.terminal).toBe('failed')
    expect(outcome.reason).toBe('provider exploded')
  })

  it('aborts past the turn cap and reports failed', async () => {
    const { outcome } = await run(
      async (fake, emit) => {
        while (!fake.aborted) {
          emit(turnEnd)
          await sleep(5)
        }
      },
      { maxTurns: 3 },
    )
    expect(outcome.terminal).toBe('failed')
    expect(outcome.reason).toContain('turn cap 3')
    expect(outcome.turns).toBeGreaterThanOrEqual(3)
  })

  it('aborts at the wall-clock timeout and reports failed', async () => {
    const { outcome } = await run(
      async (fake) => {
        while (!fake.aborted) await sleep(10)
      },
      { timeoutMs: 100 },
    )
    expect(outcome.terminal).toBe('failed')
    expect(outcome.reason).toContain('session timeout')
  })

  it('round-trips an ask_human call and stays alive while waiting', async () => {
    const { outcome, events, fake } = await run(
      async (fakeSession, emit, getTools) => {
        const askHuman = getTools()[0] as unknown as AskHumanTool
        fakeSession.toolResult = await askHuman.execute(
          'call-1',
          { question: 'favourite colour?' },
          undefined,
          undefined,
          {},
        )
        settle(emit)
      },
      {
        askHuman: async (question) => {
          expect(question).toBe('favourite colour?')
          await sleep(50) // the Session stays alive while it waits
          return 'blue'
        },
      },
    )
    expect(outcome.terminal).toBe('completed')
    expect(fake.toolResult?.content[0]?.text).toBe('blue')
    expect(events).toContainEqual({ type: 'session.blocked', question: 'favourite colour?' })
    expect(events).toContainEqual({ type: 'session.unblocked' })
  })

  it('ends blocked-on-human when ask_human gets no answer in time', async () => {
    const { outcome, fake } = await run(
      async (fakeSession, emit, getTools) => {
        const askHuman = getTools()[0] as unknown as AskHumanTool
        fakeSession.toolResult = await askHuman.execute(
          'call-1',
          { question: 'deploy to prod?' },
          undefined,
          undefined,
          {},
        )
        settle(emit)
      },
      {
        askHumanTimeoutMs: 50,
        askHuman: () => new Promise<string>(() => {}),
      },
    )
    expect(outcome.terminal).toBe('blocked-on-human')
    expect(outcome.reason).toBe('deploy to prod?')
    expect(fake.toolResult?.content[0]?.text).toContain('No answer arrived')
  })
})
