import {
  identityOf,
  ruleNameOf,
  type BaselineDiff,
  type Diagnostic,
  type Report,
} from "@autotelic/protocol"

/*
 * The three commands that only READ the one report: `explain`, `promote`, `learn`.
 *
 * None of them gates, so none of them re-derives anything: each is a pure function of a
 * report, a diff, and the config — the same bytes a person reads and a test checks. Each
 * keeps the invariant too: "nothing here" and "nobody looked" are different sentences, and
 * so are "no such engine" and "the engine ran and said nothing".
 */

/** One finding, expanded into the work order an agent acts on. */
const findingBlock = (diagnostic: Diagnostic, index: number): ReadonlyArray<string> => {
  const { file, line, column } = diagnostic.location
  const lines: Array<string> = [
    `  ${index}. ${file}:${line}:${column} [${diagnostic.severity}]`,
    `     ${diagnostic.message}`,
  ]
  if (diagnostic.help !== undefined) lines.push(`     help: ${diagnostic.help}`)
  if (diagnostic.docsUrl !== undefined) lines.push(`     docs: ${diagnostic.docsUrl}`)
  if (diagnostic.move !== undefined) lines.push(`     move: ${diagnostic.move}`)
  if (diagnostic.score !== undefined) lines.push(`     score: ${diagnostic.score.toFixed(2)}`)
  const repair = diagnostic.repair
  if (repair !== undefined) {
    lines.push(`     repair: ${repair.operation} — ${repair.settled}`)
    for (const remove of repair.remove) {
      lines.push(`       drop ${remove.file}:${remove.line}:${remove.column}`)
    }
    for (const edit of repair.cascade) {
      lines.push(`       ${edit.file}:${edit.line}:${edit.column} — ${edit.instruction}`)
    }
  }
  return lines
}

/**
 * Everything jig knows about one rule in this repo, right now.
 *
 * `rule` is `engine/ruleId`, or a bare `ruleId` when the engine is unambiguous. The answer
 * separates the three states the invariant keeps apart: an engine that is not configured,
 * an engine that ran and reported nothing for this rule, and the rule's findings — printed
 * with their `help`, `docsUrl`, and `repair` so the answer is a fix, not a restatement.
 */
export const explainRule = (
  report: Report,
  rule: string,
  configured: ReadonlyArray<string>,
): string => {
  const slash = rule.indexOf("/")
  const engine = slash < 0 ? undefined : rule.slice(0, slash)
  if (engine !== undefined && !configured.includes(engine)) {
    return `jig: no configured engine named "${engine}"; configured: ${configured.join(", ")}`
  }
  const matches = report.diagnostics.filter((diagnostic) =>
    engine === undefined ? diagnostic.ruleId === rule : ruleNameOf(diagnostic) === rule,
  )
  if (matches.length === 0) {
    const who = engine === undefined ? "no configured engine named it" : `the ${engine} engine ran`
    return `jig: ${rule} — nothing in this run (${who})`
  }
  const first = matches[0]
  const lines = [`${first === undefined ? rule : ruleNameOf(first)} — ${matches.length} finding(s)`]
  matches.forEach((diagnostic, index) => {
    lines.push(...findingBlock(diagnostic, index + 1))
  })
  return lines.join("\n")
}

/** The ratchet's next rung: the accepted identities a run no longer earns, and the rest. */
export interface Promotion {
  /** Accepted identities that no longer fire. Removing them is the ratchet moving down. */
  readonly stale: ReadonlyArray<string>
  /** Accepted identities that still fire. They stay. */
  readonly held: ReadonlyArray<string>
  /** Identities that fire and were never accepted. `promote` never accepts them. */
  readonly novel: ReadonlyArray<string>
}

const sortedUnique = (identities: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(identities)].sort((left, right) => left.localeCompare(right))

/** Read the next rung off a diff. Pure, so `promote` can be checked without running anything. */
export const promotion = (diff: BaselineDiff): Promotion => ({
  stale: sortedUnique(diff.stale),
  held: sortedUnique(diff.known.map(identityOf)),
  novel: sortedUnique(diff.novel.map(identityOf)),
})

/**
 * The rung, as a person reads it.
 *
 * `promote` only ever SHRINKS: it drops accepted identities that no longer fire and refuses
 * to accept new ones, because accepting is a human decision (`jig baseline`). The text says
 * both, so nobody mistakes a promote for a way to make findings go away.
 */
export const renderPromotion = (plan: Promotion, applied = false): string => {
  if (plan.stale.length === 0) {
    return `jig: nothing to promote — every accepted finding still fires (${plan.held.length} held)`
  }
  const verb = applied ? "dropped" : "no longer fires"
  const lines = [`jig: ${plan.stale.length} accepted finding(s) ${verb}:`]
  for (const identity of plan.stale) lines.push(`  ${identity}`)
  lines.push(`${plan.held.length} still held; ${plan.novel.length} new and not accepted`)
  if (!applied)
    lines.push("run `jig promote --write` to drop them; `jig baseline` accepts new ones")
  return lines.join("\n")
}

/** What `learn` writes: the agent door, built from what this repo already holds. */
export interface Lesson {
  /** The configured engine ids, in config order. */
  readonly engines: ReadonlyArray<string>
  /** The rule names this repo already accepts, sorted and unique. */
  readonly accepted: ReadonlyArray<string>
}

/** Read a lesson off the config and the diff's `known` half. */
export const lesson = (engines: ReadonlyArray<string>, diff: BaselineDiff): Lesson => ({
  engines,
  accepted: sortedUnique(diff.known.map(ruleNameOf)),
})

/**
 * The cookbook (`JIG.md`), scaffolded from what the repo already accepts.
 *
 * The point of `learn` over `init`'s static text is the accepted-rule list: an agent that
 * knows which rules this repo already tolerates can tell "new" from "known" without a second
 * source. An empty list says so explicitly rather than leaving the section out.
 */
export const renderLesson = (input: Lesson): string => {
  const lines = [
    "# JIG.md",
    "",
    "The agents you run here get the same findings a human's terminal does — one report, one",
    "vocabulary. Reach for these instead of re-deriving them:",
    "",
    "- `jig check` — run every engine, one report, fail on anything new.",
    "- `jig baseline` — accept the current findings; the ledger only shrinks after that.",
    "- `jig explain <engine/ruleId>` — everything known about one rule, right now.",
    "",
    `Engines configured in \`jig.config.json\`: ${input.engines.join(", ")}.`,
  ]
  if (input.accepted.length === 0) {
    lines.push("", "This repo accepts no findings yet: every finding a run reports is new.")
  } else {
    lines.push(
      "",
      `This repo already accepts ${input.accepted.length} rule(s); their findings are known, not new:`,
      "",
    )
    for (const rule of input.accepted) lines.push(`- \`${rule}\``)
  }
  return lines.join("\n")
}
