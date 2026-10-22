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
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/invariant-has-a-reconciler"

// An exported check over stored rows, and no repair path beside it.
//
// The deterministic half is structural: an exported function, a table read, and
// enough body to be a check rather than a getter. There is no list of words that
// mean "invariant" -- `sum`, `balance` and `reconcile` are the property names of
// one repository, and the point of the rule is to find the checks whose names
// nobody thought to make memorable.
//
// A domain package of pure functions offers LOCAL correctness. An invariant that
// spans rows and time cannot be parsed into existence at a boundary; it is
// detected, repaired, and the residual reported. `detect_only` is the finding.
export const invariantHasAReconciler: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "An exported check over stored rows with no repair path.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    detectOnly:
      "`{{unit}}` can tell that `{{tables}}` violates an invariant, and nothing restores it.",
    detectOnly_help:
      "An invariant that spans rows and time cannot be parsed into existence at a boundary. Declare it once, detect it, and name the path that repairs it -- or say that the repair is a human decision, which is a path with an authority.{{unverified}}",
  }),
  plan: Effect.fn("joggle/invariant-has-a-reconciler")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(invariantHasAReconciler, locator(workspace))
    const candidates: Array<{ unit: Unit; tables: ReadonlyArray<string> }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      const tables = readsIn(file.text)
      if (tables.length === 0) continue
      for (const unit of file.units) {
        if (!unit.exported || unit.kind !== "function") continue
        // A getter is not an invariant: it has no body to check anything with.
        if (unit.tokens.length < policy.strata.minInvariantTokens) continue
        candidates.push({ unit, tables })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no exported function over stored rows was found",
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
        reason: "past the budget of " + String(policy.strata.maxCandidates) + " checks",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            check: {
              unit: candidate.unit.name,
              file: candidate.unit.file,
              tables: [...candidate.tables],
            },
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name,
            concerns: [candidate.unit.file],
            atoms: [id],
            violations: { verdict: ["detect_only"] },
            decisions: {
              verdict: Decision.classify({
                instructions: {
                  question: "If stored data violates this, what restores it?",
                  check: `\`atoms[${id}].check.unit\` reads \`atoms[${id}].check.tables\`.`,
                  compare: [
                    `atoms[${id}].check`,
                    `atoms[${id}].source`,
                  ],
                  focus:
                    "Read what the function DOES with the rows. A predicate that returns a report is `detect_only`; a function that also writes a correction, emits a repair command, or names the human authority who decides is `repair_path`. A validation that must stay manual because repair needs a person's decision is `repair_path` too: naming that authority IS the path. `not_an_invariant` is a read that checks nothing that spans rows or time.",
                },
                criteria: {
                  repair_path: {
                    means:
                      "Something restores the invariant: a repair write, a reconciliation job, or a named human authority who decides.",
                    excludes: "A check that only reports the violation.",
                  },
                  detect_only: {
                    means:
                      "The code can see that the books do not balance and can do nothing about it.",
                    excludes: "A repair path, including one that ends at a person.",
                  },
                  not_an_invariant: {
                    means: "The function is a read or a projection, not a property over rows and time.",
                    excludes: "A check whose violation has a defined repair.",
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
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["detect_only"])
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
          if (verdict.label !== "detect_only") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.unit.name,
              stage: "declined",
              reason:
                verdict.label === "repair_path"
                  ? "a repair path exists"
                  : "not an invariant",
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
            unitKind: "checks",
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
}: FindingInput<{ readonly candidate: { readonly unit: Unit; readonly tables: ReadonlyArray<string> } }>): Diagnostic =>
  report({
    about: entry.candidate.unit,
    messageId: "detectOnly",
    data: {
      unit: entry.candidate.unit.name,
      tables: entry.candidate.tables.join(", "),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "detectOnly_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
