import { Match } from "effect"
import type { Diagnostic, Drop, Note, Severity, Structure } from "./schema.ts"
import { moveOrder, moveVocabulary, type Move } from "./moves.ts"

/**
 * The funnel, worded for the report.
 *
 * One line per rule that dropped anything, with the counts by stage and one
 * example. The example matters more than the count: "gated 12" says a threshold
 * may be wrong, while naming one candidate and the reason it failed says whether
 * the threshold is wrong about the right thing.
 */
export const funnelNotes = (drops: ReadonlyArray<Drop>): ReadonlyArray<Note> => {
  const byRule = new Map<string, Map<string, number>>()
  for (const drop of drops) {
    const stages = byRule.get(drop.ruleId) ?? new Map<string, number>()
    stages.set(drop.stage, (stages.get(drop.stage) ?? 0) + 1)
    byRule.set(drop.ruleId, stages)
  }
  return [...byRule.entries()].map(([ruleId, stages]) => {
    const parts = [...stages.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .map(([stage, count]) => stage + " " + count)
    const example = drops.find((drop) => drop.ruleId === ruleId)
    return {
      ruleId,
      reason:
        "dropped " +
        parts.join(", ") +
        (example === undefined ? "" : "; e.g. " + example.subject + ": " + example.reason),
    }
  })
}

/**
 * Output formats, modelled on oxlint's, because oxlint already decided what a
 * linter's output should look like and its decisions are worth copying:
 *
 *   text     one line per problem. Greppable, editor-clickable, tiny in CI.
 *            This is the default precisely because it is not pretty.
 *   stylish  ESLint-compatible: grouped by file, aligned, coloured.
 *   unix     `path:line:col: message [Severity/rule]`, then a count.
 *   json     everything, for another tool.
 *   github   Actions workflow commands.
 *
 * A hand-rolled code frame was removed in favour of the compact form: on a
 * 1,870-file codebase the frames made the report 8,083 lines where oxlint would
 * print 340. A linter's output is read on a terminal and scrolled in CI, and
 * those two want different things.
 */
export type Format = "text" | "stylish" | "unix" | "json" | "github"

/** A skip or a bound: a rule id and a reason. Defined in schema so a stored run
 *  can be decoded with it. */
export type Skipped = Note

export interface Report {
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly files: number
  readonly rules: number
  /** The shape of the codebase, for the backpressure line. */
  readonly structure: Structure
  readonly skipped: ReadonlyArray<Skipped>
  /**
   * Bounds the rules hit, in their own words. A note is not a failure: it is
   * something the rule chose not to look at, and it belongs next to the findings
   * so that a reader can tell "nothing there" from "we stopped looking".
   */
  readonly notes: ReadonlyArray<Skipped>
  /**
   * Candidates the rules considered and did not report, with the reason.
   *
   * This is the funnel that produced the findings. Without it, a rule that found
   * nothing and a rule that looked at nothing read the same.
   */
  readonly drops: ReadonlyArray<Drop>
  /**
   * Where the wall clock went. A run that takes a minute is fine; a run that
   * takes a minute for a reason nobody can see is not.
   */
  readonly timings: ReadonlyArray<{ readonly phase: string; readonly ms: number }>
  readonly decision: {
    readonly requests: number
    readonly replayed: number
    /** Wire calls. Fewer than requests means batching worked. */
    readonly calls: number
    readonly unavailable: number
    readonly inputTokens: number
    readonly outputTokens: number
  }
  readonly elapsedMs: number
  /** True when this run replayed a stored report because nothing changed. */
  readonly replayed: boolean
}

const rank: Record<Severity, number> = { error: 0, warn: 1, info: 2 }

/** Rank findings for reading: file, line, column, severity, then rule. */
export const sortDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> =>
  [...diagnostics].sort(
    (a, b) =>
      a.location.file.localeCompare(b.location.file) ||
      a.location.line - b.location.line ||
      a.location.column - b.location.column ||
      rank[a.severity] - rank[b.severity] ||
      a.ruleId.localeCompare(b.ruleId),
  )

/**
 * The report is a ranked list, not a file listing. A probability decision per candidate gives
 * every finding a comparable score -- see the re-ranking cookbook -- so the
 * most likely real duplication is read first. File order is the tiebreak, which
 * keeps runs deterministic.
 */
export const rankDiagnostics = (
  diagnostics: ReadonlyArray<Diagnostic>,
): ReadonlyArray<Diagnostic> =>
  [...diagnostics].sort(
    (a, b) =>
      (b.score ?? -1) - (a.score ?? -1) ||
      a.location.file.localeCompare(b.location.file) ||
      a.location.line - b.location.line,
  )

interface Palette {
  readonly bold: (text: string) => string
  readonly dim: (text: string) => string
  readonly red: (text: string) => string
  readonly yellow: (text: string) => string
  readonly underline: (text: string) => string
}

const plain: Palette = {
  bold: (t) => t,
  dim: (t) => t,
  red: (t) => t,
  yellow: (t) => t,
  underline: (t) => t,
}

const ansi = (on: boolean): Palette =>
  on
    ? {
        bold: (t) => `\u001b[1m${t}\u001b[0m`,
        dim: (t) => `\u001b[2m${t}\u001b[0m`,
        red: (t) => `\u001b[31m${t}\u001b[0m`,
        yellow: (t) => `\u001b[33m${t}\u001b[0m`,
        underline: (t) => `\u001b[4m${t}\u001b[0m`,
      }
    : plain

/** oxlint and ESLint say "warning"; the internal severity stays short. */
const label = (severity: Severity): string => (severity === "warn" ? "warning" : severity)

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? "" : "s"}`

const counts = (report: Report) => ({
  errors: report.diagnostics.filter((d) => d.severity === "error").length,
  warnings: report.diagnostics.filter((d) => d.severity === "warn").length,
  infos: report.diagnostics.filter((d) => d.severity === "info").length,
  judged: report.diagnostics.filter((d) => d.judged).length,
})

/** Findings per entropy reversal, for a machine. */
const moveCounts = (report: Report) => {
  const of = (key: Move | "correctness"): number =>
    report.diagnostics.filter((diagnostic) => (diagnostic.move ?? "correctness") === key).length
  return { contract: of("contract"), combine: of("combine"), expand: of("expand"), correctness: of("correctness") }
}

const problemSummary = (report: Report): string => {
  const { errors, warnings, infos } = counts(report)
  const total = report.diagnostics.length
  if (total === 0) return "0 problems"
  const parts: Array<string> = []
  if (errors > 0) parts.push(plural(errors, "error"))
  if (warnings > 0) parts.push(plural(warnings, "warning"))
  // `info` was missing from this list, so a run whose findings were all notices
  // printed as "208 problems ()" -- a summary saying nothing at the moment it has
  // the most to say.
  if (infos > 0) parts.push(plural(infos, "notice"))
  return `${plural(total, "problem")} (${parts.join(", ")})`
}

/** joggle-specific tail: how much of this was actually decided, and by what. */
const provenance = (report: Report): string => {
  if (report.replayed) {
    return `Replayed the previous run: nothing it depends on changed across ${plural(report.files, "file")}. No analysis, no decisions, no tokens.`
  }
  const { judged } = counts(report)
  if (report.diagnostics.length === 0 && report.decision.requests === 0) return ""
  const { requests, calls, replayed, unavailable, inputTokens } = report.decision
  const u = unavailable > 0 ? `, ${unavailable} unavailable` : ""
  const phases = report.timings
    .filter((timing) => timing.ms >= 50)
    .sort((a, b) => b.ms - a.ms)
    .map((timing) => `${timing.phase} ${Math.round(timing.ms / 100) / 10}s`)
    .join(", ")
  const where = phases === "" ? "" : ` (${phases})`
  const tokens = `${inputTokens.toLocaleString("en-US")} input tokens`
  return `Finished in ${Math.round(report.elapsedMs / 100) / 10}s on ${plural(report.files, "file")} using ${plural(report.rules, "rule")}${where}. ${judged} of ${report.diagnostics.length} findings verified by the model; ${requests} decisions in ${calls} API calls, ${replayed} replayed${u}, ${tokens}.`
}

const notes = (report: Report): ReadonlyArray<string> => {
  // A missing key changes what the tool IS, not just what it saw, and it was
  // only visible as "0 API calls" in a footer and an "(unverified)" suffix. Say
  // it in a sentence.
  const noKey =
    report.decision.unavailable > 0 && report.decision.calls === 0
      ? [
          "note: no model key reached the provider, so judged rules were skipped. Set TYPESAFE_API_KEY (or run with --offline to say so on purpose).",
        ]
      : []
  return [
    ...noKey,
    ...report.skipped.map((skip) => `note: ${skip.ruleId} skipped — ${skip.reason}`),
    ...report.notes.map((note) => `note: ${note.ruleId} — ${note.reason}`),
  ]
}

/* -------------------------------------------------------------------------- */
/* text                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * The report grouped by entropy reversal.
 *
 * joggle is the entropy reverser: you press the frontier out, then look at what
 * you built and ask what it can be rebuilt from. Each finding says which move it
 * is -- contract a copy back to the primitive that already exists, combine
 * primitives into a composition, or expand the vocabulary with a new name, type
 * or boundary -- and the report prints them in the ratchet order: the copies hide
 * the primitives, so contract first; composing makes them explicit; a new
 * primitive is built out of the ones you can now see. A finding with no move
 * checks the code against a requirement and belongs in neither.
 */
const moveCensus = (report: Report): ReadonlyArray<string> => {
  const counted = new Map<Move | "correctness", number>()
  for (const diagnostic of report.diagnostics) {
    const key = diagnostic.move ?? "correctness"
    counted.set(key, (counted.get(key) ?? 0) + 1)
  }
  const keys: ReadonlyArray<Move | "correctness"> = [...moveOrder, "correctness"]
  const rows = keys.filter((key) => (counted.get(key) ?? 0) > 0)
  // One bucket is not a grouping, and a run that is all correctness gains
  // nothing from a heading that says so.
  if (rows.length <= 1) return []
  const width = Math.max(
    ...rows.map((key) => (key === "correctness" ? "correctness" : moveVocabulary[key].label).length),
  )
  const lines = ["", "by move:"]
  for (const key of rows) {
    const name = key === "correctness" ? "correctness" : moveVocabulary[key].label
    const blurb =
      key === "correctness" ? "a requirement the code does not meet" : moveVocabulary[key].blurb
    lines.push(String(counted.get(key)).padStart(5) + "  " + name.padEnd(width) + "  " + blurb)
  }
  return lines
}

/**
 * How many findings each rule produced, largest first.
 *
 * The flat list is right for a machine and right for CI, and it is a wall at scale:
 * nine hundred findings in score order tells a reader nothing about what KIND of
 * work they are being handed. This is the shape of the report, printed above the
 * summary, and it is omitted when there is only one rule because a census of one
 * is a line that says nothing.
 */
const census = (report: Report): ReadonlyArray<string> => {
  const byRule = new Map<string, { total: number; warnings: number; notices: number }>()
  for (const diagnostic of report.diagnostics) {
    const entry = byRule.get(diagnostic.ruleId) ?? { total: 0, warnings: 0, notices: 0 }
    entry.total += 1
    if (diagnostic.severity === "warn") entry.warnings += 1
    if (diagnostic.severity === "info") entry.notices += 1
    byRule.set(diagnostic.ruleId, entry)
  }
  if (byRule.size <= 1) return []
  const rows = [...byRule.entries()].sort(
    (left, right) => right[1].total - left[1].total || left[0].localeCompare(right[0]),
  )
  const width = Math.max(...rows.map(([id]) => id.length))
  const lines = ["", "by rule:"]
  for (const [id, counts] of rows) {
    const detail = [
      counts.warnings > 0 ? plural(counts.warnings, "warning") : "",
      counts.notices > 0 ? plural(counts.notices, "notice") : "",
    ]
      .filter((part) => part !== "")
      .join(", ")
    const leading = String(counts.total).padStart(5) + "  " + id.padEnd(width)
    lines.push(detail === "" ? leading : leading + "  " + detail)
  }
  return lines
}

/**
 * The operation a finding proposes, when it proposes one.
 *
 * It goes on the same line as the problem, because the operation IS the finding:
 * "merge into a.ts:8, 4 edits" is a work order, and "declared twice" is a
 * complaint. A host that ignores it still gets a linter.
 */
const operationNote = (diagnostic: Diagnostic): string => {
  const repair = diagnostic.repair
  if (repair === undefined) return ""
  const edits = repair.cascade.length
  return ` -> ${repair.operation}, ${edits} edit${edits === 1 ? "" : "s"}`
}

/**
 * The shape of the codebase, and what this run changed.
 *
 * The number to watch is the concept count against the declaration count: a
 * change that adds declarations without adding concepts is the entropy this tool
 * exists to remove.
 */
const structureLine = (structure: Structure): string => {
  const { concepts, declarations, duplicated, overloaded } = structure
  // A replayed report has no measurement of its own, and a zero that looks
  // measured is worse than silence.
  if (declarations === 0) return ""
  return `${concepts} concept${concepts === 1 ? "" : "s"} · ${declarations} declaration${declarations === 1 ? "" : "s"} · ${duplicated} duplicated · ${overloaded} overloaded`
}

const findingLine = (d: Diagnostic): string => {
  const { file, line, column } = d.location
  const help = d.help === undefined ? "" : ` help: ${d.help}`
  const score = d.score === undefined ? "" : ` (${d.score.toFixed(2)})`
  return `${file}:${line}:${column}: ${label(d.severity)} ${d.ruleId}${score}: ${d.message}${operationNote(d)}${help}`
}

const text = (report: Report): string => {
  const lines: Array<string> = []
  // Group the findings by the reversal they propose, in the ratchet order, when
  // any of them propose one. A flat list is a wall; a grouping by move is the
  // question the tool exists to ask.
  if (report.diagnostics.some((diagnostic) => diagnostic.move !== undefined)) {
    for (const move of moveOrder) {
      const findings = report.diagnostics.filter((diagnostic) => diagnostic.move === move)
      if (findings.length === 0) continue
      lines.push("")
      lines.push(moveVocabulary[move].label + " — " + moveVocabulary[move].blurb)
      lines.push(...findings.map(findingLine))
    }
    const rest = report.diagnostics.filter((diagnostic) => diagnostic.move === undefined)
    if (rest.length > 0) {
      lines.push("")
      lines.push("correctness — a requirement the code does not meet")
      lines.push(...rest.map(findingLine))
    }
  } else {
    lines.push(...report.diagnostics.map(findingLine))
  }
  if (lines.length > 0) lines.push("")
  lines.push(...moveCensus(report))
  lines.push(...census(report))
  lines.push(problemSummary(report))
  const measured = structureLine(report.structure)
  if (measured !== "") lines.push(measured)
  const provenanceLine = provenance(report)
  if (provenanceLine !== "") lines.push(provenanceLine)
  lines.push(...notes(report))
  return lines.join("\n")
}

/* -------------------------------------------------------------------------- */
/* stylish                                                                    */
/* -------------------------------------------------------------------------- */

const stylish = (report: Report, c: Palette): string => {
  const lines: Array<string> = []
  const byFile = new Map<string, Array<Diagnostic>>()
  for (const diagnostic of report.diagnostics) {
    const existing = byFile.get(diagnostic.location.file)
    if (existing === undefined) byFile.set(diagnostic.location.file, [diagnostic])
    else existing.push(diagnostic)
  }

  for (const [file, diagnostics] of byFile) {
    lines.push("")
    lines.push(c.underline(file))
    const where = diagnostics.map((d) => `${d.location.line}:${d.location.column}`)
    const severity = diagnostics.map((d) => label(d.severity))
    const whereWidth = Math.max(...where.map((w) => w.length))
    const severityWidth = Math.max(...severity.map((s) => s.length))
    diagnostics.forEach((diagnostic, index) => {
      // Pad before colouring: ANSI escapes count as characters to padEnd.
      const padded = (severity[index] ?? "").padEnd(severityWidth)
      const level = diagnostic.severity === "error" ? c.red(padded) : c.yellow(padded)
      const verified = diagnostic.judged ? "" : c.dim(" (unverified)")
      const score = diagnostic.score === undefined ? "" : diagnostic.score.toFixed(2)
      lines.push(
        `  ${c.dim((where[index] ?? "").padEnd(whereWidth))}  ${level}  ${c.dim(score.padEnd(4))}  ${diagnostic.message}${verified}  ${c.dim(diagnostic.ruleId)}`,
      )
    })
  }

  const { errors } = counts(report)
  const summary = problemSummary(report)
  if (lines.length > 0) lines.push("")
  lines.push(errors > 0 ? c.red(`✖ ${summary}`) : c.yellow(`✖ ${summary}`))
  const provenanceLine = provenance(report)
  if (provenanceLine !== "") lines.push(c.dim(provenanceLine))
  lines.push(...notes(report).map((n) => c.dim(n)))
  return lines.join("\n")
}

/* -------------------------------------------------------------------------- */
/* unix                                                                       */
/* -------------------------------------------------------------------------- */

const unix = (report: Report): string => {
  const lines = report.diagnostics.map((d) => {
    const { file, line, column } = d.location
    const severity = d.severity === "error" ? "Error" : "Warning"
    return `${file}:${line}:${column}: ${d.message} [${severity}/${d.ruleId}]`
  })
  lines.push("")
  lines.push(problemSummary(report).replace(/ \(.*\)$/, ""))
  return lines.join("\n")
}

/* -------------------------------------------------------------------------- */
/* machine formats                                                            */
/* -------------------------------------------------------------------------- */

const json = (report: Report): string =>
  JSON.stringify(
    {
      diagnostics: report.diagnostics,
      summary: {
        files: report.files,
        rules: report.rules,
        structure: report.structure,
        problems: report.diagnostics.length,
        ...counts(report),
        byMove: moveCounts(report),
        skipped: report.skipped,
        notes: report.notes,
        decision: report.decision,
        replayed: report.replayed,
        timings: report.timings,
        elapsedMs: report.elapsedMs,
        // The funnel, in the machine-readable format too. It was in the report and
        // not in the JSON, which made the one artifact a script can read the one
        // artifact that hid where the candidates went -- and reading it is how the
        // gated band below was found.
        drops: report.drops,
      },
    },
    null,
    2,
  )

/** GitHub Actions workflow commands, so CI annotations come for free. */
const github = (report: Report): string => {
  const lines: Array<string> = []
  for (const diagnostic of report.diagnostics) {
    const level =
      Match.value(diagnostic.severity).pipe(
        Match.when("error", () => "error"),
        Match.when("warn", () => "warning"),
        Match.orElse(() => "notice"),
      )
    const { file, line, column } = diagnostic.location
    const body = diagnostic.help === undefined ? diagnostic.message : `${diagnostic.message} ${diagnostic.help}`
    lines.push(
      `::${level} file=${file},line=${line},col=${column},title=${diagnostic.ruleId}::${body.replace(/\r?\n/g, " ")}`,
    )
  }
  for (const skip of report.skipped) {
    lines.push(`::notice title=${skip.ruleId}::rule skipped — ${skip.reason}`)
  }
  return lines.join("\n")
}

/** Render a report in one of the output formats. */
export const render = (
  report: Report,
  format: Format,
  options: { readonly color?: boolean | undefined } = {},
): string => {
  switch (format) {
    case "json":
      return json(report)
    case "github":
      return github(report)
    case "unix":
      return unix(report)
    case "stylish":
      return stylish(report, ansi(options?.color === true))
    case "text":
      return text(report)
  }
}

/** The process exit code a report and a warning ceiling imply. */
export const exitCodeFor = (report: Report, maxWarnings: number): number => {
  const { errors, warnings } = counts(report)
  if (errors > 0) return 1
  if (maxWarnings >= 0 && warnings > maxWarnings) return 1
  return 0
}
