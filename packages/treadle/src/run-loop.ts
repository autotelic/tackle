#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
/**
 * The Loop (#15): works through a repo's ready issues one after another,
 * escalating on Telegram when it gets stuck.
 *
 * Usage: node src/run-loop.ts --repo <path> [--channel terminal|telepi]
 *
 * An empty queue doesn't stop the Loop: it waits, polling every 60s, and
 * runs stack maintenance at most hourly as merges land (which can unblock
 * the queue). Exit code: 0 = stopped cleanly (nightly cap, Stop answer,
 * circuit breaker), 1 = startup reconciliation failed.
 */
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createEffectActor, join as joinActor } from '@xstate/effect'
import { Effect } from 'effect'
import { createIssueAnswerHandler, watchAnswers } from './answer-watcher.ts'
import { hashConfigText, loadConfig } from './config.ts'
import { createHumanChannel, type HumanChannel } from './human-channel.ts'
import { makeEscalate } from './loop/escalate.ts'
import { tuneHttpDispatcher } from './loop/http-tuning.ts'
import { appendQa, pickNextIssue, runIssueLoop } from './loop/issue-loop.ts'
import { buildLoopMachine, type LoopMachineDeps } from './loop/machine.ts'
import { installFetchDiagnostics } from './loop/netlog.ts'
import { createNightlyBudget } from './loop/nightly.ts'
import { reconcile } from './loop/reconcile.ts'
import { lintRules } from './loop/rules.ts'
import { maintenance } from './maintenance.ts'
import { loadTelePiConfig, sendTelegramMessage, telePiConfigExists } from './telepi.ts'

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
const configPath = join(repoDir, 'loop.config.ts')
const configText = await readFile(configPath, 'utf8')
const configHash = hashConfigText(configText)
const config = await loadConfig(configPath)

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
const liveQuestionIds = new Set<string>()
const human: HumanChannel = await createHumanChannel(args.channel, undefined, {
  liveIds: liveQuestionIds,
})
// Telegram only when it is the chosen channel. `--channel terminal` still tried to send, so every
// unattended run logged `telegram notify failed: ENOENT ~/.config/telepi/config.env` on every
// notification — noise that trains people to ignore the log line that would matter.
const telegramEnabled =
  args.channel === 'telepi' || (args.channel === undefined && (await telePiConfigExists()))
const notify = async (text: string) => {
  console.log(`[notify] ${text}`)
  if (!telegramEnabled) return
  try {
    const telePi = await loadTelePiConfig()
    await sendTelegramMessage(telePi, text)
  } catch (error) {
    console.warn(`telegram notify failed: ${String(error)}`)
  }
}

// Record WHY a provider call failed (code, syscall, hostname) instead of the
// SDK's single "Connection error." string. Behaviour is unchanged; the cause is
// kept for the loop's notices and written to .treadle/net-errors.jsonl.
installFetchDiagnostics((failure) => {
  console.error(`[net] ${JSON.stringify(failure)}`)
})

// The SDK only installs its HTTP/2-disabled dispatcher on its own CLI path; the
// embedded one inherits a pool that serves dead h2 sessions (see the module).
console.error(`[net] dispatcher: ${await tuneHttpDispatcher()}`)

// Stack maintenance on startup (#17): merges land at human pace; catch up
// on marking done, rebasing stacked branches and retargeting PRs before
// picking. The Loop already holds the lock.
try {
  const report = await maintenance({ repoDir, config, notify, withLock: false })
  const actions =
    report.autoMerged.length +
    report.markedDone.length +
    report.rebased.length +
    report.retargeted.length +
    report.parked.length
  if (actions > 0 || report.conflicts.length > 0) {
    console.log(
      `maintenance: merged [${report.autoMerged.join(', ')}] · done [${report.markedDone.join(', ')}] · ` +
        `rebased [${report.rebased.join(', ')}] · ` +
        `retargeted [${report.retargeted.join(', ')}] · parked [${report.parked.join(', ')}] · ` +
        `conflicts [${report.conflicts.join(', ')}]`,
    )
  }
} catch (error) {
  console.warn(`maintenance failed, continuing to the queue: ${String(error)}`)
}

const answeredFirst = new Set<number>()

let sendToMachine: (event: { type: string; reason?: string }) => void = () => {}
const questionsDir = join(homedir(), '.treadle', 'questions')
const answersDir = join(homedir(), '.treadle', 'answers')
const postAndRelabel = createIssueAnswerHandler({ repoDir, config })
const watcher = watchAnswers({
  questionsDir,
  answersDir,
  isLive: (id) => liveQuestionIds.has(id),
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
// The durable nightly budget (#18): passes + dollars per day, persisted
// per Pass so a restart can't reset it.
const nightly = await createNightlyBudget({ config, repoDir })

// A re-entered working issue goes first (#8): the machine's initial state
// is 'picking', so the queue poll must return it ahead of everything else.
let reenterIssue = startup.kind === 're-enter' ? startup.issue : null

// Idle maintenance runs at most hourly (#17); the startup pass just ran, so
// the clock starts now.
let lastMaintenanceAt = Date.now()

const machineDeps: LoopMachineDeps = {
  pickIssue: async () => {
    if (reenterIssue) {
      const issue = reenterIssue
      reenterIssue = null
      return issue
    }
    // Throttled maintenance at every pick boundary, not only when idle:
    // with an integration branch (ADR-0003) the Loop is the merger, and its
    // merges unblock the queue — so merges must land between sessions too,
    // not just after the whole queue drains. Without one, merges land at
    // human pace (#17) and hourly is fine. A no-op pass is one fetch + one
    // PR list call.
    const idleEveryMs = config.integrationBranch ? 60_000 : 3_600_000
    if (Date.now() - lastMaintenanceAt > idleEveryMs) {
      lastMaintenanceAt = Date.now()
      await maintenance({ repoDir, config, notify, withLock: false }).catch((error: unknown) => {
        console.warn(`maintenance failed (next poll retries): ${String(error)}`)
      })
    }
    const issue = await pickNextIssue(repoDir, config, (n) => answeredFirst.has(n))
    if (issue) return issue
    return null
  },
  makeIssueLoop: (issue) =>
    runIssueLoop({
      configHash,
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
// A harness failure (an issue loop or queue poll erroring) is not a clean
// stop: exit non-zero so launchd's KeepAlive restarts the Loop instead of
// leaving it resting until the next calendar start. A genuinely crashy bug
// just throttles — visible in `last exit`, never silent.
const failed = reason.startsWith('issue loop failed') || reason.startsWith('queue poll failed')
process.exit(failed ? 1 : 0)
