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

const RULE_ID = "joggle/unbounded-default-read"

// A data read whose default path has no bound.
//
// From PR 1574: `/finance/payroll-review` with no params called the loader with
// no project and no date predicate -- every approved payroll row ever, aggregated
// in memory. Measured fine at the time (1 tenant, 9 months, 3.3k rows, ~150ms) but
// linear, so ~1.5s and 36.6MB at 16x. The finding is not "this is slow", it is
// "the default path grows every season and nothing bounds it".
//
// Three facts, and none classifies:
//
//   the call      a call to a function whose every filter is optional, with the
//                 argument keys it passes (`facts.callSites`)
//   the callee    resolved to its declaration, whose parameters are all optional
//   the access    the declaring file imports a data package
//
// `isDataPackage` is a framework vocabulary, like the `node:` builtins in
// `dependency-fit` -- what a database client is called, not what this repository
// calls things. Whether the read is unbounded is the question.
const isDataPackage = (specifier: string): boolean =>
  specifier === "knex" ||
  specifier.startsWith("knex/") ||
  specifier.startsWith("drizzle-orm") ||
  specifier.startsWith("@prisma/") ||
  specifier === "prisma" ||
  specifier === "pg" ||
  specifier.startsWith("postgres") ||
  specifier.startsWith("mysql") ||
  specifier.startsWith("mongodb") ||
  specifier.startsWith("better-sqlite3") ||
  specifier.startsWith("kysely") ||
  specifier.startsWith("slonik")

export const unboundedDefaultRead: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A data read whose default path has no bound.",
  judged: true,
  onUnavailable: "report",
  messages: messages({
    unbounded:
      "{{caller}} calls `{{callee}}` -- every filter optional -- passing {{args}}.",
    unbounded_help:
      "A default that passes no bound reads every row that ever accrued and will grow every season. Open on a window (a season, a recent range), or push the read into the database with a predicate, so the cheap path is the bounded one.{{unverified}}",
  }),
  plan: Effect.fn("joggle/unbounded-default-read")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(unboundedDefaultRead, locator(workspace))
    const dataFiles = new Set<string>()
    for (const file of workspace.files) {
      if (file.importStatements.some((entry) => isDataPackage(entry.specifier))) dataFiles.add(file.path)
    }
    const byIdentity = new Map<string, Unit>()
    for (const unit of workspace.units) byIdentity.set(unit.file + "#" + unit.name, unit)
    // The fact list, by identity: a function whose every filter is optional.
    const allOptional = new Set<string>()
    for (const file of workspace.files) {
      for (const name of file.facts.allOptionalFunctions) allOptional.add(file.path + "#" + name)
    }
    const textOf = new Map(workspace.files.map((file) => [file.path, file.text]))

    const candidates: Array<{ unit: Unit; start: number; callee: Unit; argumentKeys: ReadonlyArray<string>; argumentCount: number }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const unit of file.units) {
        // The pairing only holds when every call has its span, the same guard
        // `reimplemented-primitive` uses.
        if (file.facts.callSites.length !== unit.calls.length) continue
        file.facts.callSites.forEach((site, index) => {
          const identity = unit.calls[index]
          if (identity === undefined) return
          const callee = byIdentity.get(identity)
          if (callee === undefined || !allOptional.has(identity)) return
          if (!dataFiles.has(callee.file)) return
          candidates.push({
            unit,
            start: site.start,
            callee,
            argumentKeys: site.argumentKeys,
            argumentCount: site.argumentCount,
          })
        })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no call reaches a data-access function whose every filter is optional",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 12
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " reads",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const text = textOf.get(candidate.unit.file) ?? ""
          const id = yield* atoms.add({
            call: {
              caller: candidate.unit.name,
              file: candidate.unit.file,
              call: text.slice(candidate.start, Math.min(candidate.start + 160, text.length)),
            },
            callee: { name: candidate.callee.name, file: candidate.callee.file },
            arguments: [...candidate.argumentKeys],
            source: candidate.callee.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + " -> " + candidate.callee.name,
            concerns: [candidate.unit.file, candidate.callee.file],
            atoms: [id],
            violations: { verdict: ["unbounded"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].call.caller\` calls \`atoms[${id}].callee.name\` here: \`atoms[${id}].call.call\`.`,
                  `The callee's every filter is optional (\`atoms[${id}].source\`), and the call sets \`atoms[${id}].arguments\`.`,
                  "Does the default path leave the read unbounded over a table that grows?",
                  "Answer `unbounded` when the call passes no window, no limit and no required scope, so it reads every row that has accrued and will read more each period.",
                  "Answer `bounded` when something bounds it: a caller-supplied scope that is always set, a limit, a date default, or a table that does not grow.",
                  "Answer `not_applicable` when the callee is not a data read, or the arguments passed are already a bound.",
                ].join("\n"),
                criteria: {
                  unbounded: "No window, no limit, no required scope. It grows.",
                  bounded: "Something bounds it.",
                  not_applicable: "Not a data read, or already bounded.",
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
          const subject = candidate.unit.name + " -> " + candidate.callee.name
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["unbounded"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "unbounded") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "bounded" ? "something bounds the read" : "not a data read",
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
            unitKind: "reads",
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
      readonly start: number
      readonly callee: Unit
      readonly argumentKeys: ReadonlyArray<string>
      readonly argumentCount: number
    }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic => {
  const passed =
    entry.candidate.argumentCount === 0
      ? "no arguments"
      : entry.candidate.argumentKeys.length === 0
        ? "an object"
        : entry.candidate.argumentKeys.join(", ")
  return report({
    about: { file: entry.candidate.unit.file, start: entry.candidate.start },
    messageId: "unbounded",
    data: {
      caller: entry.candidate.unit.name,
      callee: entry.candidate.callee.name,
      args: passed,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "unbounded_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name, entry.candidate.callee.file, entry.candidate.callee.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
}
