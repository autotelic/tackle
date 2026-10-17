import { arrayOf, bool, int, isRecord, num, oneOf, readLexiconRef, str } from "./decode.ts"
import { lexiconRef, type LexiconRef } from "./lexicon.ts"

/*
 * The report shape: what every engine writes and every host reads.
 *
 * A linter, a typechecker, and a cross-file judged tool all reduce to the same
 * thing — a place in the source, a sentence, and a severity — and oxlint already
 * decided what those look like. Copying its shape is what lets `plumb` (an Oxlint
 * plugin), `joggle` (a judged binary), and `@shadcn/lint` land in one stream that a
 * reviewer, a `::error` annotation, and a baseline can all read without caring which
 * engine spoke.
 *
 * The report is a DERIVED snapshot, not a source of truth: it carries tally fields
 * (`counts`, `generators[].diagnostics`) because a reader wants a summary of one run, but
 * nothing downstream may read truth out of them — the identities are the state, the
 * numbers are a rendering. Store the stable thing; recompute the aggregate.
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
 * The entropy reversal a judged finding proposes.
 *
 * Not every engine judges, so `move` is optional: absent means the finding is not about
 * entropy at all — it checks the code against a requirement rather than asking what the
 * code could be rebuilt from.
 */
export type Move = "contract" | "combine" | "expand"

/** The five operations a repair can propose. A decline is not one of them. */
export type RepairOperation = "merge" | "split" | "move" | "replace" | "migrate"

/** One place a repair says must change, and what to do there. */
export interface RepairEdit {
  readonly file: string
  readonly line: number
  readonly column: number
  readonly instruction: string
}

/**
 * The smaller form a judged finding proposes, when the rule can propose one.
 *
 * `complete` is the field an agent needs: when it is true every affected site is listed, so
 * the repair is a work order and not a complaint. A host that ignores this still gets a
 * linter.
 */
export interface Repair {
  readonly operation: RepairOperation
  readonly keep?: SourceLocation
  readonly remove: ReadonlyArray<SourceLocation>
  readonly cascade: ReadonlyArray<RepairEdit>
  readonly complete: boolean
  readonly settled: string
}

/**
 * What an engine did, which is not the same as what it found.
 *
 * `replayed` is the load-bearing one: an engine that served a cache did not look, and a
 * report that renders it as "0 findings" turns "not looked at" into "clean".
 */
export type EngineStatus = "ran" | "replayed" | "skipped" | "errored"

/** Candidates an engine considered and did not report, under the engine's own stage name. */
export interface DropCount {
  readonly stage: string
  readonly count: number
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
  /** Which entropy reversal the finding proposes, when it proposes one. */
  readonly move?: Move
  /** How strongly a judgement says the finding is real; comparable across a run. */
  readonly score?: number
  /** How peaked the judgement's distribution was. Not comparable across findings. */
  readonly confidence?: number
  /** The smaller form the finding proposes, when the rule can propose one. */
  readonly repair?: Repair
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
  /** What the engine did: ran, replayed a cache, skipped, or errored. */
  readonly status?: EngineStatus
  /**
   * Candidates the engine considered and did NOT judge, as a count.
   *
   * This is the number that must never fold into "0 findings": an engine that reported
   * nothing because nothing was judged has not answered the question it was run to answer.
   */
  readonly unjudged?: number
  /** The same candidates, by the engine's own stage, so a reader can see where they went. */
  readonly drops?: ReadonlyArray<DropCount>
}

/** One run, across every engine, in one shape. */
export interface Report {
  readonly lexicon: LexiconRef
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
  lexicon: lexiconRef("report"),
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

/*
 * Decoders — untrusted input in, typed value or `undefined` out.
 *
 * These are the readers an app uses on a record it did not write: an engine's stdout, a
 * report a host fetched, a file another language wrote. Unknown fields are ignored (a
 * newer writer must not be rejected); a KNOWN field of the wrong type fails the record,
 * because a diagnostic with a non-numeric line is a record this reader cannot trust.
 * Nothing throws.
 */

const SEVERITIES: ReadonlyArray<Severity> = ["error", "warn", "info"]

const MOVES: ReadonlyArray<Move> = ["contract", "combine", "expand"]

const REPAIR_OPERATIONS: ReadonlyArray<RepairOperation> = [
  "merge",
  "split",
  "move",
  "replace",
  "migrate",
]

const ENGINE_STATUSES: ReadonlyArray<EngineStatus> = ["ran", "replayed", "skipped", "errored"]

/** Read one place a repair must change, or `undefined` when it is not one. */
const decodeRepairEdit = (value: unknown): RepairEdit | undefined => {
  if (!isRecord(value)) return undefined
  const file = str(value.file)
  const line = int(value.line)
  const column = int(value.column)
  const instruction = str(value.instruction)
  if (
    file === undefined ||
    line === undefined ||
    column === undefined ||
    instruction === undefined
  ) {
    return undefined
  }
  return { file, line, column, instruction }
}

/** Read a repair, or `undefined` when it is not one. */
export const decodeRepair = (value: unknown): Repair | undefined => {
  if (!isRecord(value)) return undefined
  const operation = oneOf(value.operation, REPAIR_OPERATIONS)
  const remove = arrayOf(value.remove, decodeLocation)
  const cascade = arrayOf(value.cascade, decodeRepairEdit)
  const complete = bool(value.complete)
  const settled = str(value.settled)
  if (
    operation === undefined ||
    remove === undefined ||
    cascade === undefined ||
    complete === undefined ||
    settled === undefined
  ) {
    return undefined
  }
  const keep = value.keep === undefined ? undefined : decodeLocation(value.keep)
  if (value.keep !== undefined && keep === undefined) return undefined
  return {
    operation,
    ...(keep === undefined ? {} : { keep }),
    remove,
    cascade,
    complete,
    settled,
  }
}

/** Read one drop count, or `undefined` when it is not one. */
export const decodeDropCount = (value: unknown): DropCount | undefined => {
  if (!isRecord(value)) return undefined
  const stage = str(value.stage)
  const count = int(value.count)
  if (stage === undefined || count === undefined) return undefined
  return { stage, count }
}

/** Read a source location, or `undefined` when it is not one. */
export const decodeLocation = (value: unknown): SourceLocation | undefined => {
  if (!isRecord(value)) return undefined
  const file = str(value.file)
  const line = int(value.line)
  const column = int(value.column)
  if (file === undefined || line === undefined || column === undefined) return undefined
  const endLine = int(value.endLine)
  const endColumn = int(value.endColumn)
  return {
    file,
    line,
    column,
    ...(endLine === undefined ? {} : { endLine }),
    ...(endColumn === undefined ? {} : { endColumn }),
  }
}

/** Read one diagnostic, or `undefined` when it is malformed. */
export const decodeDiagnostic = (value: unknown): Diagnostic | undefined => {
  if (!isRecord(value)) return undefined
  const engine = str(value.engine)
  const ruleId = str(value.ruleId)
  const severity = oneOf(value.severity, SEVERITIES)
  const message = str(value.message)
  const location = decodeLocation(value.location)
  if (
    engine === undefined ||
    ruleId === undefined ||
    severity === undefined ||
    message === undefined ||
    location === undefined
  ) {
    return undefined
  }
  const help = str(value.help)
  const identity = str(value.identity)
  const judged = bool(value.judged)
  const fixable = bool(value.fixable)
  const docsUrl = str(value.docsUrl)
  const engineVersion = str(value.engineVersion)
  const move = oneOf(value.move, MOVES)
  const score = num(value.score)
  const confidence = num(value.confidence)
  // A `repair` that is present but unreadable fails the record: a half-read repair would
  // list fewer sites than the finding has, which is the repair lying about being complete.
  const repair = value.repair === undefined ? undefined : decodeRepair(value.repair)
  if (value.move !== undefined && move === undefined) return undefined
  if (value.repair !== undefined && repair === undefined) return undefined
  return {
    engine,
    ruleId,
    severity,
    message,
    location,
    ...(help === undefined ? {} : { help }),
    ...(identity === undefined ? {} : { identity }),
    ...(judged === undefined ? {} : { judged }),
    ...(fixable === undefined ? {} : { fixable }),
    ...(docsUrl === undefined ? {} : { docsUrl }),
    ...(engineVersion === undefined ? {} : { engineVersion }),
    ...(move === undefined ? {} : { move }),
    ...(score === undefined ? {} : { score }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(repair === undefined ? {} : { repair }),
  }
}

/** Read one engine summary, or `undefined` when it is malformed. */
export const decodeEngineSummary = (value: unknown): EngineSummary | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const diagnostics = int(value.diagnostics)
  const error = int(value.error)
  const warn = int(value.warn)
  const info = int(value.info)
  if (
    id === undefined ||
    diagnostics === undefined ||
    error === undefined ||
    warn === undefined ||
    info === undefined
  ) {
    return undefined
  }
  const version = str(value.version)
  const durationMs = num(value.durationMs)
  const note = str(value.note)
  const status = oneOf(value.status, ENGINE_STATUSES)
  const unjudged = int(value.unjudged)
  const drops = value.drops === undefined ? undefined : arrayOf(value.drops, decodeDropCount)
  if (value.status !== undefined && status === undefined) return undefined
  if (value.drops !== undefined && drops === undefined) return undefined
  return {
    id,
    diagnostics,
    error,
    warn,
    info,
    ...(version === undefined ? {} : { version }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(note === undefined ? {} : { note }),
    ...(status === undefined ? {} : { status }),
    ...(unjudged === undefined ? {} : { unjudged }),
    ...(drops === undefined ? {} : { drops }),
  }
}

/**
 * Read a report, or `undefined` when the whole document is malformed.
 *
 * A report with one bad diagnostic is `undefined`, not a report missing a finding:
 * dropping the bad entry would let a gate pass on a run it could not read.
 *
 * The `counts` and `files` a writer stored are DERIVED and are deliberately not read: this
 * reader recomputes them from `diagnostics`, so nothing downstream can read truth out of a
 * tally. A wrong `counts` in the bytes is not a corrupt report — it is a number this reader
 * ignores.
 */
export const decodeReport = (value: unknown): Report | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "report")
  if (lexicon === undefined) return undefined
  const diagnostics = arrayOf(value.diagnostics, decodeDiagnostic)
  const generators = arrayOf(value.generators, decodeEngineSummary)
  if (diagnostics === undefined || generators === undefined) return undefined
  // Re-sorted into the documented total order, so a reader sees one canonical ordering.
  const ordered = sortDiagnostics(diagnostics)
  const elapsedMs = num(value.elapsedMs)
  return {
    lexicon,
    counts: countsOf(ordered),
    files: new Set(ordered.map((diagnostic) => diagnostic.location.file)).size,
    diagnostics: ordered,
    generators,
    ...(elapsedMs === undefined ? {} : { elapsedMs }),
  }
}
