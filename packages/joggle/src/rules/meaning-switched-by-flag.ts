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
import { unitFields, type GuardSite, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/meaning-switched-by-flag"

// One field standing for two different things, switched by a sibling flag.
//
// From PR 1570: `total_pay` is `pay_after_swa_deduction + swa_pay_total` for SWA
// day-rate payrolls and the piece-rate columns otherwise, switched by
// `use_swa_day_rate`; the breakdown line drew one reading and the total the other.
// And PR 1568: `totalHourlyPaidHours` includes EI hours though the contract says
// it is distinct from `totalEiReportedHours`.
//
// The shape is a field whose MEANING depends on a boolean beside it, and the fix
// is a discriminated union or two named fields -- a type, not a branch.
//
// Two facts, and neither classifies:
//
//   the flag  a declared field whose annotation is `boolean`
//   the use   a guard whose test names that field, from the AST
//
// Whether the value beside the flag MEANS two things is the question. A first
// attempt would have matched field names (`use*`, `total*`) or looked for a sum;
// that is the coupling docs/rule-coupling.md audits.
type Flag = {
  readonly field: string
  readonly unitName: string
  readonly file: string
  readonly fields: ReadonlyArray<string>
}

export const meaningSwitchedByFlag: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "One field standing for two things, switched by a sibling flag.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    switched:
      "{{unit}} branches on `{{flag}}`, a boolean on {{owner}} whose fields include {{fields}}.",
    switched_help:
      "If a value's meaning depends on `{{flag}}`, it is two things wearing one name: model it as a union (or two named fields) so the reader cannot take the wrong reading. The breakdown and the total drifted apart because each was read under a different flag.{{unverified}}",
  }),
  plan: Effect.fn("joggle/meaning-switched-by-flag")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(meaningSwitchedByFlag, locator(workspace))
    // The boolean flags, by name, with the row type they sit on.
    const flags = new Map<string, Flag>()
    for (const unit of workspace.units) {
      if (unit.kind !== "interface" && unit.kind !== "type") continue
      for (const [field, annotation] of unit.fieldTypes) {
        // `fieldTypes` keeps the annotation with its colon: ": boolean".
        if (annotation.replace(/^\s*:\s*/, "").trim() !== "boolean") continue
        if (!flags.has(field)) {
          flags.set(field, { field, unitName: unit.name, file: unit.file, fields: unitFields(unit) })
        }
      }
    }
    if (flags.size === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], ["no declared field is a boolean, so there is no flag to branch on"]),
      }
    }

    const candidates: Array<{ unit: Unit; guard: GuardSite; flag: Flag }> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const guard of file.facts.guards) {
        const unit = file.units.find((entry) => guard.start >= entry.start && guard.end <= entry.end)
        if (unit === undefined) continue
        if (unit.text.length > policy.evidence.maxSourceChars) continue
        const named = guard.refs
          .map((ref) => ref.slice(ref.lastIndexOf(".") + 1))
          .map((name) => flags.get(name))
          .find((flag) => flag !== undefined)
        if (named === undefined) continue
        candidates.push({ unit, guard, flag: named })
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], ["no guard branches on a field another declaration types as a boolean"]),
      }
    }

    const budget = policy.evidence.maxMembers * 12
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " flag branches",
    }))

    const textOf = new Map(workspace.files.map((file) => [file.path, file.text]))
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const text = textOf.get(candidate.unit.file) ?? ""
          const id = yield* atoms.add({
            branch: {
              unit: candidate.unit.name,
              file: candidate.unit.file,
              guard: text.slice(candidate.guard.start, Math.min(candidate.guard.end, candidate.guard.start + 200)),
            },
            flag: { ...candidate.flag, fields: [...candidate.flag.fields] },
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + " (on " + candidate.flag.field + ")",
            concerns: [candidate.unit.file, candidate.flag.file],
            atoms: [id],
            violations: { verdict: ["meaning_switched"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].source\` branches on \`atoms[${id}].flag.field\` (\`atoms[${id}].branch.guard\`).`,
                  `That field is a \`boolean\` on \`atoms[${id}].flag.unitName\`, whose fields are \`atoms[${id}].flag.fields\`.`,
                  "Does a value's MEANING depend on the flag -- is the same field standing for two different things, one under each reading?",
                  "Answer `meaning_switched` when a sibling field means one thing when the flag is true and another when it is false, so it should be a union or two named fields.",
                  "Answer `independent` when the flag selects behaviour but no value changes meaning -- a permission, a route, a branch with its own result.",
                  "Answer `appropriate` when the flag and the value genuinely belong together as written.",
                ].join("\n"),
                criteria: {
                  meaning_switched: "One name, two meanings, switched by the flag. Model it as a union.",
                  independent: "The flag selects behaviour; no value changes meaning.",
                  appropriate: "The flag and the value belong together.",
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
          const subject = candidate.unit.name + " (on " + candidate.flag.field + ")"
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["meaning_switched"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "meaning_switched") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "independent"
                  ? "the flag selects behaviour; no value changes meaning"
                  : "the flag and the value belong together",
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
            unitKind: "flag branches",
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
    readonly candidate: { readonly unit: Unit; readonly guard: GuardSite; readonly flag: Flag }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: { file: entry.candidate.unit.file, start: entry.candidate.guard.start },
    messageId: "switched",
    data: {
      unit: entry.candidate.unit.name,
      flag: entry.candidate.flag.field,
      owner: entry.candidate.flag.unitName,
      fields: entry.candidate.flag.fields.slice(0, 8).join(", "),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "switched_help",
    identity: [RULE_ID, entry.candidate.unit.file, entry.candidate.unit.name, entry.candidate.flag.field].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
