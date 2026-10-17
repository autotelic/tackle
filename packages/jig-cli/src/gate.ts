import { identityOf, type Diagnostic } from "@autotelic/protocol"
import type { HarnessRun } from "./run.ts"

/*
 * The gate: what a run earns, and the exit code that carries it.
 *
 * `check` runs the engines and merges them into one report; this file decides what that
 * report MEANS. The three knobs a repo sets — `gate.mode`, `gate.failOn`, and
 * `report.maxWarnings` — are read here and nowhere else, so a knob that does not change
 * this file is a knob that lies.
 *
 * The exit codes are a contract a CI reads:
 *   0  clean          — the gate passed
 *   1  findings       — the gate failed on findings
 *   2  usage/config   — the command line did not parse (raised in `cli.ts`, not here)
 *   3  infrastructure — an engine could not run; the report is incomplete, not clean
 *
 * Infrastructure outranks findings: when an engine could not run, "0 finding(s)" is not a
 * verdict, and a CI that read 1 would treat an unread run as a merely dirty one.
 */

/** The process codes `jig check` returns. */
export const EXIT = { clean: 0, findings: 1, usage: 2, infrastructure: 3 } as const

/** The subset of `jig.config.json` that decides the gate. */
export interface GateOptions {
  /** The scope the gate actually read: `touched-files` degrades to `all` when git cannot say. */
  readonly mode: "touched-files" | "all"
  readonly failOn: "error" | "warn" | "any-new"
  readonly maxWarnings: number
  /** Repo-relative paths the change touched. Read only when `mode` is `touched-files`. */
  readonly touched: ReadonlySet<string>
}

/** What a run earned: the code, the findings that earned it, and whose silence earned it. */
export interface GateVerdict {
  readonly exitCode: number
  /** The scope the gate read, after any degradation from `touched-files`. */
  readonly scope: "touched-files" | "all"
  readonly failOn: GateOptions["failOn"]
  /** The in-scope findings the gate holds against the run, in report order. */
  readonly failing: ReadonlyArray<Diagnostic>
  /** Engines that could not run, by id. Non-empty means the report is incomplete. */
  readonly infrastructure: ReadonlyArray<string>
}

/** Findings in the gate's scope: everything, or only what the change touched. */
const inScope = (run: HarnessRun, options: GateOptions): ReadonlyArray<Diagnostic> =>
  options.mode === "all"
    ? run.report.diagnostics
    : run.report.diagnostics.filter((diagnostic) => options.touched.has(diagnostic.location.file))

/** The findings `failOn` holds against a scope. */
const heldByFailOn = (
  run: HarnessRun,
  scope: ReadonlyArray<Diagnostic>,
  failOn: GateOptions["failOn"],
): ReadonlyArray<Diagnostic> => {
  switch (failOn) {
    case "error":
      return scope.filter((diagnostic) => diagnostic.severity === "error")
    case "warn":
      return scope.filter((diagnostic) => diagnostic.severity !== "info")
    case "any-new": {
      const novel = new Set(run.diff.novel.map(identityOf))
      return scope.filter((diagnostic) => novel.has(identityOf(diagnostic)))
    }
  }
}

/**
 * Decide a run's fate.
 *
 * Pure: the same run and options always give the same verdict, so the exit code and the
 * report a person reads can never disagree.
 */
export const gateVerdict = (run: HarnessRun, options: GateOptions): GateVerdict => {
  const infrastructure = run.report.generators
    .filter((generator) => generator.status === "errored")
    .map((generator) => generator.id)
  const scope = inScope(run, options)
  const held = heldByFailOn(run, scope, options.failOn)
  // The ceiling is a second, severity-blind regime: enough warnings fail whatever `failOn`
  // says. When it trips, the warnings are what the gate holds, so they are what it shows.
  const warnings = scope.filter((diagnostic) => diagnostic.severity === "warn")
  const overCeiling = options.maxWarnings >= 0 && warnings.length > options.maxWarnings
  const heldSet = new Set(held)
  const failing = overCeiling
    ? scope.filter((diagnostic) => diagnostic.severity === "warn" || heldSet.has(diagnostic))
    : held
  const exitCode =
    infrastructure.length > 0
      ? EXIT.infrastructure
      : failing.length > 0
        ? EXIT.findings
        : EXIT.clean
  return { exitCode, scope: options.mode, failOn: options.failOn, failing, infrastructure }
}
