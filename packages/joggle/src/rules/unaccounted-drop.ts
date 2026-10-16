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
import { mayYield, returnTypesOf } from "../result.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/unaccounted-drop"

// A shared path that discards items and does not say so.
//
// The review case: `adaptRows` skipped rows missing a person or a date for every
// caller, but only one of four endpoints surfaced `excluded`, so three silently
// returned totals that were short. The repository names this the "fallback data"
// anti-pattern in AGENTS.md, and it is joggle's own funnel principle turned on the
// code: every bound this program hits is reported, and a path that shortens its
// input without saying so produces a number that is wrong in a way nobody can see.
//
// Two facts, and neither classifies:
//
//   the skip     a `continue`, from the AST: the loop moved on without an item
//   the boundary an EXPORTED function -- a path whose result other files read
//
// An earlier version matched adapter NAMES (`adapt`, `normalize`, a path under
// `adapters/`) and looked for the word "excluded" in the body. That decided the
// question -- is this a boundary, does it account? -- in code, coupled to one
// repository's naming (docs/rule-coupling.md). The skip is syntax, the boundary is
// the export, and whether the drop needs accounting is asked.
//
// A third fact narrows the candidates, when the type layer ran: what the function
// HANDS BACK. A path that returns a flag or nothing does not shorten the data its
// caller reads, whatever `continue` it contains. The list of non-data returns is a
// declared convention in policy, not a vocabulary in this rule.
const nonDataReturns = new Set<string>(policy.unaccountedDrop.nonDataReturns)

export const unaccountedDrop: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A shared path that discards items without saying what it discarded.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    silent_drop: "{{name}} skips items as it runs, and a caller cannot see what was skipped.",
    silent_drop_help:
      "Return what was left out -- a count, or the items -- and let the caller surface it, the way joggle's own funnel records every bound. A path that silently shortens its input produces a total that is wrong in a way nobody can see.{{unverified}}",
  }),
  plan: Effect.fn("joggle/unaccounted-drop")(function* (workspace: Workspace, scope: Scope, context: RunContext) {
    const report = reporter(unaccountedDrop, locator(workspace))
    const candidates: Array<Unit> = []
    for (const unit of workspace.units) {
      if (unit.kind !== "function" || !unit.exported) continue
      // A test helper that skips is scaffolding for an assertion, not a boundary
      // other files read: the same reason the duplicate rules keep test
      // declarations out of the candidate set.
      if (unit.test) continue
      if (unit.text.length > policy.evidence.maxSourceChars) continue
      if (scope.changed !== undefined && !inScope(scope, unit.file)) continue
      const source = workspace.files.find((file) => file.path === unit.file)
      if (source === undefined) continue
      if (!source.facts.skips.some((skip) => skip.start >= unit.start && skip.end <= unit.end)) continue
      // A `continue` in a function that returns a flag or nothing is not a funnel
      // that shortened the caller's data. Only a path that hands data back can be.
      if (!mayYield(returnTypesOf(unit, source, context.nodeTypes), nonDataReturns)) continue
      candidates.push(unit)
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no exported function skips an item with a `continue`",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 12
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((unit) => ({
      ruleId: RULE_ID,
      subject: unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " skipping paths",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (unit) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            adapter: { name: unit.name, file: unit.file },
            source: unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: unit.name + " (" + unit.file + ")",
            concerns: [unit.file],
            atoms: [id],
            violations: { verdict: ["unaccounted"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].source\` is an exported function, \`atoms[${id}].adapter.name\`, that skips some of the items it iterates (a \`continue\`).`,
                  "Does the skip go unaccounted for -- does a caller need to know how many items were left out?",
                  "Answer `unaccounted` when the skipped items are the caller's data: a total, a count or a list built from them would be silently short, so the function should return what it dropped.",
                  "Answer `accounted_elsewhere` when the caller, or another value the caller already reads, reports the exclusion.",
                  "Answer `internal_only` when the skipped items are not the caller's data -- a defensive skip of something the caller cannot observe, or a predicate the caller supplied.",
                ].join("\n"),
                criteria: {
                  unaccounted: "The caller cannot see what was dropped. Return it.",
                  accounted_elsewhere: "Something the caller reads already reports it.",
                  internal_only: "Not the caller's data.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { plan, unit }
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
          const unit = entry.unit
          const subject = unit.name + " (" + unit.file + ")"
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["unaccounted"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, unit, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "unaccounted") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "accounted_elsewhere"
                  ? "something the caller reads already reports the drop"
                  : "the skipped items are not the caller's data",
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
          diagnostics.push(findingFor(report, unit, verdict.confidence, undefined, review))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "skipping paths",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((unit) => unit.name),
          }),
          drops,
        )
      },
    }
  }),
}

const findingFor = (
  report: Report,
  unit: Unit,
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: unit,
    messageId: "silent_drop",
    data: {
      name: unit.name,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "silent_drop_help",
    identity: [RULE_ID, unit.file, unit.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
