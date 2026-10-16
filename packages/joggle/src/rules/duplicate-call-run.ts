import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
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
import { stripFile } from "./call-pattern.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/duplicate-call-run"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["shared_helper"] } as const

// A run of calls one declaration shares with another, without sharing the whole
// sequence.
//
// `call-pattern` compares the WHOLE sequence. But when the shared run is the body
// of a helper that already exists, the longer function has inlined it and should
// call it instead. That is the case a whole-sequence comparison cannot see, and it
// is how a shared filter, validation or query chain gets copied into a second
// call site.
//
// What is deterministic is the run. Calls are resolved, so "the same call" is
// identity, and the run is extended left and right from a shared n-gram so the
// candidate names the longest one. Whether that run is a helper somebody inlined
// -- or a common idiom both functions happen to perform -- is the question.
export const duplicateCallRun: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A run of calls one declaration shares with another, without the whole sequence.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    shared_run:
      "{{left}} and {{right}} share {{count}} call(s) in the same order, but are not the same function.",
    shared_run_help:
      "A shared run this long is a helper one of them has inlined: {{steps}}. If it is one thing, make it a function and call it from both.{{unverified}}",
  }),
  plan: Effect.fn("joggle/duplicate-call-run")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(duplicateCallRun, locator(workspace))
    const { minCalls, maxFindings } = policy.duplicateCallRun
    const eligible = workspace.units.filter(
      (unit) =>
        unit.kind === "function" &&
        unit.calls.length >= minCalls &&
        !policy.frameworkExports.some((name) => name === unit.name),
    )
    if (eligible.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no function makes " + minCalls + " or more resolved calls, so nothing had a run to share",
          ]),
      }
    }

    // Every function is indexed by each run of `minCalls` calls it contains, so
    // two functions that share a run meet at that run.
    const grams = new Map<string, Array<{ unit: Unit; start: number }>>()
    for (const unit of eligible) {
      for (let start = 0; start + minCalls <= unit.calls.length; start += 1) {
        const key = unit.calls.slice(start, start + minCalls).join("\u0000")
        const list = grams.get(key) ?? []
        list.push({ unit, start })
        grams.set(key, list)
      }
    }

    const runs = new Map<string, { left: Unit; right: Unit; length: number; start: number; rightStart: number }>()
    for (const list of grams.values()) {
      const bounded = list.slice(0, 50)
      for (let one = 0; one < bounded.length; one += 1) {
        for (let two = one + 1; two < bounded.length; two += 1) {
          const a = bounded[one]
          const b = bounded[two]
          if (a === undefined || b === undefined) continue
          if (a.unit.file === b.unit.file) continue
          // The whole sequence matching is `call-pattern`'s finding.
          if (a.unit.callSignature === b.unit.callSignature) continue
          let left = 0
          while (
            a.start - left - 1 >= 0 &&
            b.start - left - 1 >= 0 &&
            a.unit.calls[a.start - left - 1] === b.unit.calls[b.start - left - 1]
          ) {
            left += 1
          }
          let right = minCalls
          while (
            a.start + right < a.unit.calls.length &&
            b.start + right < b.unit.calls.length &&
            a.unit.calls[a.start + right] === b.unit.calls[b.start + right]
          ) {
            right += 1
          }
          const length = left + right
          if (length < minCalls) continue
          const start = a.start - left
          const key = [a.unit.file, a.unit.name, b.unit.file, b.unit.name]
            .sort((one_, two_) => one_.localeCompare(two_))
            .join("\u0000")
          const existing = runs.get(key)
          if (existing === undefined || length > existing.length) {
            runs.set(key, { left: a.unit, right: b.unit, length, start, rightStart: b.start - left })
          }
        }
      }
    }

    const reported = [...runs.values()]
      .filter(
        (run) =>
          scope.changed === undefined ||
          scope.changed.has(run.left.file) ||
          scope.changed.has(run.right.file),
      )
      .sort(
        (one_, two_) =>
          two_.length - one_.length ||
          one_.left.file.localeCompare(two_.left.file) ||
          one_.left.name.localeCompare(two_.left.name),
      )

    if (reported.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            eligible.length +
              " function(s) with " +
              minCalls +
              " or more resolved calls; no two share a run without sharing the whole sequence",
          ]),
      }
    }

    const judged = reported.slice(0, maxFindings)
    const overBudget: ReadonlyArray<Drop> = reported.slice(maxFindings).map((run) => ({
      ruleId: RULE_ID,
      subject: run.left.name + " / " + run.right.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(maxFindings) + " runs",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(judged, (run) =>
      Effect.gen(function* () {
        const steps = run.left.calls.slice(run.start, run.start + run.length).map(stripFile)
        // The state is the shared run and what each side does immediately around
        // it, which is what separates "a helper somebody inlined" from "a common
        // idiom both perform".
        const before = run.left.calls.slice(0, run.start).map(stripFile)
        const leftAfter = run.left.calls.slice(run.start + run.length).map(stripFile)
        const rightAfter = run.right.calls.slice(run.rightStart + run.length).map(stripFile)
        const id = yield* atoms.add({
          left: { name: run.left.name, file: run.left.file, line: run.left.location.line },
          right: { name: run.right.name, file: run.right.file, line: run.right.location.line },
          steps,
          before,
          leftAfter,
          rightAfter,
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: RULE_ID,
          subject: run.left.name + " / " + run.right.name,
          concerns: [run.left.file, run.right.file],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].left\` (${run.left.name}) and \`atoms[${id}].right\` (${run.right.name}) share ${run.length} calls in the same order: ${steps.join(" -> ")}.`,
                `\`atoms[${id}].before\` runs before the shared run on the left; \`atoms[${id}].leftAfter\` and \`atoms[${id}].rightAfter\` run after it on each side.`,
                "Is that shared run ONE THING that should be a function both call, or a common sequence the two perform for their own reasons?",
                "Answer `shared_helper` when the run is a self-contained step one of them has inlined, so both should call one function for it.",
                "Answer `common_idiom` when the run is a recurring sequence -- logging, auth, a standard query chain -- that both perform as part of their own work.",
                "Answer `coincidental` when the two sequences only line up by chance.",
              ].join("\n"),
              criteria: {
                shared_helper: "A self-contained step. Extract it and call it from both.",
                common_idiom: "A recurring sequence each performs for its own reasons. Not a helper.",
                coincidental: "The calls line up by chance.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { run, steps, id, plan }
      }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((value, index) => {
          const { run } = value
          const subject = run.left.name + " / " + run.right.name
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, value, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "shared_helper") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "common_idiom"
                  ? "the shared run is a common idiom, not a helper"
                  : "the two sequences line up by chance",
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
            unitKind: "runs",
            judged: maxFindings,
            candidates: reported.length,
            sample: reported.slice(maxFindings).map((run) => run.left.name + "/" + run.right.name),
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
    readonly run: {
      readonly left: Unit
      readonly right: Unit
      readonly length: number
      readonly start: number
      readonly rightStart: number
    }
    readonly steps: ReadonlyArray<string>
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
): Diagnostic => {
  const { run, steps } = value
  return report({
    about: run.left,
    messageId: "shared_run",
    data: {
      left: run.left.name,
      right: run.right.name,
      count: run.length,
      steps: steps.join(" -> "),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "shared_run_help",
    identity: [RULE_ID, run.left.file, run.left.name, run.right.file, run.right.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
  })
}
