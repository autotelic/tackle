import type { Diagnostic, EngineSummary, Report } from "@autotelic/protocol"
import type { HarnessRun } from "./run.ts"

/*
 * The renderings of the one report: what a person reads, and what CI annotates.
 *
 * The human form is a pure function of the report, and it is the ONLY human form: the pi
 * extension and the OpenCode plugin hand a model this same text rather than re-rendering.
 * A second renderer is a second answer, and "the agent gets a different answer than CI" is
 * the failure this workspace exists to prevent.
 *
 * The load-bearing rule it keeps visible: an engine that replayed, skipped, or could not
 * judge is annotated as such, so "0 finding(s)" never silently means "clean".
 */

/** How much of the finding list to print. Zero means all of it. */
export interface TextOptions {
  readonly limit?: number
}

/** One engine's census line: what it found, and what it did instead of looking. */
const engineLine = (generator: EngineSummary): string => {
  const annotations: Array<string> = []
  // `ran` is the unremarkable case and stays silent; anything else is news.
  if (generator.status !== undefined && generator.status !== "ran")
    annotations.push(generator.status)
  if (generator.unjudged !== undefined && generator.unjudged > 0) {
    annotations.push(`${generator.unjudged} candidate(s) not judged`)
  }
  if (generator.note !== undefined) annotations.push(generator.note)
  const suffix = annotations.length === 0 ? "" : ` — ${annotations.join("; ")}`
  return `  ${generator.id}: ${generator.diagnostics} finding(s)${suffix}`
}

/** One finding, as a numbered block a person reads and an agent can act on. */
const findingLines = (diagnostic: Diagnostic, index: number): ReadonlyArray<string> => {
  const { file, line, column } = diagnostic.location
  const score = diagnostic.score === undefined ? "" : ` (${diagnostic.score.toFixed(2)})`
  const move = diagnostic.move === undefined ? "" : ` [${diagnostic.move}]`
  // `judged: false` is an engine saying it did not verify this one; absent means the
  // engine does not judge at all, and marking every static lint finding "(unverified)"
  // would be noise about the wrong thing.
  const unverified = diagnostic.judged === false ? " (unverified)" : ""
  const lines: Array<string> = [
    `  ${index}. [${diagnostic.severity}] ${diagnostic.engine}/${diagnostic.ruleId}${move} ${file}:${line}:${column}${score}${unverified}`,
    `     ${diagnostic.message}`,
  ]
  if (diagnostic.help !== undefined) lines.push(`     help: ${diagnostic.help}`)
  if (diagnostic.repair !== undefined) {
    const edits = diagnostic.repair.cascade.length
    const partial = diagnostic.repair.complete ? "" : " (partial)"
    lines.push(`     -> ${diagnostic.repair.operation}, ${edits} edit(s)${partial}`)
  }
  return lines
}

/**
 * The census first — whose silence is whose — then the findings, then the ratchet.
 *
 * The census and the ratchet are never truncated; only the finding list is bounded by
 * `limit`. Truncating a verdict ("did the ratchet hold?") would be a preview that lies.
 */
export const renderText = (run: HarnessRun, options: TextOptions = {}): string => {
  const { report, diff, violations } = run
  const limit = options.limit ?? 0
  const total = report.diagnostics.length
  const shown = limit > 0 ? report.diagnostics.slice(0, limit) : report.diagnostics
  const lines: Array<string> = [
    total === 0
      ? `nothing new — 0 finding(s) in ${report.files} file(s)`
      : `${report.counts.error} error(s), ${report.counts.warn} warning(s), ${report.counts.info} notice(s) in ${report.files} file(s)`,
    "",
    "engines",
  ]
  for (const generator of report.generators) lines.push(engineLine(generator))

  if (total > 0) {
    lines.push("", "findings")
    shown.forEach((diagnostic, index) => {
      lines.push(...findingLines(diagnostic, index + 1))
    })
    if (shown.length < total) {
      lines.push(
        `  … showing ${shown.length} of ${total} finding(s); raise --limit to see the rest`,
      )
    }
  }

  if (violations.length > 0) {
    lines.push("", "ratchet")
    for (const violation of violations) lines.push(`  ${violation}`)
  }
  if (diff.stale.length > 0) {
    lines.push(
      "",
      `${diff.stale.length} baselined finding(s) no longer fire; \`jig baseline\` shrinks the ledger`,
    )
  }
  return lines.join("\n")
}

/** GitHub counts three severities; the protocol's three map onto them by name. */
const ANNOTATION_LEVEL = { error: "error", warn: "warning", info: "notice" } as const

const annotationLevel = (diagnostic: Diagnostic): string => ANNOTATION_LEVEL[diagnostic.severity]

/** GitHub Actions workflow commands, one per finding. */
export const renderGithub = (report: Report): string =>
  report.diagnostics
    .map((diagnostic) => {
      const { file, line, column } = diagnostic.location
      const title = `${diagnostic.engine}/${diagnostic.ruleId}`
      return `::${annotationLevel(diagnostic)} file=${file},line=${line},col=${column},title=${title}::${diagnostic.message}`
    })
    .join("\n")

/** The report as JSON — the machine form a host or a test reads. */
export const renderJson = (report: Report): string => `${JSON.stringify(report, null, 2)}\n`
