#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
/**
 * Drive one Session through the Pi SDK and observe it to a Terminal state (#12).
 *
 * Usage: node src/run-session.ts --repo <path> (--prompt <text> | --prompt-file <path>)
 *          [--cwd <worktree>] [--max-turns <n>] [--timeout-minutes <n>]
 *          [--ask-timeout-minutes <n>] [--log <path>]
 *
 * Cap defaults come from the repo's loop.config.ts budgets. The human channel
 * is the terminal until #14: answer ask_human questions on stdin.
 *
 * Exit code: 0 = completed, 1 = failed, 2 = blocked-on-human.
 */
import { loadConfig } from './config.ts'
import { runSession } from './session.ts'
import { createTerminalHumanChannel } from './terminal-human.ts'

function parseArgs(argv: string[]): Record<string, string> {
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
  if (!args.repo || (!args.prompt && !args.promptFile)) {
    console.error(
      'usage: node src/run-session.ts --repo <path> (--prompt <text> | --prompt-file <path>) ' +
        '[--cwd <worktree>] [--max-turns <n>] [--timeout-minutes <n>] [--ask-timeout-minutes <n>] [--log <path>]',
    )
    process.exit(64)
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const repoDir = resolve(args.repo)
const config = await loadConfig(join(repoDir, 'loop.config.ts'))
const cwd = args.cwd ? resolve(args.cwd) : repoDir
const prompt = args.prompt ?? (await readFile(args.promptFile as string, 'utf8'))
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const logPath = args.log ? resolve(args.log) : join(repoDir, '.treadle', `session-${stamp}.jsonl`)

const human = createTerminalHumanChannel()
const askHuman = human.askHuman

const outcome = await runSession({
  cwd,
  prompt,
  maxTurns: args['max-turns'] ? Number(args['max-turns']) : config.budgets.maxTurnsPerSession,
  timeoutMs:
    (args['timeout-minutes']
      ? Number(args['timeout-minutes'])
      : config.budgets.sessionTimeoutMinutes) * 60_000,
  askHumanTimeoutMs:
    (args['ask-timeout-minutes']
      ? Number(args['ask-timeout-minutes'])
      : config.budgets.askHumanTimeoutMinutes) * 60_000,
  askHuman,
  logPath,
  onEvent: (event) => {
    if (event.type === 'session.blocked') console.log('\nsession.blocked — see question below')
  },
})
human.close()

console.log(`\nterminal: ${outcome.terminal}${outcome.reason ? ` — ${outcome.reason}` : ''}`)
console.log(`turns: ${outcome.turns}  duration: ${(outcome.durationMs / 1000).toFixed(1)}s`)
if (outcome.lastAssistantText)
  console.log(`\nlast assistant message:\n${outcome.lastAssistantText}`)
console.log(`\nlog: ${outcome.logPath}`)

process.exit(outcome.terminal === 'completed' ? 0 : outcome.terminal === 'failed' ? 1 : 2)
