import { PROTOCOL_VERSION } from "./version.ts"

/*
 * The report shape: what every engine writes and every host reads.
 *
 * A linter, a typechecker, and a cross-file judged tool all reduce to the same
 * thing — a place in the source, a sentence, and a severity — and oxlint already
 * decided what those look like. Copying its shape is what lets `plumb` (an Oxlint
 * plugin), `joggle` (a judged binary), and `@shadcn/lint` land in one stream that a
 * reviewer, a `::error` annotation, and a baseline can all read without caring which
 * engine spoke.
 */

/** Three severities. `info` is for observations a run should not fail on. */
export type Severity = "error" | "warn" | "info"

/** A resolvable place in the source. `line` and `column` are 1-based. */
export interface SourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly endLine?: number
  readonly endColumn?: number
}

/**
 * One finding.
 *
 * `engine` and `ruleId` are separate on purpose: a host filters by engine ("show me
 * only the judged findings"), a baseline keys by `identity`, and a human reads the
 * rule id. `identity` is never derived from a line number — code moves constantly,
 * and a baseline that reports every edit as a new finding is a baseline nobody reads.
 */
export interface Diagnostic {
  readonly engine: string
  readonly ruleId: string
  readonly severity: Severity
  readonly message: string
  readonly help?: string
  readonly location: SourceLocation
  readonly identity?: string
  readonly judged?: boolean
  readonly fixable?: boolean
  readonly docsUrl?: string
  readonly engineVersion?: string
}

/** Severities, ordered. The report sorts by this first. */
export const severityRank: Readonly<Record<Severity, number>> = { error: 0, warn: 1, info: 2 }

/** How many of each severity a set of findings holds. */
export interface Counts {
  readonly error: number
  readonly warn: number
  readonly info: number
}

/** What one engine contributed to a run, so a report can say whose silence is whose. */
export interface EngineSummary {
  readonly id: string
  readonly version?: string
  readonly diagnostics: number
  readonly error: number
  readonly warn: number
  readonly info: number
  readonly durationMs?: number
  /** A sentence about an engine that could not run, or ran degraded. */
  readonly note?: string
}

/** One run, across every engine, in one shape. */
export interface Report {
  readonly protocolVersion: string
  readonly counts: Counts
  readonly files: number
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly generators: ReadonlyArray<EngineSummary>
  readonly elapsedMs?: number
}

/** Tally a set of findings by severity. */
export const countsOf = (diagnostics: ReadonlyArray<Diagnostic>): Counts => {
  let error = 0
  let warn = 0
  let info = 0
  for (const diagnostic of diagnostics) {
    if (diagnostic.severity === "error") error += 1
    else if (diagnostic.severity === "warn") warn += 1
    else info += 1
  }
  return { error, warn, info }
}

/**
 * The order a report is read in: worst first, then by place.
 *
 * Stable and total, so two runs over the same findings print byte-identical output.
 * `ruleId` is the tie-break of last resort because two findings can share a location.
 */
export const compareDiagnostics = (left: Diagnostic, right: Diagnostic): number =>
  severityRank[left.severity] - severityRank[right.severity] ||
  left.location.file.localeCompare(right.location.file) ||
  left.location.line - right.location.line ||
  left.location.column - right.location.column ||
  left.ruleId.localeCompare(right.ruleId)

/** A copy of the findings in report order. */
export const sortDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> => [...diagnostics].sort(compareDiagnostics)

/** Assemble a report: one shape, computed once, from the parts a runner collected. */
export const makeReport = (input: {
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly files: number
  readonly generators: ReadonlyArray<EngineSummary>
  readonly elapsedMs?: number
}): Report => ({
  protocolVersion: PROTOCOL_VERSION,
  counts: countsOf(input.diagnostics),
  files: input.files,
  diagnostics: sortDiagnostics(input.diagnostics),
  generators: input.generators,
  ...(input.elapsedMs === undefined ? {} : { elapsedMs: input.elapsedMs }),
})

/**
 * The process exit code a report earns.
 *
 * Any error fails. Warnings fail only when a ceiling is set, which is what lets a
 * repository adopt a rule as `warn` repo-wide and `error` on touched files without
 * two configurations: the ceiling is the second regime.
 */
export const exitCodeFor = (report: Report, maxWarnings = -1): number => {
  if (report.counts.error > 0) return 1
  if (maxWarnings >= 0 && report.counts.warn > maxWarnings) return 1
  return 0
}

/** Findings, one JSON object per line — the streaming form a runner writes. */
export const toJsonl = (diagnostics: ReadonlyArray<Diagnostic>): string =>
  diagnostics.map((diagnostic) => JSON.stringify(diagnostic)).join("\n")

/**
 * Read JSONL findings, skipping blank lines.
 *
 * Throws on a malformed line rather than skipping it: a silently dropped finding is
 * a gate that passes when it should fail, which is worse than a loud parse error.
 */
export const parseJsonl = (text: string): ReadonlyArray<Diagnostic> =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Diagnostic)
