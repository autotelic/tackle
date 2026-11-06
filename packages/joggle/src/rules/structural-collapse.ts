import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, shortType, type Reporter } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  inScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/structural-collapse"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["one_concept"] } as const

// Two names, one type, and the compiler said so.
//
// `one-concept-one-type` starts from a NAME and asks whether its meanings
// diverged. This is the other direction: the checker proved two declarations are
// mutually assignable and share a member-sorted fingerprint, so the drift is in
// the VOCABULARY -- one concept carrying two names -- and no text comparison can
// see it. `User` and `Account` with the same members read as two things.
//
// The PROOF is the compiler's and is not asked about. The judgment is the one the
// proof cannot make: two names for one idea, or two ideas that happen to share a
// shape today? A group is only formed when the fingerprint has content (a group
// of every `any` is not a concept) and assignability holds both ways.

/** The kinds whose resolved type is a shape rather than a value. */
const isTypeLike = (unit: Unit): boolean =>
  unit.kind === "interface" || unit.kind === "type" || unit.kind === "class" || unit.kind === "enum"

/** The names of a group, in a stable order. */
const namesOf = (units: ReadonlyArray<Unit>): ReadonlyArray<string> =>
  [...new Set(units.map((unit) => unit.name))].sort((left, right) => left.localeCompare(right))

/** A resolved type, cut to the length a finding's help can carry. */
export const structuralCollapse: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "Differently named declarations the compiler proves are one type.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    same_type: "{{names}} resolve to one type under different names.",
    same_type_help:
      "The compiler proves them structurally identical and mutually assignable: {{structural}}. One concept should have one name; if these are two concepts, give one of them a difference the type can carry, not a second spelling of the same shape.{{tail}}{{unverified}}",
  }),
  plan: Effect.fn("joggle/structural-collapse")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(structuralCollapse, locator(workspace))
    const groups = new Map<string, Array<Unit>>()
    for (const unit of workspace.units) {
      if (!isTypeLike(unit)) continue
      const facts = unit.typeFacts
      if (facts === undefined || facts.identicalGroup === null) continue
      const existing = groups.get(facts.identicalGroup)
      if (existing === undefined) groups.set(facts.identicalGroup, [unit])
      else existing.push(unit)
    }

    const candidates = [...groups.values()]
      // One name declared twice is `duplicate-implementation`'s finding, and it is
      // the better one: there the copy is the problem. Here the vocabulary is.
      .filter((group) => namesOf(group).length > 1)
      .filter((group) => group.some((unit) => inScope(scope, unit.file)))
      .sort((left, right) => (namesOf(left)[0] ?? "").localeCompare(namesOf(right)[0] ?? ""))

    if (candidates.length === 0) {
      const resolved = workspace.units.filter((unit) => unit.typeFacts !== undefined).length
      return {
        plans: [],
        read: () =>
          outcome([], [
            resolved === 0
              ? "no declaration carried a resolved type to prove identity with"
              : "no two differently named declarations were proven to be one type",
          ]),
      }
    }

    const judged = candidates.slice(0, policy.structuralCollapse.maxFindings)
    const overBudget: ReadonlyArray<Drop> = candidates
      .slice(policy.structuralCollapse.maxFindings)
      .map((group) => ({
        ruleId: RULE_ID,
        subject: namesOf(group).join(" / "),
        stage: "budget" as const,
        reason: "past the budget of " + String(policy.structuralCollapse.maxFindings) + " groups",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(judged, (group) =>
      Effect.gen(function* () {
        const names = namesOf(group)
        const first = [...group].sort((left, right) => left.file.localeCompare(right.file))[0]
        const structural = first?.typeFacts?.structural ?? ""
        const id = yield* atoms.add({
          names,
          structural: shortType(structural),
          count: group.length,
          files: [...new Set(group.map((unit) => unit.file))].slice(
            0,
            policy.evidence.maxListedPaths,
          ),
          declarations: group.slice(0, policy.evidence.maxMembers).map((unit) => ({
            name: unit.name,
            kind: unit.kind,
            file: unit.file,
            line: unit.location.line,
            display: shortType(unit.typeFacts?.display ?? ""),
          })),
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: RULE_ID,
          subject: names.join(" / "),
          concerns: [...new Set(group.map((unit) => unit.file))],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                "`atoms[" + id + "].declarations` are declarations with different names that the compiler proves are ONE type: they are mutually assignable in both directions and share the member-sorted fingerprint `atoms[" + id + "].structural`.",
                "Is this one idea that acquired two names, or two ideas that happen to have the same shape today?",
                "Answer `one_concept` when the names are two spellings of one thing: one name should be kept and imported everywhere.",
                "Answer `two_concepts` when the declarations name genuinely different things that only coincide now -- a wire payload and a domain shape, a snapshot and a projection.",
              ].join("\n"),
              criteria: {
                one_concept: "One idea, two names. Keep one name and import it.",
                two_concepts: "Two ideas that share a shape. Keep both names.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { group, id, plan }
      }),
    )

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((entry, index) => {
          const { group } = entry
          const subject = namesOf(group).join(" / ")
          const verdict = verdictOf(verdicts[index]?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(
              findingFor({ report, group, confidence: undefined, unverified: "no judgement was available" }),
            )
            return
          }
          if (verdict.label !== "one_concept") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason: "the two names are two concepts that share a shape",
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
              group,
              confidence: verdict.confidence,
              unverified: undefined,
              review: quality.quality === "review",
            }),
          )
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "type groups",
            judged: policy.structuralCollapse.maxFindings,
            candidates: candidates.length,
            sample: candidates
              .slice(policy.structuralCollapse.maxFindings)
              .map((group) => namesOf(group).join(" / ")),
          }),
          drops,
        )
      },
    }
  }),
}

const findingFor = ({
  report,
  group,
  confidence,
  unverified,
  review = false,
}: {
  readonly report: Reporter
  readonly group: ReadonlyArray<Unit>
  readonly confidence: number | undefined
  readonly unverified: string | undefined
  readonly review?: boolean
}): Diagnostic => {
  const names = namesOf(group)
  const first = [...group].sort((left, right) => left.file.localeCompare(right.file))[0]
  const structural = first?.typeFacts?.structural ?? ""
  const files = [...new Set(group.map((unit) => unit.file))].sort((left, right) =>
    left.localeCompare(right),
  )
  const tail =
    files.length <= policy.evidence.maxListedPaths
      ? ""
      : " Declared in " + files.slice(0, policy.evidence.maxListedPaths).join(", ") + " and more."
  return report({
    about: first ?? { file: "", start: 0 },
    messageId: "same_type",
    data: {
      names: names.map((name) => "`" + name + "`").join(", "),
      structural: shortType(structural),
      tail,
      unverified: unverified === undefined ? "" : " Not verified: " + unverified + ".",
    },
    helpId: "same_type_help",
    identity: [RULE_ID, names.join("\u0000")].join("\u0000"),
    judged: unverified === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
}
