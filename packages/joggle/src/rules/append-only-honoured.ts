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
import { queryCallsIn, type QueryCall } from "../sql.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/append-only-honoured"

// A query-builder call that may rewrite a record.
//
// The deterministic half is the call: a table, a method and the unit that makes
// it. There is deliberately no list of write verbs and no list of record-like
// table names. `update` on `ledger` and `insert` on `payroll_audit` are the same
// shape here; whether the first rewrites the past and the second extends it is
// the question, and the classifier reads the names and the call.
//
// This rule is the second law of the strata made checkable: a fact is never
// re-derived, and a record is never corrected. The repair it proposes is
// `expand`: add a supersession row, leave the original.
export const appendOnlyHonoured: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A query-builder call that rewrites a structure recording the past.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    rewritten:
      "`{{method}}` on `{{table}}` changes a row `{{caller}}` records the past in.",
    rewritten_help:
      "A record is a decision frozen at an instant. Changing it makes the past depend on today's rules: add a row that supersedes it, and leave the original alone.{{unverified}}",
  }),
  plan: Effect.fn("joggle/append-only-honoured")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(appendOnlyHonoured, locator(workspace))
    const candidates: Array<{ unit: Unit; call: QueryCall }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const call of queryCallsIn(file.text)) {
        const unit = file.units.find(
          (candidate) => call.start >= candidate.start && call.start <= candidate.end,
        )
        if (unit === undefined) continue
        candidates.push({ unit, call })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no query-builder call on a named table was found",
          ]),
      }
    }

    const judged = candidates.slice(0, policy.strata.maxCandidates)
    const overBudget: ReadonlyArray<Drop> = candidates
      .slice(policy.strata.maxCandidates)
      .map((candidate) => ({
        ruleId: RULE_ID,
        subject: candidate.call.method + " " + candidate.call.table,
        stage: "budget" as const,
        reason: "past the budget of " + String(policy.strata.maxCandidates) + " calls",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            call: {
              method: candidate.call.method,
              table: candidate.call.table,
              caller: candidate.unit.name,
              file: candidate.unit.file,
            },
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.call.method + " " + candidate.call.table,
            concerns: [candidate.unit.file],
            atoms: [id],
            violations: { verdict: ["supersede_only"] },
            decisions: {
              verdict: Decision.classify({
                instructions: {
                  question: "May this record be rewritten?",
                  call: `\`atoms[${id}].call.caller\` calls \`atoms[${id}].call.table\`.\`atoms[${id}].call.method\``,
                  compare: [
                    `atoms[${id}].call.method`,
                    `atoms[${id}].call.table`,
                    `atoms[${id}].source`,
                  ],
                  focus:
                    "Read what the call DOES to the structure. A method that adds a row is how a record grows and is honoured; a method that changes or removes an existing row rewrites the past. A status transition on a mutable work item that happens to be named like a record is `mutable`: the name was never a promise.",
                },
                criteria: {
                  supersede_only: {
                    means:
                      "The structure holds decisions frozen at an instant, and this call changes one that is already recorded.",
                    excludes:
                      "Appending a new row, and current state that is allowed to change.",
                  },
                  mutable: {
                    means: "The structure is current state, and changing it in place is the intended operation.",
                    excludes: "A recorded decision whose history a reader depends on.",
                  },
                  not_a_record: {
                    means:
                      "The structure is not append-only, or the call only adds a row rather than rewriting one.",
                    excludes: "A call that changes or removes a recorded row.",
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
          const subject = candidate.call.method + " " + candidate.call.table
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["supersede_only"])
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
          if (verdict.label !== "supersede_only") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "mutable"
                  ? "current state, allowed to change"
                  : "not a record, or the call only appends",
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
            unitKind: "queries",
            judged: judged.length,
            candidates: candidates.length,
            sample: candidates
              .slice(policy.strata.maxCandidates)
              .map((candidate) => candidate.call.method + " " + candidate.call.table),
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
}: FindingInput<{
  readonly candidate: { readonly unit: Unit; readonly call: QueryCall }
}>): Diagnostic =>
  report({
    about: { file: entry.candidate.unit.file, start: entry.candidate.call.start },
    messageId: "rewritten",
    data: {
      method: entry.candidate.call.method,
      table: entry.candidate.call.table,
      caller: entry.candidate.unit.name,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "rewritten_help",
    identity: [
      RULE_ID,
      entry.candidate.unit.file,
      entry.candidate.call.table,
      entry.candidate.call.method,
    ].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
