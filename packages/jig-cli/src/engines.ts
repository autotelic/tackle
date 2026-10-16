import { Effect } from "effect"
import {
  countsOf,
  type Diagnostic,
  type EngineRef,
  type EngineSummary,
  type Severity,
  type SourceLocation,
} from "@autotelic/protocol"
import { exec, type Spawner } from "./exec.ts"
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

/** The args each known engine is invoked with. Overridable only by editing the id map. */
const DEFAULT_ARGS: Readonly<Record<string, ReadonlyArray<string>>> = {
  joggle: ["check", "--format", "json"],
}

const argsFor = (engine: EngineRef): ReadonlyArray<string> =>
  engine.id === "cutlist"
    ? ["build", "--check"]
    : engine.kind === "oxlint-plugin"
      ? ["--format", "json"]
      : (DEFAULT_ARGS[engine.id] ?? [])

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined

const numberOr = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback

/** oxlint speaks `error | warning | advice`; the protocol speaks `error | warn | info`. */
const severityOf = (value: unknown): Severity => {
  if (value === "error") return "error"
  if (value === "info" || value === "notice" || value === "advice") return "info"
  return "warn"
}

/** A path as the report wants it: repository-relative when it sits under the root. */
const relativeTo = (file: string, root: string): string =>
  file.startsWith(`${root}/`) ? file.slice(root.length + 1) : file

/** oxlint puts the position in the first label's span; a report document puts it inline. */
const locationOf = (entry: Record<string, unknown>, root: string): SourceLocation => {
  const location = record(entry.location)
  if (location !== undefined) {
    return {
      file: relativeTo(stringOf(location.file) ?? stringOf(entry.filename) ?? "<unknown>", root),
      line: numberOr(location.line, 1),
      column: numberOr(location.column, 1),
    }
  }
  const labels = entry.labels
  const span = record(record(Array.isArray(labels) ? labels[0] : undefined)?.span)
  return {
    file: relativeTo(stringOf(entry.filename) ?? stringOf(entry.file) ?? "<unknown>", root),
    line: numberOr(span?.line, 1),
    column: numberOr(span?.column, 1),
  }
}

/** Map one engine finding to a protocol diagnostic, or drop it when it is not one. */
export const normalize = (raw: unknown, engine: string, root: string): Diagnostic | undefined => {
  const entry = record(raw)
  const message = stringOf(entry?.message) ?? stringOf(entry?.text)
  if (entry === undefined || message === undefined) return undefined
  const help = stringOf(entry.help)
  const identity = stringOf(entry.identity)
  const docsUrl = stringOf(entry.url) ?? stringOf(entry.docsUrl)
  return {
    engine,
    ruleId: stringOf(entry.ruleId) ?? stringOf(entry.code) ?? stringOf(entry.rule) ?? "unknown",
    severity: severityOf(entry.severity),
    message,
    location: locationOf(entry, root),
    ...(help === undefined ? {} : { help }),
    ...(identity === undefined ? {} : { identity }),
    ...(docsUrl === undefined ? {} : { docsUrl }),
    ...(typeof entry.judged === "boolean" ? { judged: entry.judged } : {}),
    ...(typeof entry.fixable === "boolean" ? { fixable: entry.fixable } : {}),
  }
}

const defined = (value: Diagnostic | undefined): value is Diagnostic => value !== undefined

/**
 * Read an engine's stdout as diagnostics.
 *
 * Two encodings: a whole-document JSON report (`{ diagnostics: [...] }`, what oxlint and
 * `joggle check --format json` emit) and JSONL (one finding per line, what a runner
 * streams). Returns `undefined` when neither fits, so the caller can say so out loud.
 */
export const parseEngineOutput = (
  stdout: string,
  engine: string,
  root: string,
): ReadonlyArray<Diagnostic> | undefined => {
  const trimmed = stdout.trim()
  if (trimmed === "") return []

  if (trimmed.startsWith("{")) {
    try {
      const entry = record(JSON.parse(trimmed))
      if (Array.isArray(entry?.diagnostics)) {
        return entry.diagnostics.map((raw) => normalize(raw, engine, root)).filter(defined)
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
        parsed.push(normalize(JSON.parse(line), engine, root))
      } catch {
        return undefined
      }
    }
    return parsed.filter(defined)
  }

  return undefined
}

/** `cutlist build --check` speaks exit codes, not diagnostics: a non-zero exit is one. */
const cutlistDiagnostics = (
  code: number,
  stdout: string,
  stderr: string,
): ReadonlyArray<Diagnostic> => {
  if (code === 0) return []
  const detail = (stdout.trim() === "" ? stderr : stdout).trim().split("\n")[0] ?? ""
  return [
    {
      engine: "cutlist",
      ruleId: "cutlist/stale-catalog",
      severity: "error",
      message: detail === "" ? "the committed catalog is stale" : detail,
      help: "Run `cutlist build` and commit the result.",
      location: { file: "cutlist.config.json", line: 1, column: 1 },
    },
  ]
}

/** An engine whose output jig cannot read, said out loud rather than passed over. */
const unparsed = (
  id: string,
  code: number,
  stdout: string,
  stderr: string,
): ReadonlyArray<Diagnostic> => {
  const output = (stderr.trim() === "" ? stdout : stderr).trim()
  // A silent, successful exit is a real "no findings". A silent FAILURE is not: the engine
  // said something (on stderr) or said nothing and died, and either way nothing was looked at.
  if (output === "" && code === 0) return []
  return [
    {
      engine: id,
      ruleId: `${id}/unparsed-output`,
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
  code: number,
  stdout: string,
  stderr: string,
  root: string,
): ReadonlyArray<Diagnostic> => {
  if (id === "cutlist") return cutlistDiagnostics(code, stdout, stderr)
  const parsed = parseEngineOutput(stdout, id, root)
  if (parsed !== undefined && (parsed.length > 0 || code === 0)) return parsed
  return unparsed(id, code, stdout, stderr)
}

const summarize = (
  id: string,
  diagnostics: ReadonlyArray<Diagnostic>,
  durationMs: number,
  note?: string,
): EngineSummary => {
  const counts = countsOf(diagnostics)
  return {
    id,
    diagnostics: diagnostics.length,
    error: counts.error,
    warn: counts.warn,
    info: counts.info,
    durationMs,
    ...(note === undefined ? {} : { note }),
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
        summary: summarize(
          id,
          [],
          Date.now() - started,
          "internal engines are host-owned, not process-run",
        ),
        diagnostics: [],
      }
    }

    const binary = engine.command ?? id
    const outcome = yield* Effect.match(exec(binary, argsFor(engine), root), {
      onFailure: (message: string) => ({ ok: false as const, message }),
      onSuccess: (value) => ({ ok: true as const, value }),
    })
    if (!outcome.ok) {
      return {
        id,
        summary: summarize(
          id,
          [],
          Date.now() - started,
          `${binary} could not run: ${outcome.message}`,
        ),
        diagnostics: [],
      }
    }

    const { stdout, stderr, code } = outcome.value
    const diagnostics = engineDiagnostics(id, code, stdout, stderr, root)
    return { id, summary: summarize(id, diagnostics, Date.now() - started), diagnostics }
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
