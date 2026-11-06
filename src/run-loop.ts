#!/usr/bin/env node
/**
 * The Loop (#15): works through a repo's ready issues one after another,
 * escalating on Telegram when it gets stuck.
 *
 * Usage: node src/run-loop.ts --repo <path> [--channel terminal|telepi]
 *
 * Exit code: 0 = stopped cleanly (nothing left, cap, Stop, or circuit breaker),
 * 1 = startup reconciliation failed.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createEffectActor, join as joinActor } from '@xstate/effect'
import { Effect } from 'effect'
import { createIssueAnswerHandler, watchAnswers } from './answer-watcher.ts'
import { loadConfig } from './config.ts'
import { createHumanChannel, type HumanChannel } from './human-channel.ts'
import { makeEscalate } from './loop/escalate.ts'
import { appendQa, pickNextIssue, runIssueLoop } from './loop/issue-loop.ts'
import { buildLoopMachine, type LoopMachineDeps } from './loop/machine.ts'
import { reconcile } from './loop/reconcile.ts'
import { lintRules } from './loop/rules.ts'
import { loadTelePiConfig, sendTelegramMessage } from './telepi.ts'

function parseArgs(argv: string[]): { repo: string; channel?: 'terminal' | 'telepi' } {
  const args: Record<string, string> = {}
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i]
    const value = argv[i + 1]
    if (!key?.startsWith('--') || value === undefined) {
      console.error(`bad argument near '${key ?? '<end>'}'`)
      process.exit(64)
    }
    args[key.slice(2)] = value
  }
  if (!args.repo) {
    console.error('usage: node src/run-loop.ts --repo <path> [--channel terminal|telepi]')
    process.exit(64)
  }
  const channel = args.channel
  if (channel !== undefined && channel !== 'terminal' && channel !== 'telepi') {
    console.error('--channel must be terminal or telepi')
    process.exit(64)
  }
  return { repo: resolve(args.repo), ...(channel ? { channel } : {}) }
}

const args = parseArgs(process.argv.slice(2))
const repoDir = args.repo
const config = await loadConfig(join(repoDir, 'loop.config.ts'))

for (const warning of lintRules(config.rules ?? [])) console.warn(`rules: ${warning}`)

// ── Startup reconciliation (#8) ─────────────────────────────────────────
const startup = await reconcile(repoDir, config).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
if (startup.kind === 're-enter') {
  console.log(`re-entering working issue #${startup.issue.number} "${startup.issue.title}"`)
}

// ── Human channel, notifications, the answer watcher ────────────────────
const human: HumanChannel = await createHumanChannel(args.channel)
const notify = async (text: string) => {
  console.log(`[notify] ${text}`)
  try {
    const telePi = await loadTelePiConfig()
    await sendTelegramMessage(telePi, text)
  } catch (error) {
    console.warn(`telegram notify failed: ${String(error)}`)
  }
}

const answeredFirst = new Set<number>()

let sendToMachine: (event: { type: string; reason?: string }) => void = () => {}
const questionsDir = join(homedir(), '.treadle', 'questions')
const answersDir = join(homedir(), '.treadle', 'answers')
const postAndRelabel = createIssueAnswerHandler({ repoDir, config })
const watcher = watchAnswers({
  questionsDir,
  answersDir,
  onAnswer: async ({ question, answer }) => {
    await postAndRelabel({ question, answer })
    if (question.issue !== undefined) {
      await appendQa(repoDir, question.issue, {
        question: question.question,
        answer: answer.answer,
      })
      answeredFirst.add(question.issue)
    }
    sendToMachine({ type: 'answer.arrived' })
  },
})

// ── Machine deps ────────────────────────────────────────────────────────
const nightly = {
  n: 0,
  increment() {
    return ++this.n
  },
  value() {
    return this.n
  },
}

// A re-entered working issue goes first (#8): the machine's initial state
// is 'picking', so the queue poll must return it ahead of everything else.
let reenterIssue = startup.kind === 're-enter' ? startup.issue : null

const machineDeps: LoopMachineDeps = {
  pickIssue: () => {
    if (reenterIssue) {
      const issue = reenterIssue
      reenterIssue = null
      return Promise.resolve(issue)
    }
    return pickNextIssue(repoDir, config, (issue) => answeredFirst.has(issue))
  },
  makeIssueLoop: (issue) =>
    runIssueLoop({
      repoDir,
      config,
      issue,
      human,
      notify,
      passesTonight: nightly,
      resume: startup.kind === 're-enter' && startup.issue.number === issue.number,
    }),
  escalate: makeEscalate({
    repoDir,
    config,
    human,
    notify,
    requestStop: (reason) => sendToMachine({ type: 'stop.requested', reason }),
  }),
  notify,
  parksToStop: config.budgets.stopAfterParkedInARow,
}

// ── Run ─────────────────────────────────────────────────────────────────
await notify(
  startup.kind === 're-enter'
    ? `Treadle starting, re-entering issue #${startup.issue.number}.`
    : 'Treadle starting.',
)

const program = Effect.gen(function* () {
  const machine = buildLoopMachine()
  const actor = yield* createEffectActor(machine, {
    input: {
      deps: machineDeps,
      ...(startup.kind === 're-enter' ? { initialIssue: startup.issue } : {}),
    },
  })
  sendToMachine = (event) => actor.send(event as never)
  yield* joinActor(actor)
  const context = actor.getSnapshot().context as { stopReason: string | null; parksInARow: number }
  return context
})

const finalContext = await Effect.runPromise(Effect.scoped(program))
watcher.stop()
await startup.unlock()
const reason = finalContext.stopReason ?? 'nothing left to do'
console.log(`\nTreadle stopped: ${reason}`)
await notify(`Treadle stopped: ${reason}`)
process.exit(0)
