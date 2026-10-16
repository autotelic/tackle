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

const RULE_ID = "joggle/generic-carries-a-caller"

// A shared unit that states one caller's fact.
//
// The review case: a table moved into a shared `components/Table` kept the label
// "Company total" in its footer, and the reviewer's point was the next caller --
// crew totals -- would be labelled "Company total" too. The unit is generic; the
// string inside it is one caller's.
//
// Two facts, and neither classifies:
//
//   the literal  a string literal, from the AST, with the unit it sits in
//   the sharing  an EXPORTED unit that two or more files call, from the graph
//
// An earlier instinct was to match the literal against route names or to decide
// whether the path is "generic". Both are the fault docs/rule-coupling.md audits:
// a literal that names a caller is a judgement about MEANING, and where a fact
// belongs is `parameter` -- the review's own words, "pass the label in". The
// literal is syntax, the sharing is the graph, and whether it names a caller is
// asked.
//
// The literal filter is broad on purpose, so it admits tokens that are not copy
// at all ('utf8', a format string). Tightening it would re-import the
// caller-naming vocabulary this rule gave up, so the fix is not a filter: a
// repository that runs without a model sets `onUnavailable: "propagate"` (see
// src/config.ts) and the unjudged candidates leave the report.
type Caller = { readonly file: string }

export const genericCarriesACaller: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A shared unit that states one caller's fact.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    caller_fact:
      '{{unit}} writes "{{value}}" though {{count}} file(s) use it.',
    caller_fact_help:
      "Pass it in. A unit two callers share cannot know one caller's label, route or copy: the next caller gets the first caller's words, and the fix is a parameter rather than a second literal.{{unverified}}",
  }),
  plan: Effect.fn("joggle/generic-carries-a-caller")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(genericCarriesACaller, locator(workspace))
    // Who uses a unit: the files that CALL it and the files that RENDER it. A
    // JSX component is rendered, not called, so a graph built from calls alone
    // would miss exactly the review case -- a shared `<YearColumns>` footer.
    const callerFiles = new Map<string, Set<string>>()
    const addCaller = (key: string, file: string): void => {
      const files = callerFiles.get(key) ?? new Set<string>()
      files.add(file)
      callerFiles.set(key, files)
    }
    for (const unit of workspace.units) {
      for (const call of unit.calls) addCaller(call, unit.file)
    }
    for (const file of workspace.files) {
      for (const name of file.facts.jsx) addCaller(name, file.path)
    }

    const candidates: Array<{ unit: Unit; value: string; start: number; callers: ReadonlyArray<Caller> }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const unit of file.units) {
        if (!unit.exported) continue
        if (unit.text.length > policy.evidence.maxSourceChars) continue
        const byIdentity = callerFiles.get(unit.file + "#" + unit.name) ?? new Set<string>()
        const byName = callerFiles.get(unit.name) ?? new Set<string>()
        const callers = [...new Set([...byIdentity, ...byName])].filter((caller) => caller !== unit.file)
        if (callers.length < 2) continue
        const inside = file.facts.literals.filter(
          (literal) =>
            literal.start >= unit.start &&
            literal.end <= unit.end &&
            // A word, not a path or a symbol: the shape of a piece of copy.
            literal.value.length >= 4 &&
            literal.value.split("").some((character) => character >= "a" && character <= "z"),
        )
        for (const literal of inside.slice(0, 3)) {
          candidates.push({
            unit,
            value: literal.value,
            start: literal.start,
            callers: callers.slice(0, policy.evidence.maxMembers).map((caller) => ({ file: caller })),
          })
        }
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no shared unit writes a string while two or more files depend on it",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 12
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " shared literals",
    }))

    const textOf = new Map(workspace.files.map((file) => [file.path, file.text]))
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const text = textOf.get(candidate.unit.file) ?? ""
          const id = yield* atoms.add({
            literal: {
              value: candidate.value,
              unit: candidate.unit.name,
              file: candidate.unit.file,
              context: text.slice(Math.max(0, candidate.start - 60), candidate.start + 90),
            },
            callers: [...candidate.callers],
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + ' ("' + candidate.value + '")',
            concerns: [candidate.unit.file, ...candidate.callers.map((caller) => caller.file)],
            atoms: [id],
            violations: { verdict: ["names_a_caller"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].source\` is the body of \`atoms[${id}].literal.unit\`, which ${candidate.callers.length} files call.`,
                  `It writes the string \`atoms[${id}].literal.value\`, in this context: \`atoms[${id}].literal.context\`.`,
                  "Is that string one caller's fact, which belongs to the caller as a parameter?",
                  "Answer `names_a_caller` when the string is a label, a route, a heading or copy that belongs to one of the callers and would be wrong for another.",
                  "Answer `general` when the string is the unit's own -- a generic message, a separator, a key -- and every caller means the same thing by it.",
                  "Answer `shared_vocabulary` when the string is a constant the whole codebase shares, so it does not vary by caller.",
                ].join("\n"),
                criteria: {
                  names_a_caller: "One caller's words. Pass them in.",
                  general: "The unit's own words; every caller means the same.",
                  shared_vocabulary: "A codebase-wide constant.",
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
          const subject = candidate.unit.name + ' ("' + candidate.value + '")'
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["names_a_caller"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "names_a_caller") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "shared_vocabulary"
                  ? "a codebase-wide constant"
                  : "the unit's own words",
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
          diagnostics.push(findingFor(report, entry, verdict.confidence, undefined, review))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "shared literals",
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
    readonly candidate: {
      readonly unit: Unit
      readonly value: string
      readonly start: number
      readonly callers: ReadonlyArray<Caller>
    }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: { file: entry.candidate.unit.file, start: entry.candidate.start },
    messageId: "caller_fact",
    data: {
      unit: entry.candidate.unit.name,
      value: entry.candidate.value,
      count: entry.candidate.callers.length,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "caller_fact_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name, entry.candidate.value].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
