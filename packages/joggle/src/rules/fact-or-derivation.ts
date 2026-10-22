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

const RULE_ID = "joggle/fact-or-derivation"

// One column, two possible meanings: a decision frozen at an instant, or a
// cheap recomputation of current data.
//
// `inferred-over-recorded` catches the small case in one function. This is the
// same defect at the size of a job: a call writes a column that a reader treats
// as recorded, so every change to the rules silently rewrites the past.
//
// The deterministic half is the call and the reader -- a structural shape, not
// a guess from the method name or the table's name. Which of the two meanings
// the column has belongs to the business, and the question says so.
export const factOrDerivation: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A call that recomputes a column a reader treats as a record.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    recomputed:
      "`{{caller}}` recomputes `{{table}}`, which `{{reader}}` treats as recorded.",
    recomputed_help:
      "A fact is what was decided on a date, from inputs that may since have changed; a derivation is cheap data recomputed now. If `{{table}}` records the past, stop refreshing it -- add a new row and leave the decision where it was made.{{unverified}}",
  }),
  plan: Effect.fn("joggle/fact-or-derivation")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(factOrDerivation, locator(workspace))
    // A reader is any unit that names the table. This is a candidate filter,
    // not proof: a unit may mention a table in a comment. The question is what
    // the reader DOES with the value.
    const readersOf = (table: string, writer: Unit): ReadonlyArray<Unit> =>
      workspace.units.filter(
        (unit) =>
          !(unit.file === writer.file && unit.name === writer.name) &&
          unit.text.includes(table),
      )

    const candidates: Array<{
      unit: Unit
      call: QueryCall
      readers: ReadonlyArray<Unit>
    }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const call of queryCallsIn(file.text)) {
        const unit = file.units.find(
          (candidate) => call.start >= candidate.start && call.start <= candidate.end,
        )
        if (unit === undefined) continue
        const readers = readersOf(call.table, unit).slice(0, policy.evidence.maxListedPaths)
        if (readers.length === 0) continue
        candidates.push({ unit, call, readers })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no query-builder call reaches a table another unit reads",
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
        reason: "past the budget of " + String(policy.strata.maxCandidates) + " writes",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            column: {
              table: candidate.call.table,
              method: candidate.call.method,
              writer: candidate.unit.name,
              file: candidate.unit.file,
            },
            readers: candidate.readers.map((reader) => ({
              name: reader.name,
              file: reader.file,
            })),
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + " -> " + candidate.call.table,
            concerns: [
              candidate.unit.file,
              ...candidate.readers.map((reader) => reader.file),
            ],
            atoms: [id],
            violations: { verdict: ["recomputation"] },
            decisions: {
              verdict: Decision.classify({
                instructions: {
                  question: "Is this column a decision frozen at an instant, or a cheap recomputation of current data?",
                  write: `\`atoms[${id}].column.writer\` calls \`atoms[${id}].column.table\`.\`atoms[${id}].column.method\``,
                  compare: [
                    `atoms[${id}].column`,
                    `atoms[${id}].readers`,
                    `atoms[${id}].source`,
                  ],
                  focus:
                    "The readers are the tell. A reader that reports a number for today tolerates recomputation; a reader that reproduces what was decided on a date does not. Answer `recomputation` only when the structure is supposed to be append-only. A cheap derived column that policy refreshes is `neither`: staleness is `declared-staleness`'s question, and counting it here would ask it twice.",
                },
                criteria: {
                  fact: {
                    means:
                      "The column freezes what was decided, with the inputs and authority of that instant.",
                    excludes: "A cached answer that may be recomputed from current rows.",
                  },
                  recomputation: {
                    means:
                      "The column is recomputed from current rows, though the structure is supposed to record the past; changing the rules changes the record.",
                    excludes: "A projection whose staleness is a declared business choice.",
                  },
                  neither: {
                    means:
                      "The column is not a derivation of recorded data, or it is a projection refreshed by policy.",
                    excludes: "A recomputation that silently rewrites a record.",
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
          const subject = candidate.unit.name + " -> " + candidate.call.table
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["recomputation"])
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
          if (verdict.label !== "recomputation") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason: verdict.label === "fact" ? "a frozen fact" : "not a derivation of a record",
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
            unitKind: "writes with a reader",
            judged: judged.length,
            candidates: candidates.length,
            sample: candidates
              .slice(policy.strata.maxCandidates)
              .map((candidate) => candidate.unit.name + " -> " + candidate.call.table),
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
  readonly candidate: {
    readonly unit: Unit
    readonly call: QueryCall
    readonly readers: ReadonlyArray<Unit>
  }
}>): Diagnostic =>
  report({
    about: { file: entry.candidate.unit.file, start: entry.candidate.call.start },
    messageId: "recomputed",
    data: {
      caller: entry.candidate.unit.name,
      table: entry.candidate.call.table,
      reader: entry.candidate.readers[0]?.name ?? "a reader",
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "recomputed_help",
    identity: [
      RULE_ID,
      entry.candidate.unit.file,
      entry.candidate.unit.name,
      entry.candidate.call.table,
    ].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
