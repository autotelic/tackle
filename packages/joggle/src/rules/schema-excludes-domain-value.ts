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
import type { Workspace } from "../workspace.ts"

const RULE_ID = "joggle/schema-excludes-domain-value"

// A wire schema that cannot hold what the domain produces.
//
// The review case: `thetaStandardError` is declared `Schema.Finite`, and the
// domain returns `Infinity` for it on purpose when a planter is unidentifiable.
// The encode is wrapped in `Effect.orDie`, so an unidentifiable planter turns a
// whole endpoint into a 500. The schema and the domain disagree about a VALUE,
// not about a type name -- `number` admits Infinity and NaN, `Schema.Finite` does
// not -- which is why the name-level drift rules cannot see it.
//
// Two facts, and neither classifies:
//
//   the schema  a `Schema.Struct` field's constructor chain, from the AST
//               (`["optionalKey", "Finite"]`)
//   the domain  a declared field of the same name, and its annotation
//
// `Finite` and `Int` excluding a value is the library's own vocabulary, like the
// `node:` builtins in `dependency-fit`; whether THIS producer yields one is the
// question.
type DomainField = {
  readonly field: string
  readonly unitName: string
  readonly file: string
  readonly annotation: string
}

export const schemaExcludesDomainValue: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A wire schema that cannot hold a value the domain produces.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    excludes:
      "`{{field}}` is `{{schema}}` in the wire schema and `{{annotation}}` in {{unit}}.",
    excludes_help:
      "A `number` admits Infinity and NaN; `{{schema}}` does not, so an encode of one dies at the boundary and takes the whole response with it. Make the schema admit what the domain produces -- a `NullOr`, a finite guard at the producer -- or make the domain produce what the schema admits.{{unverified}}",
  }),
  plan: Effect.fn("joggle/schema-excludes-domain-value")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(schemaExcludesDomainValue, locator(workspace))
    // The domain's declared fields, by name.
    const domainFields = new Map<string, Array<DomainField>>()
    for (const unit of workspace.units) {
      if (unit.kind !== "interface" && unit.kind !== "type") continue
      for (const [field, annotation] of unit.fieldTypes) {
        const declared = annotation.replace(/\s+/g, " ").trim()
        if (!declared.includes("number")) continue
        const fields = domainFields.get(field) ?? []
        fields.push({ field, unitName: unit.name, file: unit.file, annotation: declared })
        domainFields.set(field, fields)
      }
    }
    if (domainFields.size === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], ["no declared field is annotated `number`, so no schema can exclude one"]),
      }
    }

    const candidates: Array<{
      readonly field: string
      readonly schemaFile: string
      readonly chain: ReadonlyArray<string>
      readonly context: string
      readonly domain: DomainField
    }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const object of file.facts.objects) {
        if (!object.declared) continue
        for (const [field, chain] of Object.entries(object.schemas)) {
          // `Finite` and `Int` exclude a value `number` admits. The frame is the
          // library's; which value the producer yields is the question.
          if (!chain.includes("Finite") && !chain.includes("Int")) continue
          const domains = domainFields.get(field) ?? []
          const domain = domains.find((entry) => entry.file !== file.path) ?? domains[0]
          if (domain === undefined) continue
          candidates.push({
            field,
            schemaFile: file.path,
            chain,
            context: file.text.slice(object.start, Math.min(object.start + 200, object.start + 200)),
            domain,
          })
        }
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no schema field excludes a value that a domain field of the same name admits",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 12
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.field,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " schema fields",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            field: candidate.field,
            schema: { file: candidate.schemaFile, chain: [...candidate.chain], context: candidate.context },
            domain: { ...candidate.domain },
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.field + " (" + candidate.schemaFile + ")",
            concerns: [candidate.schemaFile, candidate.domain.file],
            atoms: [id],
            violations: { verdict: ["excludes"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `The wire schema declares \`atoms[${id}].field\` as \`atoms[${id}].schema.chain\` (\`atoms[${id}].schema.file\`): \`atoms[${id}].schema.context\`.`,
                  `The domain declares the same field as \`atoms[${id}].domain.annotation\` in \`atoms[${id}].domain.unitName\`.`,
                  "`number` admits Infinity and NaN; `Finite` and `Int` do not. Does the code that produces this field yield a value the schema rejects?",
                  "Answer `excludes` when the producer can yield Infinity, NaN or a fraction the schema rejects, so an encode of it dies at the boundary.",
                  "Answer `agrees` when the producer cannot: the value is guarded, computed from finite inputs, or a `number` that is always finite.",
                  "Answer `not_applicable` when the two fields are not the same value, or the schema is not the one that encodes it.",
                ].join("\n"),
                criteria: {
                  excludes: "The producer can yield a value the schema rejects.",
                  agrees: "The producer cannot; the values agree.",
                  not_applicable: "Not the same value, or not this schema.",
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
          const subject = candidate.field + " (" + candidate.schemaFile + ")"
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["excludes"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "excludes") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "agrees"
                  ? "the producer cannot yield a value the schema rejects"
                  : "not the same value",
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
            unitKind: "schema fields",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((candidate) => candidate.field),
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
    readonly candidate: {
      readonly field: string
      readonly schemaFile: string
      readonly chain: ReadonlyArray<string>
      readonly context: string
      readonly domain: DomainField
    }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: { file: entry.candidate.schemaFile, start: 0 },
    messageId: "excludes",
    data: {
      field: entry.candidate.field,
      schema: entry.candidate.chain.join(" > "),
      annotation: entry.candidate.domain.annotation,
      unit: entry.candidate.domain.unitName,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "excludes_help",
    identity: [RULE_ID, entry.candidate.schemaFile, entry.candidate.field, entry.candidate.domain.file].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
