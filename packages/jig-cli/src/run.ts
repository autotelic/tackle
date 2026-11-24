import { Effect } from "effect"
import {
  diffBaseline,
  makeReport,
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
  /**
   * Findings the engines produced outside the requested change set, when the run was scoped.
   *
   * The engines read the whole tree; a scoped run narrows the report afterwards. This is what
   * that narrowing set aside, carried so the report can say so instead of looking clean.
   */
  readonly outOfScope?: number
}

/**
 * The subset of a report inside a change set, with every count recomputed.
 *
 * Filtering the diagnostics alone would leave the census describing a run that was not the
 * one printed: an engine's summary would claim 1,178 findings while its own list held three.
 * So each engine's counts are recounted over what survived, and everything the engine said
 * about HOW it ran -- replayed, skipped, unjudged candidates, its note -- is carried through
 * untouched. A scoped run must still be able to say "I did not look at that".
 */
export const scopeReport = (report: Report, touched: ReadonlySet<string>): Report => {
  const scoped = report.diagnostics.filter((diagnostic) => touched.has(diagnostic.location.file))
  const scopedInput = {
    diagnostics: scoped,
    files: new Set(scoped.map((diagnostic) => diagnostic.location.file)).size,
    generators: report.generators.map((generator) => {
      const own = scoped.filter((diagnostic) => diagnostic.engine === generator.id)
      return {
        ...generator,
        diagnostics: own.length,
        error: own.filter((diagnostic) => diagnostic.severity === "error").length,
        warn: own.filter((diagnostic) => diagnostic.severity === "warn").length,
        info: own.filter((diagnostic) => diagnostic.severity === "info").length,
      }
    }),
  }
  const measured =
    report.elapsedMs === undefined ? scopedInput : { ...scopedInput, elapsedMs: report.elapsedMs }
  return makeReport({
    ...measured,
    // The fact the consumer needs: this report looked at a change set, not the whole tree.
    scope: "touched-files",
  })
}

/**
 * Run every configured engine and compare the result to what was accepted.
 *
 * `touched`, when given, is a change set: engines still look at the whole tree -- cross-file
 * rules need the tree, and a scoped oxlint invocation cannot see an import from a file it did
 * not read -- and the report and the diff are narrowed to the change afterwards. That is the
 * same narrowing the gate's `touched-files` mode applies, so the report and the exit code
 * cannot disagree about what was in scope.
 */
export const harnessRun = (
  root: string,
  config: HarnessConfig,
  baseline: Baseline,
  touched?: ReadonlySet<string>,
): Effect.Effect<HarnessRun, never, Spawner> =>
  Effect.gen(function* () {
    const started = Date.now()
    const outcomes = yield* runEngines(root, config.engines)
    const diagnostics = outcomes.flatMap((outcome) => outcome.diagnostics)
    const whole = makeReport({
      diagnostics,
      files: new Set(diagnostics.map((diagnostic) => diagnostic.location.file)).size,
      generators: outcomes.map((outcome) => outcome.summary),
      elapsedMs: Date.now() - started,
      scope: "all",
    })
    const report = touched === undefined ? whole : scopeReport(whole, touched)
    const diff = diffBaseline(baseline, report.diagnostics)
    return touched === undefined
      ? { report, diff }
      : { report, diff, outOfScope: whole.diagnostics.length - report.diagnostics.length }
  })
