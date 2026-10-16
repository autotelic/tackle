import { Effect, Option } from "effect"
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
import type { TypeFact } from "../typetrace.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { GuardSite, Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/types-over-logic"

// A guard clause on a value whose type should carry the guarantee.
//
// The rule this repository kept needing: a problem is chased down by ADDING
// LOGIC -- another `if`, another check -- where refining a type (a brand, a
// refined schema, a non-nullable type parsed once) would make the check
// unnecessary and the class of bug impossible. `parse, don't validate` as a
// finding rather than a principle.
//
// Two facts, and neither classifies:
//
//   the guard    an AST `if` whose branch returns or throws, and the references
//                its test names (`file.facts.guards`)
//   the type     the CHECKER's resolved type for that reference, from the trace
//
// An earlier version matched `if (!x)` and `x === null` against the source and
// kept a hand-written set of "wide" type names. That decided the question Jev is
// for, and it is coupled to how this repository spells a guard
// (`docs/rule-coupling.md`). The shape is syntax, the type is the checker's, and
// what it MEANS is asked.
//
// It needs the trace: without one there is no type to ask about, and the rule
// says so rather than guessing from the text. `joggle check --types`.
const carriesAnInvariant = (fact: TypeFact): boolean =>
  // Not a concrete object type -- a primitive, `any`, `unknown`, or a union --
  // or an object that admits a missing value. Read from the checker's flags and
  // union members, which are the checker's own vocabulary, not this repository's.
  !fact.flags.includes("Object") ||
  fact.members.some((member) => member === "null" || member === "undefined")

/** The resolved type of a reference, by its full dotted name then its last segment. */
const typeOf = (
  workspace: Workspace,
  file: string,
  line: number,
  ref: string,
): Option.Option<TypeFact> => {
  const found =
    workspace.types.at(file, line, ref) ??
    workspace.types.at(file, line, ref.slice(ref.lastIndexOf(".") + 1))
  return found === undefined ? Option.none() : Option.some(found)
}

interface Candidate {
  readonly unit: Unit
  readonly file: string
  readonly guard: GuardSite
  readonly ref: string
  readonly fact: TypeFact
}

export const typesOverLogic: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A runtime guard on a value whose type should carry the guarantee.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    guard_not_type:
      "{{name}} guards `{{value}}` (`{{declared}}`) with a check a type could carry.",
    guard_not_type_help:
      "Parse the value once at the boundary into a narrower type -- a branded id, a validated schema type, a non-nullable type -- and every guard like this one disappears. If the check is genuinely the boundary, pin that decision so it is not asked again.{{unverified}}",
  }),
  plan: Effect.fn("joggle/types-over-logic")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(typesOverLogic, locator(workspace))
    if (workspace.types.sites === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no type trace reached this run, so a guard's value has no resolved type to ask about: run with --types",
          ]),
      }
    }

    const candidates: Array<Candidate> = []
    for (const file of workspace.files) {
      if (scope.changed !== undefined && !inScope(scope, file.path)) continue
      for (const guard of file.facts.guards) {
        if (!guard.exits) continue
        const unit = file.units.find((entry) => guard.start >= entry.start && guard.end <= entry.end)
        if (unit === undefined) continue
        for (const ref of guard.refs) {
          const fact = typeOf(workspace, file.path, unit.location.line, ref)
          if (Option.isNone(fact) || !carriesAnInvariant(fact.value)) continue
          candidates.push({ unit, file: file.path, guard, ref, fact: fact.value })
          // One question per guard: the same `if` does not become two findings.
          break
        }
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no guard clause stands in for a type on a value the checker resolved",
          ]),
      }
    }

    const budget = policy.evidence.maxMembers * 16
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " guards",
    }))

    const textOf = new Map(workspace.files.map((file) => [file.path, file.text]))
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const text = textOf.get(candidate.file) ?? ""
          const id = yield* atoms.add({
            declaration: { name: candidate.unit.name, file: candidate.file, line: candidate.unit.location.line },
            value: candidate.ref,
            declaredType: candidate.fact.display,
            guard: text.slice(candidate.guard.start, Math.min(candidate.guard.end, candidate.guard.start + 240)),
            source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.name + " (" + candidate.file + ")",
            concerns: [candidate.file],
            atoms: [id],
            violations: { verdict: ["type_should_carry_it"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].source\` is a function. It guards \`atoms[${id}].value\`, which the checker resolved to \`atoms[${id}].declaredType\`, with \`atoms[${id}].guard\`.`,
                  "A guard clause narrows a value the type left wide. Does the type itself establish an invariant, or is the check the boundary where the value is genuinely narrowed?",
                  "Answer `type_should_carry_it` when the value could be parsed once at the boundary into a narrower type -- a branded id, a validated schema type, a non-nullable type -- so that this check and every later one like it disappears and the class of bug becomes impossible.",
                  "Answer `boundary_check` ONLY when the function's own job is to turn untrusted input into a typed value: a raw or unparsed argument, network data, a schema decode. A function that takes an already-typed value and narrows it is NOT a boundary.",
                  "Answer `runtime_condition` ONLY when the guard tests state a type cannot hold: a flag, a network result, a value looked up at run time.",
                ].join("\n"),
                criteria: {
                  type_should_carry_it: "A type should carry it. Parse once at the boundary and brand it.",
                  boundary_check: "This is the boundary. The check establishes the type.",
                  runtime_condition: "Runtime state, not a type invariant.",
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
          const subject = candidate.unit.name + " (" + candidate.file + ")"
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["type_should_carry_it"])
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, candidate, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "type_should_carry_it") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "boundary_check"
                  ? "this is the parse boundary"
                  : "the guard tests runtime state",
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
          diagnostics.push(findingFor(report, candidate, verdict.confidence, undefined))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "guards",
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
  candidate: Candidate,
  confidence: number | undefined,
  unverifiedReason: string | undefined,
): Diagnostic =>
  report({
    about: { file: candidate.file, start: candidate.guard.start },
    messageId: "guard_not_type",
    data: {
      name: candidate.unit.name,
      value: candidate.ref,
      declared: candidate.fact.display,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "guard_not_type_help",
    identity: [RULE_ID, candidate.file, candidate.unit.name, candidate.ref].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: "info",
  })
