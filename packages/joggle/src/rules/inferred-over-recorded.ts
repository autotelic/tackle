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
  type Scope,
} from "../rule.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/inferred-over-recorded"

// A fact the code derives that a field already records.
//
// From PR 1570: the mode is inferred from the sums, but the payroll already
// records `use_swa_day_rate` -- "could we pass that through and make this
// deterministic?". The derivation is a second source of truth, and the two
// disagree the moment one changes.
//
// Three facts, and none classifies:
//
//   the comparison  an AST `BinaryExpression` with a comparison operator -- a
//                   language construct, and the unit returns
//   the row         a type the unit names, from `typeRefs`
//   the record      a `boolean` field on that type that the unit does not read
//
// Whether the computation RECONSTRUCTS the recorded field is the question.
//
// An earlier shape asked the CHECKER whether the returned expression is a
// boolean. Neither type layer answers that: the node-type layer resolves the
// token at a position (hover), so a binary expression's offset answers its left
// operand, and the declaration trace carries interfaces and aliases rather than
// function signatures. A comparison is a language construct read from the AST,
// not a repository idiom, so it is a fact -- the same standing as a guard shape.
const declaredOf = (annotation: string): string =>
  annotation.replace(/^\s*:\s*/, "").replace(/\s+/g, " ").trim()

export const inferredOverRecorded: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A value the code derives that a field already records.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    inferred:
      "{{unit}} derives a boolean though `{{type}}` records one in `{{flag}}`.",
    inferred_help:
      "Read `{{flag}}` instead of deriving it. Two sources of truth for one fact drift: the recorded field is written when the row is saved and the derivation is computed when it is read, and the first time they disagree nobody can tell which is right.{{unverified}}",
  }),
  plan: Effect.fn("joggle/inferred-over-recorded")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(inferredOverRecorded, locator(workspace))
    // The boolean fields, by the type that declares them.
    const booleanFields = new Map<string, Array<string>>()
    const unitOfType = new Map<string, Unit>()
    for (const unit of workspace.units) {
      if (unit.kind !== "interface" && unit.kind !== "type") continue
      for (const [field, annotation] of unit.fieldTypes) {
        if (declaredOf(annotation) !== "boolean") continue
        const fields = booleanFields.get(unit.name) ?? []
        fields.push(field)
        booleanFields.set(unit.name, fields)
        unitOfType.set(unit.name, unit)
      }
    }

    const candidates: Array<{ unit: Unit; type: string; flag: string; start: number }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const unit of file.units) {
        if (unit.kind !== "function") continue
        if (unit.text.length > policy.evidence.maxSourceChars) continue
        // The comparison must be the value the unit RETURNS. A function that
        // merely contains a comparison and then hands back a list or a number
        // derives no boolean; `scriptsFrom`, `readIgnoreFile` and
        // `timeoutMilliseconds` each did, and each was a false candidate.
        const returnsTheComparison = file.facts.returns.some(
          (returned) =>
            returned.start >= unit.start &&
            returned.end <= unit.end &&
            file.facts.comparisons.some(
              (comparison) => comparison.start >= returned.start && comparison.end <= returned.end,
            ),
        )
        if (!returnsTheComparison) continue
        for (const type of new Set(unit.typeRefs)) {
          const fields = booleanFields.get(type)
          if (fields === undefined) continue
          // A flag the unit already reads is not being inferred; it is being read.
          const flag = fields.find((field) => !unit.text.includes(field))
          if (flag === undefined) continue
          candidates.push({ unit, type, flag, start: unit.start })
          break
        }
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no unit returns a boolean while naming a type that records one it does not read",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 12
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " derivations",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            derivation: { unit: candidate.unit.name, file: candidate.unit.file },
            recorded: {
              type: candidate.type,
              flag: candidate.flag,
              owner: unitOfType.get(candidate.type)?.file ?? candidate.unit.file,
            },
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + " (derives " + candidate.flag + "?)",
            concerns: [candidate.unit.file, unitOfType.get(candidate.type)?.file ?? candidate.unit.file],
            atoms: [id],
            violations: { verdict: ["inferred"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].source\` computes a boolean and returns it. \`atoms[${id}].recorded.type\` records a boolean \`atoms[${id}].recorded.flag\` that this unit does not read.`,
                  "Does the computation reconstruct the recorded field -- the same fact derived a second way?",
                  "Answer `inferred` when the returned boolean IS what the field records, so the derivation is a second source of truth for one fact.",
                  "Answer `independent` when the returned boolean is a different question from the recorded one, even if the two often agree.",
                  "Answer `not_applicable` when the type is not the row this unit reads, or the field is unrelated.",
                ].join("\n"),
                criteria: {
                  inferred: "The same fact, derived a second time. Read the field.",
                  independent: "A different question that often agrees.",
                  not_applicable: "Not the same row or the same fact.",
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
          const subject = candidate.unit.name + " (derives " + candidate.flag + "?)"
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["inferred"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "inferred") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "independent" ? "a different question" : "not the same row or fact",
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
          diagnostics.push(findingFor(report, entry, verdict.confidence, undefined, quality.quality === "review"))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "derivations",
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
  entry: {
    readonly candidate: { readonly unit: Unit; readonly type: string; readonly flag: string; readonly start: number }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: entry.candidate.unit,
    messageId: "inferred",
    data: {
      unit: entry.candidate.unit.name,
      type: entry.candidate.type,
      flag: entry.candidate.flag,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "inferred_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name, entry.candidate.type, entry.candidate.flag].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
