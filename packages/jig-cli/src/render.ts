import type { Diagnostic, Report } from "@autotelic/protocol"
import type { HarnessRun } from "./run.ts"

/* Two renderings of the one report: what a person reads, and what CI annotates. */

/** The census first — whose silence is whose — then the ratchet. */
export const renderText = (run: HarnessRun): string => {
  const { report, diff, violations } = run
  const lines: Array<string> = [
    `${report.counts.error} error(s), ${report.counts.warn} warning(s), ${report.counts.info} notice(s) in ${report.files} file(s)`,
    "",
    "engines",
  ]
  for (const generator of report.generators) {
    const note = generator.note === undefined ? "" : ` — ${generator.note}`
    lines.push(`  ${generator.id}: ${generator.diagnostics} finding(s)${note}`)
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

const annotationLevel = (diagnostic: Diagnostic): string =>
  diagnostic.severity === "error" ? "error" : diagnostic.severity === "warn" ? "warning" : "notice"

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
