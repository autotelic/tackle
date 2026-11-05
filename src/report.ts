import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** One failing test from a Check's JSON test report. */
export type FailingTest = {
  fullName: string
  failureMessages: string[]
}

export type StepResult = {
  name: string
  /** null when the step was killed before exit (timeout). */
  exitCode: number | null
  durationMs: number
  /** Last few KB of combined output; the full log is at logPath. */
  logTail: string
  /** Full log, relative to the report directory. */
  logPath: string
  timedOut?: boolean
  report?: {
    format: 'vitest-json'
    failingTests: FailingTest[]
  }
}

/**
 * A Check-harness failure, distinct from a Check failure: the Loop Pauses on these (#9)
 * instead of spending an issue's budget on a failed Pass.
 */
export type InfrastructureFailure = {
  kind: 'install-failed' | 'port-busy' | 'app-not-healthy' | 'step-timeout' | 'report-unreadable'
  /** The Check step involved, for step-timeout and report-unreadable. */
  step?: string
  detail: string
}

export type FailureSetEntry = {
  check: string
  /** Set when the failure is one failing test from a JSON report; absent for whole-Check failures. */
  test?: string
  detail?: string
}

export type CheckReport = {
  issue: number | null
  pass: number | null
  repo: string
  branch: string | null
  startedAt: string
  durationMs: number
  /** null when infrastructureFailure is set: the run is a Pause, not a Pass outcome. */
  outcome: 'checks.passed' | 'checks.failed' | null
  infrastructureFailure: InfrastructureFailure | null
  steps: StepResult[]
  failureSet: FailureSetEntry[]
  /** |Failure set|, the number the retry budget and stall rules compare across Passes. */
  frontier: number
}

/** Parse a vitest JSON report down to its failing tests. */
export function parseVitestJsonReport(text: string): FailingTest[] {
  const data = JSON.parse(text) as {
    testResults?: Array<{
      assertionResults?: Array<{
        fullName?: string
        title?: string
        status?: string
        failureMessages?: string[]
      }>
    }>
  }
  const failing: FailingTest[] = []
  for (const file of data.testResults ?? []) {
    for (const assertion of file.assertionResults ?? []) {
      if (assertion.status === 'failed') {
        failing.push({
          fullName: assertion.fullName ?? assertion.title ?? '<unknown test>',
          failureMessages: assertion.failureMessages ?? [],
        })
      }
    }
  }
  return failing
}

const MAX_DETAIL = 500

/**
 * Build the Failure set for a Pass: one entry per failing Check that has no test
 * report, plus one per failing test from those that do (GLOSSARY.md).
 */
export function buildFailureSet(steps: StepResult[]): FailureSetEntry[] {
  const entries: FailureSetEntry[] = []
  for (const step of steps) {
    if (step.timedOut || step.exitCode === 0 || step.exitCode === null) continue
    const failingTests = step.report?.failingTests ?? []
    if (step.report && failingTests.length > 0) {
      for (const test of failingTests) {
        entries.push({
          check: step.name,
          test: test.fullName,
          detail: test.failureMessages[0]?.slice(0, MAX_DETAIL),
        })
      }
    } else {
      entries.push({
        check: step.name,
        detail: `exit code ${step.exitCode}`,
      })
    }
  }
  return entries
}

/** Write checks.json into outDir. Log files are written by the runner as steps complete. */
export async function writeCheckReport(outDir: string, report: CheckReport): Promise<string> {
  await mkdir(outDir, { recursive: true })
  const path = join(outDir, 'checks.json')
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`)
  return path
}
