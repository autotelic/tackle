import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect } from "effect"
import {
  countsOf,
  decodeRepair,
  isRecord,
  str as stringOf,
  type Diagnostic,
  type DropCount,
  type EngineRef,
  type EngineStatus,
  type EngineSummary,
  type Move,
  type Severity,
  type SourceLocation,
} from "@autotelic/protocol"
import { exec, type ExecOutcome, type Spawner } from "./exec.ts"
/*
 * The engine adapters.
 *
 * `jig` owns no analysis, so this file is entirely about ENCODINGS: how one engine's
 * output becomes the protocol's `Diagnostic`. oxlint's JSON and a report document are
 * the two the workspace needs; anything else is reported as unparsed rather than
 * guessed at.
 *
 * The load-bearing rule: an engine jig cannot understand produces a visible finding,
 * never silence. "No findings" and "not looked at" must not render the same — the same
 * reason `cutlist --check` exists.
 */

/** One engine's contribution: its diagnostics and the summary line for the census. */
export interface EngineOutcome {
  readonly id: string
  readonly summary: EngineSummary
  readonly diagnostics: ReadonlyArray<Diagnostic>
}

/** The two strings every parser needs travel as one, so a swap cannot compile. */
interface ParseContext {
  readonly engine: string
  readonly root: string
}

/** The args each known engine is invoked with. Overridable only by editing the id map. */
const DEFAULT_ARGS: Readonly<Record<string, ReadonlyArray<string>>> = {
  joggle: ["check", "--format", "json"],
}

/** The engine's default args, then whatever the project configured on top. */
export const argsFor = (engine: EngineRef): ReadonlyArray<string> => [
  ...(engine.id === "cutlist"
    ? ["build", "--check"]
    : engine.kind === "oxlint-plugin"
      ? ["--format", "json"]
      : (DEFAULT_ARGS[engine.id] ?? [])),
  // `config` names the engine's own config file, relative to the root. Only the oxlint kind
  // has a flag `jig` can write for it; cutlist and joggle discover theirs by convention, so
  // for them the field is a pointer for a reader and never an argument.
  ...(engine.kind === "oxlint-plugin" && engine.config !== undefined
    ? ["--config", engine.config]
    : []),
  ...(engine.args ?? []),
]

/**
 * The command `jig` spawns for an engine.
 *
 * `PATH` is ambient: it belongs to whoever invoked `jig`, so a global install can silently
 * shadow the version this project pinned. When the project has its own `node_modules/.bin`
 * copy, that one wins; otherwise the bare command is left for `PATH` to resolve.
 */
export const resolveEngineCommand = ({
  root,
  command,
}: {
  readonly root: string
  readonly command: string
}): string => {
  const local = join(root, "node_modules", ".bin", command)
  return existsSync(local) ? local : command
}

const recordAt = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

/** oxlint speaks `error | warning | advice`; the protocol speaks `error | warn | info`. */
const severityOf = (value: unknown): Severity => {
  if (value === "error") return "error"
  if (value === "info" || value === "notice" || value === "advice") return "info"
  return "warn"
}

/**
 * oxlint names a rule `plugin(rule)` in `code` — `eslint(no-unused-vars)`,
 * `plumb-ui(no-raw-html-layout)`. The report keeps `engine` and `ruleId` apart, so a code
 * whose plugin is the engine itself must not repeat it: on engine `plumb`,
 * `plumb(no-raw-html-layout)` is ruleId `no-raw-html-layout`, while
 * `plumb-ui(no-raw-html-layout)` keeps the sub-plugin as a namespace. Without this,
 * `${engine}/${ruleId}` reads `plumb/plumb(no-raw-html-layout)`.
 *
 * A bare code that already carries the engine's own prefix is the same mistake in a
 * different spelling, because a tool that reports whole findings names its rules the way
 * its reports do: `joggle` emits `joggle/import-cycle`, and the report would read
 * `joggle/joggle/import-cycle` — a name no document uses and `explain` cannot find.
 */
const RULE_CODE = /^([A-Za-z][\w-]*)\((.+)\)$/u

const ruleIdOf = ({ code, engine }: { readonly code: string; readonly engine: string }): string => {
  const match = RULE_CODE.exec(code)
  if (match === null) {
    const prefix = `${engine}/`
    return code.startsWith(prefix) ? code.slice(prefix.length) : code
  }
  const plugin = match[1] ?? ""
  const rule = match[2] ?? code
  return plugin === engine ? rule : `${plugin}/${rule}`
}

/* The severity vocabularies each inbound encoding speaks, mapped to the protocol's three. */

/** GitHub workflow commands: error | warning | notice. */
const githubSeverity = (value: string | undefined): Severity => {
  if (value === "error") return "error"
  if (value === "notice") return "info"
  return "warn"
}

/** SARIF: error | warning | note | none. */
const sarifSeverity = (value: unknown): Severity => {
  if (value === "error") return "error"
  if (value === "note" || value === "none") return "info"
  return "warn"
}

/**
 * Code Climate / GitLab: info | minor | major | critical | blocker. This is the inverse of
 * the outward projection, so `error → major → error` and `warn → minor → warn` round-trip.
 * (`oxlint` chooses `major` for its own warnings; that loss is oxlint's, not the mapping's.)
 */
const codeClimateSeverity = (value: unknown): Severity => {
  if (value === "info") return "info"
  if (value === "minor") return "warn"
  return "error"
}

/** A path as the report wants it: repository-relative when it sits under the root. */
const relativeTo = ({ file, root }: { readonly file: string; readonly root: string }): string =>
  file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file

/** oxlint puts the position in the first label's span; a report document puts it inline. */
const locationOf = (entry: Record<string, unknown>, root: string): SourceLocation => {
  const location = recordAt(entry.location)
  if (location !== undefined) {
    return {
      file: relativeTo({
        file: stringOf(location.file) ?? stringOf(entry.filename) ?? "<unknown>",
        root,
      }),
      line: numberOr(location.line, 1),
      column: numberOr(location.column, 1),
    }
  }
  const labels = entry.labels
  const span = recordAt(recordAt(Array.isArray(labels) ? labels[0] : undefined)?.span)
  return {
    file: relativeTo({
      file: stringOf(entry.filename) ?? stringOf(entry.file) ?? "<unknown>",
      root,
    }),
    line: numberOr(span?.line, 1),
    column: numberOr(span?.column, 1),
  }
}

const MOVES: ReadonlyArray<Move> = ["contract", "combine", "expand"]

/** A move outside the closed set is no move: the reader will not invent one. */
const moveOf = (value: unknown): Move | undefined =>
  typeof value === "string" && (MOVES as ReadonlyArray<string>).includes(value)
    ? (value as Move)
    : undefined

/** Map one engine finding to a protocol diagnostic, or drop it when it is not one. */
export const normalize = (raw: unknown, context: ParseContext): Diagnostic | undefined => {
  const { engine, root } = context
  const entry = recordAt(raw)
  const message = stringOf(entry?.message) ?? stringOf(entry?.text)
  if (entry === undefined || message === undefined) return undefined
  const help = stringOf(entry.help)
  const identity = stringOf(entry.identity)
  const docsUrl = stringOf(entry.url) ?? stringOf(entry.docsUrl)
  const move = moveOf(entry.move)
  const score = numberOr(entry.score, Number.NaN)
  const confidence = numberOr(entry.confidence, Number.NaN)
  // A repair that does not decode degrades to the finding's sentence, never to a dropped
  // finding: the message is the part a reader can act on, and losing it to a bad cascade
  // would turn a real finding into silence.
  const repair = entry.repair === undefined ? undefined : decodeRepair(entry.repair)
  return {
    engine,
    ruleId: ruleIdOf({
      code: stringOf(entry.ruleId) ?? stringOf(entry.code) ?? stringOf(entry.rule) ?? "unknown",
      engine,
    }),
    severity: severityOf(entry.severity),
    message,
    location: locationOf(entry, root),
    ...(help === undefined ? {} : { help }),
    ...(identity === undefined ? {} : { identity }),
    ...(docsUrl === undefined ? {} : { docsUrl }),
    ...(typeof entry.judged === "boolean" ? { judged: entry.judged } : {}),
    ...(typeof entry.fixable === "boolean" ? { fixable: entry.fixable } : {}),
    ...(move === undefined ? {} : { move }),
    ...(Number.isFinite(score) ? { score } : {}),
    ...(Number.isFinite(confidence) ? { confidence } : {}),
    ...(repair === undefined ? {} : { repair }),
  }
}

const defined = (value: Diagnostic | undefined): value is Diagnostic => value !== undefined

const arrayOfRecords = (value: unknown): ReadonlyArray<Record<string, unknown>> | undefined => {
  if (!Array.isArray(value)) return undefined
  const out: Array<Record<string, unknown>> = []
  for (const element of value) {
    const entry = recordAt(element)
    if (entry === undefined) return undefined
    out.push(entry)
  }
  return out
}

/* SARIF 2.1.0: what `oxlint --format sarif`, and most static-analysis tools, emit. */

const sarifLocation = (
  result: Record<string, unknown>,
  root: string,
): SourceLocation | undefined => {
  const locations = result.locations
  const physical = recordAt(
    recordAt(Array.isArray(locations) ? locations[0] : undefined)?.physicalLocation,
  )
  const uri = stringOf(recordAt(physical?.artifactLocation)?.uri)
  if (uri === undefined) return undefined
  const region = recordAt(physical?.region)
  const line = numberOr(region?.startLine, 1)
  const column = numberOr(region?.startColumn, 1)
  const endLine = typeof region?.endLine === "number" ? region.endLine : undefined
  const endColumn = typeof region?.endColumn === "number" ? region.endColumn : undefined
  return {
    file: relativeTo({ file: uri.replace(/^file:\/\//u, ""), root }),
    line,
    column,
    ...(endLine === undefined ? {} : { endLine }),
    ...(endColumn === undefined ? {} : { endColumn }),
  }
}

const parseSarif = (
  doc: Record<string, unknown>,
  context: ParseContext,
): ReadonlyArray<Diagnostic> | undefined => {
  const { engine, root } = context
  const runs = arrayOfRecords(doc.runs)
  if (runs === undefined) return undefined
  const out: Array<Diagnostic> = []
  for (const run of runs) {
    const results = arrayOfRecords(run.results)
    if (results === undefined) return undefined
    for (const result of results) {
      const message = stringOf(recordAt(result.message)?.text)
      const ruleId = stringOf(result.ruleId)
      const location = sarifLocation(result, root)
      if (message === undefined || ruleId === undefined || location === undefined) return undefined
      out.push({
        engine,
        ruleId: ruleIdOf({ code: ruleId, engine }),
        severity: sarifSeverity(result.level),
        message,
        location,
      })
    }
  }
  return out
}

/* Code Climate / GitLab Code Quality: the JSON array `oxlint --format gitlab` emits. */

const parseCodeClimate = (
  doc: unknown,
  context: ParseContext,
): ReadonlyArray<Diagnostic> | undefined => {
  const { engine, root } = context
  const issues = arrayOfRecords(doc)
  if (issues === undefined) return undefined
  const out: Array<Diagnostic> = []
  for (const issue of issues) {
    const location = recordAt(issue.location)
    const lines = recordAt(location?.lines)
    const description = stringOf(issue.description)
    const check = stringOf(issue.check_name)
    const path = stringOf(location?.path)
    if (description === undefined || check === undefined || path === undefined) return undefined
    const begin = numberOr(lines?.begin, 1)
    const end = typeof lines?.end === "number" ? lines.end : undefined
    const identity = stringOf(issue.fingerprint)
    out.push({
      engine,
      ruleId: ruleIdOf({ code: check, engine }),
      severity: codeClimateSeverity(issue.severity),
      message: description,
      ...(identity === undefined ? {} : { identity }),
      location: {
        file: relativeTo({ file: path, root }),
        line: begin,
        column: 1,
        ...(end === undefined ? {} : { endLine: end }),
      },
    })
  }
  return out
}

/* GitHub Actions workflow commands: what `oxlint --format github` emits. */

const GITHUB_ANNOTATION = /^::(?<level>error|warning|notice)\s+(?<props>.+?)::(?<message>.*)$/u

/** oxlint repeats the position at the head of the message; the location field already has it. */
const stripGithubPrefix = ({
  message,
  file,
  line,
  column,
}: {
  readonly message: string
  readonly file: string
  readonly line: number
  readonly column: number
}): string => {
  const prefix = `${file}:${line}:${column}: `
  return message.startsWith(prefix) ? message.slice(prefix.length) : message
}

const parseGithub = (
  text: string,
  context: ParseContext,
): ReadonlyArray<Diagnostic> | undefined => {
  const { engine, root } = context
  const lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("::"))
  if (lines.length === 0) return undefined
  const out: Array<Diagnostic> = []
  for (const line of lines) {
    const match = GITHUB_ANNOTATION.exec(line)
    if (match === null) return undefined
    const properties = new Map<string, string>()
    for (const pair of (match.groups?.props ?? "").split(",")) {
      const equals = pair.indexOf("=")
      if (equals > 0) properties.set(pair.slice(0, equals).trim(), pair.slice(equals + 1).trim())
    }
    const file = properties.get("file")
    if (file === undefined) return undefined
    const lineNumber = numberOr(Number(properties.get("line")), 1)
    const column = numberOr(Number(properties.get("col")), 1)
    const endLine = properties.has("endLine")
      ? numberOr(Number(properties.get("endLine")), lineNumber)
      : undefined
    const endColumn = properties.has("endColumn")
      ? numberOr(Number(properties.get("endColumn")), column)
      : undefined
    out.push({
      engine,
      ruleId: ruleIdOf({ code: properties.get("title") ?? "unknown", engine }),
      severity: githubSeverity(match.groups?.level),
      message: stripGithubPrefix({
        message: match.groups?.message ?? "",
        file,
        line: lineNumber,
        column,
      }),
      location: {
        file: relativeTo({ file, root }),
        line: lineNumber,
        column,
        ...(endLine === undefined ? {} : { endLine }),
        ...(endColumn === undefined ? {} : { endColumn }),
      },
    })
  }
  return out
}

/**
 * Read an engine's stdout as diagnostics.
 *
 * jig asks oxlint for `--format json`, but it may be handed an engine it did not
 * configure, so it accepts the structured encodings that carry the same information:
 *
 *   - a whole-document JSON report (`{ diagnostics: [...] }`, oxlint and
 *     `joggle check --format json`);
 *   - SARIF 2.1.0 (`runs[].results`), the OASIS interchange;
 *   - a Code Climate / GitLab array, which is also what we project out;
 *   - GitHub Actions annotations (`::warning file=…::…`);
 *   - JSONL, one finding per line, what a runner streams.
 *
 * XML (checkstyle, junit) and human text are NOT read: inventing a parser for them would
 * be guessing. `undefined` means "jig could not read this", so the caller says so out loud
 * rather than reporting a clean run.
 */
export const parseEngineOutput = (
  stdout: string,
  context: ParseContext,
): ReadonlyArray<Diagnostic> | undefined => {
  const trimmed = stdout.trim()
  if (trimmed === "") return []

  if (trimmed.startsWith("::")) return parseGithub(trimmed, context)

  if (trimmed.startsWith("[")) {
    try {
      const codeClimate = parseCodeClimate(JSON.parse(trimmed), context)
      if (codeClimate !== undefined) return codeClimate
    } catch {
      // Not a JSON array; a JSONL stream also contains `[` only inside lines, so fall through.
    }
  }

  if (trimmed.startsWith("{")) {
    try {
      const entry = recordAt(JSON.parse(trimmed))
      if (Array.isArray(entry?.diagnostics)) {
        return entry.diagnostics.map((raw) => normalize(raw, context)).filter(defined)
      }
      if (entry !== undefined && Array.isArray(entry.runs)) {
        const sarif = parseSarif(entry, context)
        if (sarif !== undefined) return sarif
      }
    } catch {
      // Not a whole document; a JSONL stream also starts with `{`, so fall through.
    }
  }

  const lines = trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length > 0 && lines.every((line) => line.startsWith("{"))) {
    const parsed: Array<Diagnostic | undefined> = []
    for (const line of lines) {
      try {
        parsed.push(normalize(JSON.parse(line), context))
      } catch {
        return undefined
      }
    }
    return parsed.filter(defined)
  }

  return undefined
}

/** `cutlist build --check` speaks exit codes, not diagnostics: a non-zero exit is one. */
const cutlistDiagnostics = ({ code, stdout, stderr }: ExecOutcome): ReadonlyArray<Diagnostic> => {
  if (code === 0) return []
  const detail = (stdout.trim() === "" ? stderr : stdout).trim().split("\n")[0] ?? ""
  return [
    {
      engine: "cutlist",
      ruleId: "stale-catalog",
      severity: "error",
      message: detail === "" ? "the committed catalog is stale" : detail,
      help: "Run `cutlist build` and commit the result.",
      location: { file: "cutlist.config.json", line: 1, column: 1 },
    },
  ]
}

/** An engine whose output jig cannot read, said out loud rather than passed over. */
const unparsed = ({
  id,
  code,
  stdout,
  stderr,
}: { readonly id: string } & ExecOutcome): ReadonlyArray<Diagnostic> => {
  const output = (stderr.trim() === "" ? stdout : stderr).trim()
  // A silent, successful exit is a real "no findings". A silent FAILURE is not: the engine
  // said something (on stderr) or said nothing and died, and either way nothing was looked at.
  if (output === "" && code === 0) return []
  return [
    {
      engine: id,
      ruleId: "unparsed-output",
      severity: "info",
      message:
        output === ""
          ? `${id} exited ${code} without output`
          : `jig could not parse ${id} output (exit ${code})`,
      ...(output === "" ? {} : { help: output.slice(0, 400) }),
      location: { file: `${id}.config`, line: 1, column: 1 },
    },
  ]
}

/**
 * What one engine's run amounts to.
 *
 * The load-bearing case is the one that used to slip through: a process that exits non-zero
 * having printed nothing jig can read is NOT "no findings". `parseEngineOutput("")` answers
 * `[]`, and `[]` is indistinguishable from a clean run, so an engine that died before
 * printing — or printed only to stderr — was reported as looked-at-and-clean. The exit code
 * is the only thing that tells the two apart, so it is consulted here and not only inside
 * `unparsed`. Findings an engine did print still win: a linter exits non-zero *because* it
 * found something.
 */
export const engineDiagnostics = (
  id: string,
  output: ExecOutcome,
  root: string,
): ReadonlyArray<Diagnostic> => {
  const { code, stdout, stderr } = output
  if (id === "cutlist") return cutlistDiagnostics(output)
  const parsed = parseEngineOutput(stdout, { engine: id, root })
  if (parsed !== undefined && (parsed.length > 0 || code === 0)) return parsed
  return unparsed({ id, code, stdout, stderr })
}

/**
 * The stages that mean no judgement happened, as opposed to a judgement that said no.
 *
 * `declined` is the model looking and finding nothing; `gated` is a judgement below the
 * threshold. Both are answers. `unreadable`/`no_evidence`/`budget` are candidates nobody
 * judged, and folding them into "0 findings" is the lie the invariant forbids.
 */
const UNJUDGED_STAGES: ReadonlySet<string> = new Set(["unreadable", "no_evidence", "budget"])

/** What an engine's own report says it did, beyond the findings it printed. */
export interface Provenance {
  readonly status: EngineStatus
  readonly unjudged?: number
  readonly drops?: ReadonlyArray<DropCount>
  readonly note?: string
}

/**
 * Read an engine's own summary, when its encoding has one.
 *
 * joggle's document carries `summary.drops` — every candidate it considered and did not
 * report, by stage — plus a `replayed` flag and the rules it skipped. This is the material
 * that must reach the report: without it, a replayed engine that judged nothing prints
 * exactly like a fresh engine that found nothing.
 */
export const engineProvenance = (stdout: string): Provenance => {
  const trimmed = stdout.trim()
  if (!trimmed.startsWith("{")) return { status: "ran" }
  let doc: Record<string, unknown> | undefined
  try {
    doc = recordAt(JSON.parse(trimmed))
  } catch {
    return { status: "ran" }
  }
  const summary = recordAt(doc?.summary)
  if (summary === undefined) return { status: "ran" }

  const byStage = new Map<string, number>()
  if (Array.isArray(summary.drops)) {
    for (const raw of summary.drops) {
      const stage = stringOf(recordAt(raw)?.stage)
      if (stage === undefined) continue
      byStage.set(stage, (byStage.get(stage) ?? 0) + 1)
    }
  }
  const drops = [...byStage.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([stage, count]) => ({ stage, count }))
  const unjudged = drops
    .filter((drop) => UNJUDGED_STAGES.has(drop.stage))
    .reduce((total, drop) => total + drop.count, 0)
  const skipped = Array.isArray(summary.skipped) ? summary.skipped.length : 0
  const note = skipped === 0 ? undefined : `${skipped} rule${skipped === 1 ? "" : "s"} skipped`

  return {
    status: summary.replayed === true ? "replayed" : "ran",
    ...(unjudged === 0 ? {} : { unjudged }),
    ...(drops.length === 0 ? {} : { drops }),
    ...(note === undefined ? {} : { note }),
  }
}

const summarize = (
  id: string,
  diagnostics: ReadonlyArray<Diagnostic>,
  durationMs: number,
  extra: { readonly note?: string; readonly provenance?: Provenance } = {},
): EngineSummary => {
  const counts = countsOf(diagnostics)
  const provenance = extra.provenance
  // An engine whose output jig could not read is `errored`, not `ran`: it exited, but
  // nothing was looked at, and the status has to agree with the unparsed-output finding.
  const status =
    provenance?.status ??
    (diagnostics.some((diagnostic) => diagnostic.ruleId === `${id}/unparsed-output`)
      ? "errored"
      : "ran")
  const note = extra.note ?? provenance?.note
  return {
    id,
    diagnostics: diagnostics.length,
    error: counts.error,
    warn: counts.warn,
    info: counts.info,
    durationMs,
    status,
    ...(note === undefined ? {} : { note }),
    ...(provenance?.unjudged === undefined ? {} : { unjudged: provenance.unjudged }),
    ...(provenance?.drops === undefined ? {} : { drops: provenance.drops }),
  }
}

/** Run one engine and reduce its output to diagnostics. It never fails the run. */
export const runEngine = (
  root: string,
  engine: EngineRef,
): Effect.Effect<EngineOutcome, never, Spawner> =>
  Effect.gen(function* () {
    const started = Date.now()
    const id = engine.id

    if (engine.kind === "internal") {
      return {
        id,
        summary: summarize(id, [], Date.now() - started, {
          note: "internal engines are host-owned, not process-run",
          provenance: { status: "skipped" },
        }),
        diagnostics: [],
      }
    }

    const binary = engine.command ?? id
    const command = resolveEngineCommand({ root, command: binary })
    const outcome = yield* Effect.match(exec(command, argsFor(engine), root), {
      onFailure: (message: string) => ({ ok: false as const, message }),
      onSuccess: (value) => ({ ok: true as const, value }),
    })
    if (!outcome.ok) {
      return {
        id,
        summary: summarize(id, [], Date.now() - started, {
          note: `${binary} could not run: ${outcome.message}`,
          provenance: { status: "errored" },
        }),
        diagnostics: [],
      }
    }

    const { stdout, stderr, code } = outcome.value
    const diagnostics = engineDiagnostics(id, { code, stdout, stderr }, root)
    return {
      id,
      summary: summarize(id, diagnostics, Date.now() - started, {
        provenance: engineProvenance(stdout),
      }),
      diagnostics,
    }
  })

/** Every enabled engine, run concurrently. */
export const runEngines = (
  root: string,
  engines: ReadonlyArray<EngineRef>,
): Effect.Effect<ReadonlyArray<EngineOutcome>, never, Spawner> =>
  Effect.all(
    engines.filter((engine) => engine.enabled !== false).map((engine) => runEngine(root, engine)),
    { concurrency: "unbounded" },
  )
