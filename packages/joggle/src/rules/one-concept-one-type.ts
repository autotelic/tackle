import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { type PlannedCandidate } from "../plans.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
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
import type { TypeFact } from "../typetrace.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/one-concept-one-type"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["one_concept", "two_concepts"] } as const

// One declared name, resolving to different types in different files.
//
// Text cannot see this. `User` in the API and `User` in the UI read identically
// and are two types; `User` written twice with the same members reads identically
// and is one type written twice. Only the compiler tells which, and the trace is
// its answer.
//
// The resolved type is a FACT. Whether two resolved meanings are one concept that
// should share a declaration, or two concepts that should have two names, is the
// judgement -- and it is the one a reader had to make from the help text.
export const oneConceptOneType: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "One declared name resolving to different types in different files.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    one_name_many_types:
      "`{{name}}` resolves to {{meanings}} different types across {{files}} file(s).",
    one_name_many_types_help:
      "{{lead}}The compiler resolved it to: {{resolved}}. Share one declaration, or give the two concepts two names.{{unverified}}",
  }),
  plan: Effect.fn("joggle/one-concept-one-type")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(oneConceptOneType, locator(workspace))
    const byName = new Map<string, Array<{ readonly unit: Unit; readonly fact: TypeFact }>>()
    for (const unit of workspace.units) {
      // Functions are already compared as names and as call sequences.
      if (unit.kind === "function") continue
      // An exported name is a contract other modules import.
      if (!unit.exported) continue
      const fact = unit.typeFacts
      if (fact === undefined || fact.display === "") continue
      const list = byName.get(unit.name) ?? []
      list.push({ unit, fact })
      byName.set(unit.name, list)
    }

    if (byName.size === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            workspace.types.sites === 0
              ? "no resolved types were available: run with --types to ask the compiler"
              : "no exported type declaration carried a resolved type to compare",
          ]),
      }
    }

    const candidates: Array<{ name: string; entries: Array<{ unit: Unit; fact: TypeFact }>; meanings: number; files: number }> = []
    let divergent = 0
    for (const [name, entries] of byName) {
      const files = new Set(entries.map((entry) => entry.unit.file))
      const meanings = new Set(entries.map((entry) => entry.fact.display))
      if (files.size < 2 || meanings.size < 2) continue
      if (!entries.some((entry) => inScope(scope, entry.unit.file))) continue
      divergent += 1
      candidates.push({ name, entries, meanings: meanings.size, files: files.size })
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            byName.size + " exported type name(s) with a resolved type; none resolve to more than one",
          ]),
      }
    }

    const judged = candidates.slice(0, policy.oneConceptOneType.maxFindings)
    const overBudget: ReadonlyArray<Drop> = candidates
      .slice(policy.oneConceptOneType.maxFindings)
      .map((candidate) => ({
        ruleId: RULE_ID,
        subject: candidate.name,
        stage: "budget" as const,
        reason: "past the budget of " + String(policy.oneConceptOneType.maxFindings) + " names",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(judged, (candidate) =>
      Effect.gen(function* () {
        // The state is the name and each resolved meaning, bounded, which is what
        // the question needs: the compiler's answer, not the source.
        const meanings = candidate.entries.slice(0, 6).map((entry) => ({
          file: entry.unit.file,
          line: entry.unit.location.line,
          display: short(entry.fact.display),
        }))
        const id = yield* atoms.add({
          name: candidate.name,
          meaningCount: candidate.meanings,
          fileCount: candidate.files,
          meanings,
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: RULE_ID,
          subject: candidate.name,
          concerns: [...new Set(candidate.entries.map((entry) => entry.unit.file))],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].name\` is an exported type name that the compiler resolved to ${candidate.meanings} different types across ${candidate.files} files: \`atoms[${id}].meanings\` lists each declaration and what it resolved to.`,
                "Are those meanings ONE concept that should share one declaration, or two concepts that should have two names?",
                "Answer `one_concept` when they are the same idea written incompletely, so they should share one declaration.",
                "Answer `two_concepts` when the name has been reused for different things, so one should be renamed.",
                "Answer `intentional` when the divergence is deliberate and fine -- a name scoped per module, a generic used on purpose.",
              ].join("\n"),
              criteria: {
                one_concept: "One idea, written more than one way. Share one declaration.",
                two_concepts: "One name, different things. Give one of them a new name.",
                intentional: "A deliberate divergence. Nothing to change.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { candidate, id, plan } satisfies PlannedCandidate<typeof candidate>
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
          const { candidate } = value
          const subject = candidate.name
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, candidate, undefined, "no judgement was available", false, false))
            return
          }
          if (verdict.label !== "one_concept" && verdict.label !== "two_concepts") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason: "the divergence is deliberate",
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
          const review = quality.quality === "review"
          diagnostics.push(
            findingFor(report, candidate, verdict.confidence, undefined, verdict.label === "two_concepts", review),
          )
        })
        return outcome(
          diagnostics,
          [
            byName.size +
              " exported type name(s) with a resolved type; " +
              divergent +
              " resolve to more than one",
            ...budgetNote({
              unitKind: "names",
              judged: policy.oneConceptOneType.maxFindings,
              candidates: candidates.length,
              sample: candidates.slice(policy.oneConceptOneType.maxFindings).map((candidate) => candidate.name),
            }),
          ],
          drops,
        )
      },
    }
  }),
}

const findingFor = (
  report: Report,
  candidate: {
    readonly name: string
    readonly meanings: number
    readonly files: number
    readonly entries: ReadonlyArray<{ readonly unit: Unit; readonly fact: TypeFact }>
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  renamed = false,
  review = false,
): Diagnostic => {
  const first = candidate.entries[0]
  return report({
    about: first?.unit ?? { file: "", start: 0 },
    messageId: "one_name_many_types",
    data: {
      name: candidate.name,
      meanings: candidate.meanings,
      files: candidate.files,
      lead: renamed
        ? "One name, different things. Give one of them its own name. "
        : "One name should mean one type. ",
      resolved: candidate.entries
        .map(
          (entry) =>
            entry.unit.file + ":" + String(entry.unit.location.line) + " -> " + short(entry.fact.display),
        )
        .join("; "),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "one_name_many_types_help",
    identity: [RULE_ID, candidate.name].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
}

/** A resolved type, cut to the length a finding's help can carry. */
const short = (value: string): string =>
  value.length <= policy.oneConceptOneType.maxTypeChars
    ? value
    : value.slice(0, policy.oneConceptOneType.maxTypeChars) + "..."