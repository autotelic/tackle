import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentSessionEvent, ToolDefinition } from '@earendil-works/pi-coding-agent'
import { afterEach, describe, expect, it } from 'vitest'
import type { CheckReport } from '../src/report.ts'
import {
  createTestCommandDenyFactory,
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
  resourceLoader?: unknown
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

  it('rejects a model that is not in the catalog, up front', async () => {
    const result = await run(
      async () => {
        throw new Error('session must never start')
      },
      { model: { provider: 'opencode-go', id: 'not-a-real-model' } },
    )
    expect(result.outcome.terminal).toBe('failed')
    expect(result.outcome.reason).toContain('not-a-real-model')
    expect(result.outcome.reason).toContain('catalog')
  })

  it('resolves a configured model and reports it in the stream metadata (glm-5.3-flash on opencode-go)', async () => {
    const { outcome, events } = await run(
      async (_f, emit) => {
        emit(ev({ type: 'agent_start' }))
        emit(ev({ type: 'turn_start' }))
        settle(emit)
      },
      { model: { provider: 'opencode-go', id: 'glm-5.3-flash' } },
    )
    expect(outcome.terminal).toBe('completed')
    // The driver's own record of the model it ran on.
    const started = JSON.stringify(events.find((e) => e.type === 'session.started'))
    expect(started).toContain('glm-5.3-flash')
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

type RunChecksTool = {
  execute: (
    toolCallId: string,
    params: Record<string, never>,
    signal: AbortSignal | undefined,
    onUpdate: undefined,
    ctx: unknown,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details: unknown }>
}

const failingReport = (): CheckReport => ({
  issue: 3,
  pass: 2,
  repo: '/x',
  branch: 'loop/3',
  startedAt: '2026-11-18T00:00:00Z',
  durationMs: 2000,
  outcome: 'checks.failed',
  infrastructureFailure: null,
  steps: [],
  failureSet: [
    {
      check: 'rest-gate',
      test: 'client contact cannot see foreign tenant',
      detail: 'expected 403 got 200',
    },
  ],
  frontier: 1,
})

describe('runSession — run_checks', () => {
  it('executes the deterministic runner and returns the structured failure set', async () => {
    let runs = 0
    const { outcome, events, fake } = await run(
      async (fakeSession, emit, getTools) => {
        const tool = getTools().find((t) => t.name === 'run_checks') as unknown as RunChecksTool
        fakeSession.toolResult = await tool.execute('call-1', {}, undefined, undefined, {})
        settle(emit)
      },
      {
        runChecks: () => {
          runs++
          return Promise.resolve({
            report: failingReport(),
            reportDir: '/x/.treadle/checks-inflight',
          })
        },
      },
    )
    expect(outcome.terminal).toBe('completed')
    expect(runs).toBe(1)
    const text = fake.toolResult?.content[0]?.text ?? ''
    expect(text).toContain('checks.failed — frontier 1')
    expect(text).toContain('rest-gate › client contact cannot see foreign tenant')
    expect(text).toContain('/x/.treadle/checks-inflight/checks.json')
    expect(events).toContainEqual({ type: 'session.checks_requested' })
    expect(events).toContainEqual({
      type: 'session.checks_result',
      outcome: 'checks.failed',
      frontier: 1,
      failureCount: 1,
      reportDir: '/x/.treadle/checks-inflight',
    })
  })

  it('renders an infrastructure failure as stop-and-describe, not a retry invitation', async () => {
    const { fake } = await run(
      async (fakeSession, emit, getTools) => {
        const tool = getTools().find((t) => t.name === 'run_checks') as unknown as RunChecksTool
        fakeSession.toolResult = await tool.execute('call-1', {}, undefined, undefined, {})
        settle(emit)
      },
      {
        runChecks: () =>
          Promise.resolve({
            report: {
              ...failingReport(),
              outcome: null,
              infrastructureFailure: { kind: 'port-busy', detail: 'port 5433 busy' },
            },
            reportDir: '/x/.treadle/checks-inflight',
          }),
      },
    )
    const text = fake.toolResult?.content[0]?.text ?? ''
    expect(text).toContain('INFRASTRUCTURE FAILURE — port-busy')
    expect(text).toContain('Do not retry')
  })

  it('refuses past the per-session cap and keeps the session alive', async () => {
    let runs = 0
    const { events } = await run(
      async (_fakeSession, emit, getTools) => {
        const tool = getTools().find((t) => t.name === 'run_checks') as unknown as RunChecksTool
        const first = await tool.execute('call-1', {}, undefined, undefined, {})
        expect(JSON.stringify(first.details)).not.toContain('refused')
        const second = await tool.execute('call-2', {}, undefined, undefined, {})
        expect((second.details as { refused?: boolean }).refused).toBe(true)
        settle(emit)
      },
      {
        maxCheckRuns: 1,
        runChecks: () => {
          runs++
          return Promise.resolve({ report: failingReport(), reportDir: '/x/r' })
        },
      },
    )
    expect(runs).toBe(1)
    expect(events).toContainEqual({
      type: 'session.checks_result',
      outcome: 'refused',
      detail: '1-run cap reached',
    })
  })

  it('arms the tool and the deny loader together, and neither without the runner', async () => {
    const without = await run(async (_f, emit) => settle(emit))
    const capturedWithout = without.captured as CapturedCreate | null
    expect(capturedWithout?.customTools.map((t) => t.name)).toEqual(['ask_human'])
    expect(capturedWithout?.resourceLoader).toBeUndefined()

    const withRunner = await run(async (_f, emit) => settle(emit), {
      runChecks: () => Promise.resolve({ report: failingReport(), reportDir: '/x/r' }),
    })
    const capturedWith = withRunner.captured as CapturedCreate | null
    expect(capturedWith?.customTools.map((t) => t.name)).toEqual(['ask_human', 'run_checks'])
    expect(capturedWith?.resourceLoader).toBeDefined()
  })
})

describe('TEST_RUN_COMMAND — the bash deny-pattern', () => {
  const pi = {
    handlers: [] as Array<(event: { toolName: string; input?: unknown }) => unknown>,
    on(name: string, handler: (event: { toolName: string; input?: unknown }) => unknown) {
      if (name === 'tool_call') this.handlers.push(handler)
    },
  }
  const deny = createTestCommandDenyFactory()
  deny.factory(pi as never)
  const handle = (command: string) => {
    for (const handler of pi.handlers) {
      const result = handler({ toolName: 'bash', input: { command } })
      if (result) return result as { block: boolean; reason: string }
    }
    return null
  }

  it('blocks suite-runner invocations with the run_checks way out', () => {
    for (const command of [
      'pnpm test',
      'pnpm --filter @x/domain test:finance',
      'npm test',
      'npx vitest run',
      'cd services/rest && TEST_DB_PORT=5433 TEST_REDIS_PORT=6380 pnpm test:rest:file',
      'export PATH="$PNPM_HOME:$PATH" && npx mocha --reporter-options x',
      'eval "$(fnm env)" && pnpm test',
      'pytest -q',
    ]) {
      const blocked = handle(command)
      expect(blocked?.block, command).toBe(true)
      expect(blocked?.reason, command).toContain('run_checks')
    }
  })

  it('leaves inspection, git, install and narrow non-test commands alone', () => {
    for (const command of [
      'cat PROGRESS.md',
      'git status --porcelain',
      'git diff --name-only',
      'pnpm install --frozen-lockfile',
      'node scripts/lint-errors-changed.mjs --base origin/main',
      'ls .treadle/reports',
      'grep -rn "frontier" src/ | head',
      'oxfmt --check src/foo.ts',
      'echo hello world',
    ]) {
      expect(handle(command), command).toBeNull()
    }
  })

  it('only intercepts bash', () => {
    for (const handler of pi.handlers) {
      expect(handler({ toolName: 'read', input: {} })).toBeUndefined()
    }
  })
})
