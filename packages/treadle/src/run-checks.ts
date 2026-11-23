#!/usr/bin/env node
/**
 * Run the Checks against a repository and write a check report (#11).
 *
 * Usage: node src/run-checks.ts --repo <path> [--issue <n>] [--pass <n>] [--out <dir>]
 *
 * Exit code: 0 = checks.passed, 1 = checks.failed, 2 = infrastructure failure (Pause).
 */
import { join, resolve } from 'node:path'
import { runChecks } from './checks.ts'
import { loadConfig } from './config.ts'
import { writeCheckReport } from './report.ts'

function parseArgs(argv: string[]): {
  repo: string
  issue?: number
  pass?: number
  out?: string
} {
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
    console.error(
      'usage: node src/run-checks.ts --repo <path> [--issue <n>] [--pass <n>] [--out <dir>]',
    )
    process.exit(64)
  }
  return {
    repo: resolve(args.repo),
    issue: args.issue ? Number(args.issue) : undefined,
    pass: args.pass ? Number(args.pass) : undefined,
    out: args.out ? resolve(args.out) : undefined,
  }
}

const args = parseArgs(process.argv.slice(2))
const config = await loadConfig(join(args.repo, 'loop.config.ts'))
const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-')
const outDir = args.out ?? join(args.repo, '.treadle', `checks-${stamp}`)
const report = await runChecks(config, {
  repoDir: args.repo,
  outDir,
  ...(args.issue !== undefined ? { issue: args.issue } : {}),
  ...(args.pass !== undefined ? { pass: args.pass } : {}),
})
const reportPath = await writeCheckReport(outDir, report)

for (const step of report.steps) {
  const status = step.timedOut
    ? 'TIMEOUT'
    : step.exitCode === 0
      ? 'ok'
      : `FAILED (${step.exitCode})`
  console.log(`${status.padEnd(12)} ${step.name}  (${(step.durationMs / 1000).toFixed(1)}s)`)
}
if (report.infrastructureFailure) {
  console.log(
    `\ninfrastructure failure [${report.infrastructureFailure.kind}]: ${report.infrastructureFailure.detail}`,
  )
} else {
  console.log(`\n${report.outcome} — frontier ${report.frontier}`)
  for (const entry of report.failureSet) {
    console.log(`  ✗ ${entry.check}${entry.test ? ` › ${entry.test}` : ''}`)
  }
}
console.log(`\nreport: ${reportPath}`)

process.exit(report.infrastructureFailure ? 2 : report.outcome === 'checks.passed' ? 0 : 1)
