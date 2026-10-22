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
import { readsIn } from "../sql.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import { unitFields, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/declared-staleness"

// A projection is a materialized function: it is a function of facts, it has an
// age, and it has a refresh. A projection that states none of the three has
// staleness by assumption, and the assumption lives in someone's head.
//
// The deterministic half is the shape: a read of a table, or a type whose fields
// repeat a table's columns. There is no list of names that mean "cache". Whether
// the data may be stale, and whether anything near the read says so, are two
// questions -- the second is asked because recognising a declaration by token is
// exactly the kind of hand-maintained vocabulary the classifier replaces.
export const declaredStaleness: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A projection whose allowed staleness is not declared.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    assumed:
      "`{{unit}}` is a projection, and nothing near it says how stale it may be.",
    assumed_help:
      "A projection is a materialized function. Say what it is a function of, how stale it may be, and how it is refreshed -- a TTL, a refresh call, or a policy constant beside the read. Until then, freshness is an assumption.{{unverified}}",
  }),
  plan: Effect.fn("joggle/declared-staleness")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(declaredStaleness, locator(workspace))

    // Columns by table, from the migrations the workspace already parsed.
    const columnsOf = new Map<string, Set<string>>()
    for (const file of workspace.files) {
      for (const column of file.facts.columns) {
        const found = columnsOf.get(column.table) ?? new Set<string>()
        found.add(column.column)
        columnsOf.set(column.table, found)
      }
    }

    const candidates: Array<{ unit: Unit; reads: ReadonlyArray<string> }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      const reads = readsIn(file.text)
      for (const unit of file.units) {
        if (!unit.exported) continue
        if (reads.length > 0) {
          candidates.push({ unit, reads })
          continue
        }
        // A type whose fields repeat a table's columns is a denormalised
        // structure even when nothing in this file reads it.
        if (unit.kind === "function") continue
        const fields = unitFields(unit)
        const repeated = [...columnsOf.keys()].some((table) => {
          const columns = columnsOf.get(table)
          if (columns === undefined) return false
          const shared = fields.filter((field) => columns.has(field)).length
          return shared >= policy.strata.minSharedFields
        })
        if (repeated) candidates.push({ unit, reads: [] })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no exported read of a table, and no type repeating a table's columns, was found",
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
        reason: "past the budget of " + String(policy.strata.maxCandidates) + " projections",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            projection: {
              unit: candidate.unit.name,
              kind: candidate.unit.kind,
              file: candidate.unit.file,
              reads: [...candidate.reads],
            },
            documentation: (candidate.unit.doc ?? "").slice(0, policy.evidence.maxDocChars),
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name,
            concerns: [candidate.unit.file],
            atoms: [id],
            violations: { verdict: ["allowed"] },
            decisions: {
              verdict: Decision.classify({
                instructions: {
                  question: "May this data be stale?",
                  projection: `\`atoms[${id}].projection.unit\` reads \`atoms[${id}].projection.reads\`; its documentation is \`atoms[${id}].documentation\`.`,
                  compare: [
                    `atoms[${id}].projection`,
                    `atoms[${id}].source`,
                    `atoms[${id}].documentation`,
                  ],
                  focus:
                    "Answer `allowed` when freshness is a business choice, NOT when the code is merely convenient. `must_be_current` is a decision that changes when the data is old. `not_a_projection` is a value computed at read time or not derived from stored rows.",
                },
                criteria: {
                  allowed: {
                    means: "This data may be stale; the business tolerates an age.",
                    excludes:
                      "A value a decision is made from, or anything whose reader assumes it is current.",
                  },
                  must_be_current: {
                    means: "The read must reflect current facts; staleness would change a decision.",
                    excludes: "A dashboard or summary whose age is stated.",
                  },
                  not_a_projection: {
                    means: "The value is computed at read time from current state, or is not derived data.",
                    excludes: "A stored copy that is refreshed.",
                  },
                },
              }),
              undeclared: Decision.probability({
                instructions: {
                  question: "Is this projection's staleness left undeclared?",
                  evidence: `Read \`atoms[${id}].source\` and \`atoms[${id}].documentation\`.`,
                  focus:
                    "A declaration says what the projection is a function of, how stale it may be, and how it is refreshed -- a TTL, a policy constant, a scheduler call, or a sentence beside the read. Answer true when nothing here says it.",
                },
                criteria: {
                  false: "Something here states the bound or the refresh.",
                  true: "Nothing here states the bound or the refresh.",
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
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["allowed"])
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
          if (verdict.label !== "allowed") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.unit.name,
              stage: "declined",
              reason:
                verdict.label === "must_be_current"
                  ? "declared current"
                  : "not a projection",
            })
            return
          }
          const undeclared = verdictOf(verdicts[index]?.["undeclared"], [])
          if (undeclared === undefined) {
            diagnostics.push(
              findingFor({
                report,
                entry,
                confidence: verdict.confidence,
                unverifiedReason: "the staleness declaration could not be judged",
              }),
            )
            return
          }
          if (undeclared.probability < policy.decision.gates.probabilityFloor) {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.unit.name,
              stage: "declined",
              reason: "staleness is declared",
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
            unitKind: "projections",
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
    messageId: "assumed",
    data: {
      unit: entry.candidate.unit.name,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "assumed_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
