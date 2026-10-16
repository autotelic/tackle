import { Effect } from "effect"
import {
  diffBaseline,
  makeReport,
  ratchetViolations,
  type Baseline,
  type BaselineDiff,
  type HarnessConfig,
  type Report,
} from "@autotelic/protocol"
import type { Spawner } from "./exec.ts"
import { runEngines } from "./engines.ts"

/*
 * One run: every engine, one report, one diff against the ledger.
 *
 * `files` counts the files that actually produced a finding. Summing what each engine
 * scanned would double-count every file two engines looked at and answer a question a
 * report does not need answered; the useful fact is "how much surface is dirty".
 */

export interface HarnessRun {
  readonly report: Report
  readonly diff: BaselineDiff
  readonly violations: ReadonlyArray<string>
}

/** Run every configured engine and compare the result to what was accepted. */
export const harnessRun = (
  root: string,
  config: HarnessConfig,
  baseline: Baseline,
): Effect.Effect<HarnessRun, never, Spawner> =>
  Effect.gen(function* () {
    const started = Date.now()
    const outcomes = yield* runEngines(root, config.engines)
    const diagnostics = outcomes.flatMap((outcome) => outcome.diagnostics)
    const report = makeReport({
      diagnostics,
      files: new Set(diagnostics.map((diagnostic) => diagnostic.location.file)).size,
      generators: outcomes.map((outcome) => outcome.summary),
      elapsedMs: Date.now() - started,
    })
    const diff = diffBaseline(baseline, report.diagnostics)
    return { report, diff, violations: ratchetViolations(diff) }
  })
