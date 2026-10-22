import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type FindingInput } from "../reporting.ts"
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
import { unitFields, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/deviation-has-a-shape"

/** Whether a field's annotation admits an absent value. */
const admitsAbsence = (annotation: string): boolean =>
  annotation.includes("null") || annotation.includes("undefined")

/** Whether a declared field is optional (`name?:`), which is absence by another spelling. */
const optionalIn = (unit: Unit, field: string): boolean => unit.text.includes(field + "?:")

/**
 * The shape a deviation leaves behind: a boolean that gates nullable siblings,
 * or a cluster of fields that can each be absent.
 *
 * Those are structural facts, not names. Which of them is a deliberate override
 * and which is a state of the world is the question; the field names go into the
 * panel and the classifier reads them, rather than a suffix list deciding that
 * `_override` means deviation and `ended_at` does not.
 */
export const deviationHasAConcept: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A type that encodes a deviation as flags or a cluster of absent fields.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    conceptless:
      "`{{name}}` encodes a deviation as a flag or a cluster of absent fields.",
    conceptless_help:
      "A deviation is a choice that contradicts a rule on purpose, so it needs an authority, an instant, a reason and a link to what it contradicted. A boolean gating nullable siblings, or a set of fields that are only sometimes present, is that concept deciding not to be one.{{unverified}}",
  }),
  plan: Effect.fn("joggle/deviation-has-a-shape")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(deviationHasAConcept, locator(workspace))
    const candidates: Array<{
      unit: Unit
      flags: ReadonlyArray<string>
      absent: ReadonlyArray<string>
    }> = []

    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const unit of file.units) {
        if (unit.kind === "function") continue
        const flags = unitFields(unit).filter(
          (field) => unit.fieldTypes.get(field)?.trim() === "boolean",
        )
        const absent = unitFields(unit).filter((field) => {
          const annotation = unit.fieldTypes.get(field) ?? ""
          return admitsAbsence(annotation) || optionalIn(unit, field)
        })
        const deviates = (flags.length > 0 && absent.length > 0) || absent.length >= 2
        if (!deviates) continue
        candidates.push({
          unit,
          flags: flags.slice(0, policy.evidence.maxMembers),
          absent: absent.slice(0, policy.evidence.maxMembers),
        })
      }
      // A `Schema.Struct` declaration is one object literal in the facts. Its
      // boolean fields and nullable keys are the same shape as a type's.
      for (const object of file.facts.objects) {
        if (!object.declared) continue
        const flags = object.keys.filter((key) => object.schemas[key]?.includes("Boolean") === true)
        const absent = object.nullable
        const deviates = (flags.length > 0 && absent.length > 0) || absent.length >= 2
        if (!deviates) continue
        const unit = file.units.find(
          (candidate) => object.start >= candidate.start && object.start <= candidate.end,
        )
        if (unit === undefined || unit.kind === "function") continue
        if (
          candidates.some(
            (candidate) => candidate.unit.file === unit.file && candidate.unit.name === unit.name,
          )
        ) {
          continue
        }
        candidates.push({
          unit,
          flags: flags.slice(0, policy.evidence.maxMembers),
          absent: absent.slice(0, policy.evidence.maxMembers),
        })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no type carries a boolean beside absent fields, and no type has a cluster of absent fields",
          ]),
      }
    }

    const judged = candidates.slice(0, policy.strata.maxCandidates)
    const overBudget: ReadonlyArray<Drop> = candidates
      .slice(policy.strata.maxCandidates)
      .map((candidate) => ({
        ruleId: RULE_ID,
        subject: candidate.unit.name,
        stage: "budget" as const,
        reason: "past the budget of " + String(policy.strata.maxCandidates) + " shapes",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            declaration: {
              name: candidate.unit.name,
              kind: candidate.unit.kind,
              file: candidate.unit.file,
              flags: [...candidate.flags],
              absent: [...candidate.absent],
              fields: unitFields(candidate.unit)
                .slice(0, policy.evidence.maxMembers)
                .map((field) => ({
                  name: field,
                  type: candidate.unit.fieldTypes.get(field) ?? "",
                })),
            },
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name,
            concerns: [candidate.unit.file],
            atoms: [id],
            violations: { verdict: ["deviation"] },
            decisions: {
              verdict: Decision.classify({
                instructions: {
                  question: "Is this a decision that contradicts a rule, or a state of the world?",
                  declaration: `\`atoms[${id}].declaration.flags\` gate \`atoms[${id}].shape.absent\` on \`atoms[${id}].shape.fields\`.`,
                  compare: [
                    `atoms[${id}].declaration`,
                    `atoms[${id}].source`,
                  ],
                  focus:
                    "`deviation` means an override, approval, dispute or exception that intentionally contradicts a rule. `state` means the fields describe the world -- an end date that may not have happened, an optional note. `neither` means this is not a classification at all. Where plumb reports the boolean shape, this reports whether the concept behind it is missing.",
                },
                criteria: {
                  deviation: {
                    means:
                      "A choice that contradicts a rule on purpose, currently encoded as flags or a cluster of sometimes-present fields.",
                    excludes: "Ordinary optionality that describes the world.",
                  },
                  state: {
                    means:
                      "The absent fields and flags describe states of the world, each with one meaning.",
                    excludes: "An override that needs an authority and a reason.",
                  },
                  neither: {
                    means: "The shape is not a deviation and not a state classification.",
                    excludes: "An override cluster.",
                  },
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
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["deviation"])
          if (verdict === undefined) {
            diagnostics.push(
              findingFor({
                report,
                entry,
                confidence: undefined,
                unverifiedReason: "no judgement was available",
              }),
            )
            return
          }
          if (verdict.label !== "deviation") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.unit.name,
              stage: "declined",
              reason: verdict.label === "state" ? "a state of the world" : "neither shape",
            })
            return
          }
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.unit.name,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          diagnostics.push(
            findingFor({
              report,
              entry,
              confidence: verdict.confidence,
              unverifiedReason: undefined,
              review: quality.quality === "review",
            }),
          )
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "deviation shapes",
            judged: judged.length,
            candidates: candidates.length,
            sample: candidates
              .slice(policy.strata.maxCandidates)
              .map((candidate) => candidate.unit.name),
          }),
          drops,
        )
      },
    }
  }),
}

const findingFor = ({
  report,
  entry,
  confidence,
  unverifiedReason,
  review = false,
}: FindingInput<{ readonly candidate: { readonly unit: Unit } }>): Diagnostic =>
  report({
    about: entry.candidate.unit,
    messageId: "conceptless",
    data: {
      name: entry.candidate.unit.name,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "conceptless_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
