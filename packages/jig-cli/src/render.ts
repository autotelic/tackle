import {
  identityOf,
  ruleNameOf,
  type Diagnostic,
  type EngineSummary,
  type Report,
} from "@autotelic/protocol"
import { EXIT, type GateVerdict } from "./gate.ts"
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
  /** The gate's verdict, so the text and the exit code can never disagree. */
  readonly gate?: GateVerdict
  /**
   * What the run was narrowed to, when it was.
   *
   * A scoped run that prints the same census line as a whole-tree run is a lie of omission:
   * "0 findings" over three changed files and "0 findings" over the repository look
   * identical, and only one of them means the tree is clean.
   */
  readonly scope?: string
  /**
   * Findings the run READ and then narrowed away.
   *
   * A scoped run answers for its change; it must also say how much it saw outside, because a
   * zero that came from a file filter is not the same zero as a clean repository.
   */
  readonly outOfScope?: number
  /**
   * Whether the committed ledger has no identities.
   *
   * An empty ledger under `any-new` makes every existing finding new, so the gate is red on
   * adoption and every pull request fails on debt it did not create. The report says which of
   * those states it is in, and the two ways out.
   */
  readonly emptyLedger?: boolean
}

/**
 * One line per rule the gate holds against the run, then where the failures are.
 *
 * A count without a place is a log nobody can act on: a gate that re-opens 91 findings in one
 * rule and names none of them sends a reader looking through 91 files by hand. Three samples
 * are enough to recognise the neighborhood, and the full list is still in the report above.
 */
const gateLines = (failing: ReadonlyArray<Diagnostic>): ReadonlyArray<string> => {
  const byRule = new Map<string, ReadonlyArray<Diagnostic>>()
  for (const diagnostic of failing) {
    const key = ruleNameOf(diagnostic)
    byRule.set(key, [...(byRule.get(key) ?? []), diagnostic])
  }
  const lines: Array<string> = []
  for (const [rule, group] of [...byRule.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const count = group.length
    lines.push(`  ${rule}: ${count} failing finding${count === 1 ? "" : "s"}`)
    const samples = group
      .slice(0, 3)
      .map((diagnostic) => `${diagnostic.location.file}:${diagnostic.location.line}`)
    if (samples.length > 0) lines.push(`    ${samples.join(", ")}`)
  }
  return lines
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
  const { report, diff } = run
  const limit = options.limit ?? 0
  const total = report.diagnostics.length
  const shown = limit > 0 ? report.diagnostics.slice(0, limit) : report.diagnostics
  // What the engines did NOT judge, summed across them: a run that stopped asking says so in
  // the headline, because "0 findings" from an unjudged half is not an architectural verdict
  // and a trailing engine note is easy to scroll past.
  const unjudged = report.generators.reduce((sum, generator) => sum + (generator.unjudged ?? 0), 0)
  // Findings and findings nobody judged are different units, and adding them into one headline
  // number is what made "5315 findings" read as debt when most of it was budget starvation.
  const unverified = report.diagnostics.filter((diagnostic) => diagnostic.judged === false).length
  const notJudged =
    (unjudged > 0 ? `; ${unjudged} candidate(s) not judged` : "") +
    (unverified > 0 ? `; ${unverified} of these finding(s) unverified (no judgement reached)` : "")
  const lines: Array<string> = [
    report.generators.length === 0
      ? "no engines ran — this is not a clean run"
      : total === 0
        ? `nothing new — 0 finding(s) in ${report.files} file(s)${notJudged}`
        : `${report.counts.error} error(s), ${report.counts.warn} warning(s), ${report.counts.info} notice(s) in ${report.files} file(s)${notJudged}`,
    ...(options.scope === undefined
      ? []
      : [
          `scope — ${options.scope}` +
            (options.outOfScope === undefined || options.outOfScope === 0
              ? ""
              : `; ${options.outOfScope} finding(s) outside this scope, not shown (run without a scope for the repository)`),
        ]),
    "",
    "engines",
  ]
  for (const generator of report.generators) lines.push(engineLine(generator))
  if (report.generators.length === 0) {
    lines.push("  none configured — add an engine to jig.config.json, then run `jig engines`")
  }

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

  // The gate's own section: the findings it holds, and the engines whose silence it cannot
  // rule on. The census above never folds into this — a replayed engine is not a passing one.
  const gate = options.gate
  if (gate !== undefined && gate.infrastructure.length > 0) {
    lines.push(
      "",
      report.generators.length === 0
        ? `gate — no engines configured; nothing was looked at (exit ${EXIT.infrastructure})`
        : `gate — engine(s) could not run: ${gate.infrastructure.join(", ")} (exit ${EXIT.infrastructure})`,
    )
  }
  if (
    gate !== undefined &&
    gate.scope === "touched-files" &&
    gate.failing.length === 0 &&
    total > 0
  ) {
    lines.push(
      "",
      `gate — touched-files: no finding in this change; ${total} existing finding(s) are reported, not enforced`,
    )
  }
  if (
    gate !== undefined &&
    gate.failing.length > 0 &&
    gate.failOn === "any-new" &&
    options.emptyLedger === true
  ) {
    lines.push(
      "",
      "gate — the ledger is empty, so every finding in the tree is new to this gate: accept today's" +
        " debt with `jig baseline` (a model key is needed when judged rules are configured, or" +
        " --allow-unjudged to accept that debt explicitly), or scope this run to the change" +
        " (`jig check --since <base>`).",
    )
  }
  if (gate !== undefined && gate.failing.length > 0) {
    lines.push("", `gate — failOn: ${gate.failOn}, scope: ${gate.scope}`)
    lines.push(...gateLines(gate.failing))
  }
  /*
   * What the report shows but this gate can never hold.
   *
   * A warning under `failOn: error`, an identity the ledger already accepted, or a rule a repo
   * marked advisory all read the same way in the findings list and all mean "reported, never
   * enforced". A repo that keeps a second, errors-only lint config needs this line: without it
   * the only way to learn a rule is unenforceable is to diff two config files.
   */
  if (gate !== undefined) {
    const held = new Set(gate.failing)
    const advisory = new Set(gate.advisory)
    const reach = new Map<string, number>()
    for (const diagnostic of report.diagnostics) {
      if (held.has(diagnostic) || advisory.has(diagnostic)) continue
      const rule = `${diagnostic.engine}/${diagnostic.ruleId}`
      reach.set(rule, (reach.get(rule) ?? 0) + 1)
    }
    if (reach.size > 0) {
      const count = [...reach.values()].reduce((sum, value) => sum + value, 0)
      const top = [...reach].sort((left, right) => right[1] - left[1]).slice(0, 3)
      const rest = reach.size - top.length
      lines.push(
        "",
        `gate — ${count} finding(s) reported and cannot fail this gate (failOn: ${gate.failOn}): ` +
          top.map(([rule, found]) => `${rule} ${found}`).join(", ") +
          (rest > 0 ? `, +${rest} more rule(s)` : ""),
      )
    }
  }
  if (gate !== undefined && gate.advisory.length > 0) {
    const byEngine = new Map<string, number>()
    for (const diagnostic of gate.advisory) {
      byEngine.set(diagnostic.engine, (byEngine.get(diagnostic.engine) ?? 0) + 1)
    }
    // Advisory is a decision about the exit code, not about the report: say so, or a reader
    // takes a green run over 1,167 findings for a clean tree.
    lines.push(
      "",
      `gate — advisory (reported, not gating): ${[...byEngine]
        .map(([engine, count]) => `${engine} ${count} finding(s)`)
        .join(", ")}`,
    )
  }
  // Only a whole-tree run can say a ledger entry stopped firing: a scoped diff compared the
  // ledger to a handful of files, so every identity outside that slice would read as stale.
  if (diff.stale.length > 0 && options.scope === undefined) {
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

/** The gate in one annotation, for the formats that carry no census of their own. */
const gateSummary = (gate: GateVerdict, held: number): string => {
  if (gate.infrastructure.length > 0) {
    return `no verdict — engine(s) could not run: ${gate.infrastructure.join(", ")} (exit ${EXIT.infrastructure})`
  }
  if (gate.failing.length > 0) {
    return `failOn ${gate.failOn}, scope ${gate.scope}: ${gate.failing.length} finding(s) held against the run (exit ${EXIT.findings})`
  }
  return `failOn ${gate.failOn}, scope ${gate.scope}: gate passed; ${held} baselined finding(s) reported, not held (exit ${EXIT.clean})`
}

/** What a CI annotation needs beyond the report: what the ledger holds and what the gate decided. */
export interface GithubOptions {
  /** Accepted identities. A held finding is annotated as a notice, never as an error. */
  readonly known?: ReadonlySet<string>
  readonly gate?: GateVerdict
}

/**
 * GitHub Actions workflow commands, one per finding, then the gate.
 *
 * A finding's severity is not the gate's decision: an identity the baseline already accepted
 * passes the gate, and annotating it `::error` paints a green run red. Held findings are
 * notices, and the gate gets its own line so the log says which of the two failed.
 */
export const renderGithub = (report: Report, options: GithubOptions = {}): string => {
  const known = options.known
  const held = (diagnostic: Diagnostic): boolean =>
    known !== undefined && known.has(identityOf(diagnostic))
  // The gate can hold a finding the engine only called a notice: `failOn: any-new` fails on
  // novelty, not severity. Annotating that by its own severity left the log's only red line
  // somewhere else — the failure was real, and nothing in it said so.
  const failing =
    options.gate === undefined ? undefined : new Set(options.gate.failing.map(identityOf))
  // The census first, in the same words the text report uses: an engine that skipped a rule
  // or left candidates unjudged found *nothing to say*, which is not the same as nothing to
  // find. `--format github` used to drop that entirely, so a CI step could print no
  // annotations at all and exit 0 while the rules it exists to run never looked.
  const census: Array<string> = []
  for (const generator of report.generators) {
    const annotations: Array<string> = []
    if (generator.status !== undefined && generator.status !== "ran")
      annotations.push(generator.status)
    if (generator.unjudged !== undefined && generator.unjudged > 0) {
      annotations.push(`${generator.unjudged} candidate(s) not judged`)
    }
    if (generator.note !== undefined) annotations.push(generator.note)
    if (annotations.length === 0) continue
    census.push(`::warning title=jig census (${generator.id})::${annotations.join("; ")}`)
  }
  const lines = report.diagnostics.map((diagnostic) => {
    const { file, line, column } = diagnostic.location
    const title = `${diagnostic.engine}/${diagnostic.ruleId}`
    const heldAgainst = failing?.has(identityOf(diagnostic)) ?? false
    const accepted = !heldAgainst && held(diagnostic)
    const level = heldAgainst ? "error" : accepted ? "notice" : annotationLevel(diagnostic)
    const suffix = accepted ? " (accepted in the baseline)" : ""
    return `::${level} file=${file},line=${line},col=${column},title=${title}::${diagnostic.message}${suffix}`
  })
  const gate = options.gate
  lines.unshift(...census)
  if (gate !== undefined) {
    const heldCount = report.diagnostics.filter(held).length
    const failed = gate.failing.length > 0 || gate.infrastructure.length > 0
    lines.push(`::${failed ? "error" : "notice"} title=jig gate::${gateSummary(gate, heldCount)}`)
  }
  return lines.join("\n")
}

/** The report as JSON — the machine form a host or a test reads. */
export const renderJson = (report: Report): string => `${JSON.stringify(report, null, 2)}\n`
