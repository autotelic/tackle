import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms, type CandidateSample } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/call-pattern"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["same_orchestration"] } as const

// Two declarations that make the same calls in the same order.
//
// The one thing a body-shape comparison cannot see. `duplicate-implementation`
// hashes what a declaration LOOKS like, and a re-implementation can look nothing
// like its original while doing exactly the same things in exactly the same
// order -- validate, then save, then notify.
//
// What is deterministic is the grouping. `unit.callSignature` is the resolved
// call list, so "the same calls" is identity rather than spelling, and two
// declarations that share a signature are a candidate. Whether that shared
// sequence is ONE ORCHESTRATION written twice, or two operations that happen to
// compose the same helpers, used to be decided by the signature alone.
export const callPattern: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "Declarations that make the same calls in the same order with different bodies.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    same_calls:
      "{{names}} make the same {{count}} call(s) in the same order, written {{ways}} different ways.",
    same_calls_help:
      "One of these is the original and the rest re-implement it: {{calls}}. Compare them and keep one, or make the shared part a function the others call.{{unverified}}",
  }),
  plan: Effect.fn("joggle/call-pattern")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(callPattern, locator(workspace))
    const { minCalls, maxFindings } = policy.callPattern
    const eligible = workspace.units.filter(
      (unit) =>
        unit.calls.length >= minCalls &&
        unit.kind === "function" &&
        // A framework export cannot be merged however alike two of them are: the
        // framework calls each one by file.
        !policy.frameworkExports.some((name) => name === unit.name),
    )
    if (eligible.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no function makes " +
              minCalls +
              " or more resolved calls, so nothing had an orchestration to compare",
          ]),
      }
    }

    const groups = new Map<string, Array<Unit>>()
    for (const unit of eligible) {
      const existing = groups.get(unit.callSignature)
      if (existing === undefined) groups.set(unit.callSignature, [unit])
      else existing.push(unit)
    }

    const candidates = [...groups.entries()]
      .filter(([, units]) => units.length > 1)
      .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))
      .filter(([, units]) => units.some((unit) => scope.changed === undefined || scope.changed.has(unit.file)))
      // Bodies that are ALSO identical are `duplicate-implementation`'s finding,
      // not this one: two declarations with the same shape and the same calls are
      // one declaration written twice.
      .filter(([, units]) => new Set(units.map((unit) => unit.shapeHash)).size > 1)
      .filter(([, units]) => units[0] !== undefined)

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            eligible.length +
              " function(s) with " +
              minCalls +
              " or more resolved calls; no two share a call sequence without also sharing a body",
          ]),
      }
    }

    const judged = candidates.slice(0, maxFindings)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(maxFindings).map(([, units]) => ({
      ruleId: RULE_ID,
      subject: units.map((unit) => unit.name).join(", "),
      stage: "budget" as const,
      reason: "past the budget of " + String(maxFindings) + " groups",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(judged, ([, units]) =>
      Effect.gen(function* () {
        const first = units[0]
        if (first === undefined) return undefined
        const calls = first.calls.map(stripFile)
        // The state is the shared call sequence and a bounded sample of the
        // members, not every member's source.
        const members: ReadonlyArray<CandidateSample> = units.slice(0, 5).map((unit) => ({
          name: unit.name,
          file: unit.file,
          line: unit.location.line,
          source: unit.text.slice(0, 180),
        }))
        const id = yield* atoms.add({ calls, count: units.length, members })
        const plan: Plan<DecisionAnswers> = {
          ruleId: RULE_ID,
          subject: units.map((unit) => unit.name).join(", ") + " (" + calls.length + " calls)",
          concerns: [...new Set(units.map((unit) => unit.file))],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].members\` are ${units.length} declarations that make the same ${calls.length} calls in the same order: ${calls.join(" -> ")}.`,
                "Are they ONE orchestration written more than once -- the same work on the same inputs, so one can call another -- or do they reuse the same sequence for different purposes?",
                "Answer `same_orchestration` when they do the same work on the same inputs and one is the original the others re-implement.",
                "Answer `different_inputs` when they run the same helpers over different data, so they are two operations.",
                "Answer `different_work` when one does something the others do not, beyond the shared calls.",
                "Answer `coincidental` when they are unrelated and only the helper sequence lines up.",
              ].join("\n"),
              criteria: {
                same_orchestration: "The same work on the same inputs, in the same order. One can call another.",
                different_inputs: "Same helpers, different data. Two operations, not one.",
                different_work: "They do not do the same thing.",
                coincidental: "Unrelated declarations whose helper sequence happens to line up.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { units, first, calls, id, plan }
      }),
      { concurrency: "unbounded" },
    )

    const present = planned.filter((value): value is NonNullable<typeof value> => value !== undefined)

    return {
      plans: present.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        present.forEach((value, index) => {
          const { units } = value
          const subject = units.map((unit) => unit.name).join(", ")
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, value, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "same_orchestration") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason: "the model read them as " + (verdict.label ?? "unreadable").replace(/_/g, " "),
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
              subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          diagnostics.push(findingFor(report, value, verdict.confidence, undefined))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "groups",
            judged: maxFindings,
            candidates: candidates.length,
            sample: candidates.slice(maxFindings).map(([, units]) => units.map((unit) => unit.name).join(", ")),
          }),
          drops,
        )
      },
    }
  }),
}

const findingFor = (
  report: Report,
  value: {
    readonly units: ReadonlyArray<Unit>
    readonly first: Unit
    readonly calls: ReadonlyArray<string>
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
): Diagnostic => {
  const { units, first, calls } = value
  return report({
    about: first,
    messageId: "same_calls",
    data: {
      names: units.map((unit) => unit.name).join(", "),
      count: calls.length,
      ways: units.length,
      calls: calls.join(" -> "),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "same_calls_help",
    identity: [RULE_ID, first.callSignature].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
  })
}

/** `path/to/file.ts#name` reads better as `file:name` in a sentence. */
export function stripFile(resolved: string): string {
  const cut = resolved.lastIndexOf("#")
  if (cut === -1) return resolved
  const path = resolved.slice(0, cut)
  const name = resolved.slice(cut + 1)
  const slash = path.lastIndexOf("/")
  return (slash === -1 ? path : path.slice(slash + 1)) + ":" + name
}
