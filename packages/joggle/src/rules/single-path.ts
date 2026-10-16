import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import {
  budgetNote,
  inScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type RunContext,
  type Scope,
} from "../rule.ts"
import { returnTypesOf } from "../result.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { StringSite, Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/single-path"

// A value built longhand beside the helper that already builds it.
//
// The review case: a PR claimed "every table that prints money goes through
// `formatDollar`", and the reviewer found three screens that build the string
// themselves. A claimed single path that nothing enforces is a path that drifts.
//
// Two facts, and neither classifies:
//
//   the site     an AST string construction -- a template literal, or a `+` with
//                a string literal -- and the references it interpolates
//   the helpers  functions this FILE already calls and that other files call too,
//                from the resolved call graph
//
// An earlier version matched `toFixed(2)` and `Intl.NumberFormat` against the
// source and kept a list of formatter names. That decided the question Jev is
// for, and it was coupled to one repository's naming (docs/rule-coupling.md).
// The site is syntax, the helpers are the graph, and what it MEANS is asked.
//
// A third fact narrows the helpers, when the type layer ran: the checker's type
// at a helper's return. A helper that returns only `void`, `number` or another
// non-string scalar cannot be the single string path, so it is not offered. The
// filter never drops a helper whose return type is unknown.
type Helper = {
  readonly name: string
  readonly file: string
  readonly body: string
}

/**
 * Whether a printed return type can BE a string.
 *
 * The filter above removes the scalars; this keeps only the helpers whose return
 * is a string, so an object, a `Set<string>` or a `string[]` is not offered just
 * because a `string` appears somewhere inside it. `Set<string>` is not a string
 * and cannot be the single string path; `string`, `string | undefined` and
 * `Promise<string>` are.
 */
const stringCapable = (type: string): boolean => {
  const trimmed = type.trim()
  return trimmed === "string" || trimmed === "Promise<string>" || trimmed.split("|").some((member) => member.trim() === "string")
}

/**
 * Whether a declaration's recorded returns leave it a candidate.
 *
 * Unknown -- no type layer, no recorded return, an untyped return -- keeps the
 * helper: a filter must never lose a real path. A helper whose every recorded
 * return is a known non-string type is not the single string path.
 */
const canBuildString = (types: ReadonlyArray<string | undefined>): boolean =>
  types.length === 0 || types.some((type) => type === undefined || stringCapable(type))

/** How many files call each declaration, from the resolved call graph. */
const callersOf = (workspace: Workspace): ReadonlyMap<string, ReadonlySet<string>> => {
  const callerFiles = new Map<string, Set<string>>()
  for (const unit of workspace.units) {
    for (const call of unit.calls) {
      const files = callerFiles.get(call) ?? new Set<string>()
      files.add(unit.file)
      callerFiles.set(call, files)
    }
  }
  return callerFiles
}

export const singlePath: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A value built longhand beside the helper that already builds it.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    inline_derivation:
      "{{unit}} builds a string here (`{{snippet}}`) though this file already uses {{helpers}}.",
    inline_derivation_help:
      "Call the helper instead of building the string here, if it produces the same value. Two spellings of one display value drift: the second rounds differently, keeps a sign on a zero, or uses another locale, and the difference is invisible until two screens are compared.{{unverified}}",
  }),
  plan: Effect.fn("joggle/single-path")(function* (workspace: Workspace, scope: Scope, context: RunContext) {
    const report = reporter(singlePath, locator(workspace))
    const callerFiles = callersOf(workspace)
    const byIdentity = new Map<string, Unit>()
    for (const unit of workspace.units) byIdentity.set(unit.file + "#" + unit.name, unit)
    const textOf = new Map(workspace.files.map((file) => [file.path, file.text]))
    const filesByPath = new Map(workspace.files.map((file) => [file.path, file]))

    const candidates: Array<{ unit: Unit; file: string; site: StringSite; helpers: ReadonlyArray<Helper> }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      // The helpers this file already calls and other files call too: a function
      // the file uses is a function it can use again, and a helper only this file
      // calls is not yet a shared path.
      const used = new Set<string>()
      for (const unit of file.units) for (const call of unit.calls) used.add(call)
      const helpers: Array<Helper> = []
      for (const identity of used) {
        const callers = callerFiles.get(identity)
        if (callers === undefined || callers.size < 2) continue
        const declaration = byIdentity.get(identity)
        if (declaration === undefined) continue
        if (!canBuildString(returnTypesOf(declaration, filesByPath.get(declaration.file), context.nodeTypes))) continue
        helpers.push({
          name: declaration.name,
          file: declaration.file,
          body: declaration.text.slice(0, 240),
        })
      }
      if (helpers.length === 0) continue
      const bounded = helpers.slice(0, policy.evidence.maxMembers)
      const helperNames = new Set(helpers.map((helper) => helper.name))
      for (const unit of file.units) {
        if (helperNames.has(unit.name)) continue // the helper is where the string belongs
        if (unit.text.length > policy.evidence.maxSourceChars) continue
        for (const site of file.facts.stringSites) {
          if (site.start < unit.start || site.end > unit.end) continue
          candidates.push({ unit, file: file.path, site, helpers: bounded })
        }
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no file builds a string while calling a helper that more than one file uses, so there was no single path to compare it with",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 16
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " string sites",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const text = textOf.get(candidate.file) ?? ""
          const id = yield* atoms.add({
            site: {
              unit: candidate.unit.name,
              file: candidate.file,
              refs: [...candidate.site.refs],
              source: text.slice(candidate.site.start, Math.min(candidate.site.end, candidate.site.start + 160)),
            },
            helpers: [...candidate.helpers],
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + " (" + candidate.file + ")",
            concerns: [candidate.file, ...candidate.helpers.map((helper) => helper.file)],
            atoms: [id],
            violations: { verdict: ["reimplements"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].site.source\`, in \`atoms[${id}].site.unit\`, builds a string. The references it interpolates are \`atoms[${id}].site.refs\`.`,
                  `These helpers are already used in this file and across files: \`atoms[${id}].helpers\` (each with its body).`,
                  "Does the inline string re-implement one of them?",
                  "Answer `reimplements` when a listed helper produces the same value and the site should call it -- the rounding, the sign, the locale or the zero are the same question asked twice.",
                  "Answer `legitimate_local` when no listed helper covers this case: a different unit, locale or format, or a value a helper would render wrongly.",
                  "Answer `not_a_derivation` when the string is not a derived display value at all.",
                ].join("\n"),
                criteria: {
                  reimplements: "One of the helpers does this. Call it.",
                  legitimate_local: "No helper covers this case.",
                  not_a_derivation: "Not a derived display value.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { candidate, plan }
        }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((entry, index) => {
          const { candidate } = entry
          const subject = candidate.unit.name + " (" + candidate.file + ")"
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["reimplements"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "reimplements") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "legitimate_local"
                  ? "no helper covers this case"
                  : "not a derived display value",
            })
            return
          }
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({ ruleId: RULE_ID, subject, stage: "gated", reason: quality.reason })
            return
          }
          const review = quality.quality === "review"
          diagnostics.push(findingFor(report, entry, verdict.confidence, undefined, review))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "string sites",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((candidate) => candidate.unit.name),
          }),
          drops,
        )
      },
    }
  }),
}

const findingFor = (
  report: Report,
  entry: { readonly candidate: { readonly unit: Unit; readonly file: string; readonly site: StringSite; readonly helpers: ReadonlyArray<Helper> } },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic => {
  const names = entry.candidate.helpers.slice(0, 4).map((helper) => helper.name)
  const listed = names.length <= 1 ? (names[0] ?? "a helper") : names.slice(0, -1).join(", ") + " or " + names.at(-1)
  return report({
    about: { file: entry.candidate.file, start: entry.candidate.site.start },
    messageId: "inline_derivation",
    data: {
      unit: entry.candidate.unit.name,
      snippet: entry.candidate.site.refs.join(", "),
      helpers: listed,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "inline_derivation_help",
    identity: [RULE_ID, entry.candidate.file, entry.candidate.unit.name, String(entry.candidate.site.start)].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
}
