import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import {
  budgetNote,
  declined,
  marginOfAnswer,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"
// meta-allow: no-pattern-classifier -- the operation pairs are a DECLARED convention
// in policy.temporalCoupling.pairs, not a fact derivable from the code: which
// operations acquire and release is knowledge about resource APIs, and the rule's
// judgement (is this acquire unpaired?) is still the model's. docs/rule-coupling.md.

const RULE_ID = "joggle/temporal-coupling"

/**
 * A function that calls one half of a paired operation without the other.
 *
 * The CANDIDATE is structural and exact: a function that calls `lock` and not
 * `unlock`, matched by the resolved call names inside its own span. That is a
 * fact, and code computes it for free.
 *
 * Whether it is a problem is not a fact. `lock` may acquire a mutex, or it may
 * be the name of something that is not a lock; the release may be the caller's
 * job; the two names may share a stem and mean two different things. The old Rust
 * tool answered that with a threshold and reported every match. The answer is a
 * judgement, so the model makes it.
 *
 * The pairs are deliberately few. `start` and `stop` are not here: a function
 * called `startTimer` calls `start`, and the `stop` lives elsewhere by design.
 */
const { pairs: PAIRS } = policy.temporalCoupling

/** The method name at the end of a resolved call: `a/b.ts#this.lock` is `lock`. */
const methodOf = (resolved: string): string => {
  const hash = resolved.lastIndexOf("#")
  const name = hash === -1 ? resolved : resolved.slice(hash + 1)
  const dot = name.lastIndexOf(".")
  return dot === -1 ? name : name.slice(dot + 1)
}

interface Candidate {
  readonly unit: Unit
  readonly present: string
  readonly missing: string
}

/** The two questions about one declaration, pointing at its atom by id. */
const temporalReview = (id: string) => ({
  verdict: Decision.classify({
    instructions: [
      `\`atoms[${id}].declaration.name\` calls \`atoms[${id}].declaration.present\` and not \`atoms[${id}].declaration.missing\`.`,
      `Choose \`resource_needs_release\` when \`atoms[${id}].declaration.present\` acquires or opens something that \`atoms[${id}].declaration.missing\` would release or close, and the declaration does not release it another way.`,
      "Choose `released_elsewhere` when the release is deliberate and elsewhere: the declaration returns the resource, or releasing is the caller's job, or another call in the declaration releases it.",
      "Choose `unrelated_names` when the two names are not a pair -- they are different operations that happen to share a stem.",
      "Choose `no_issue` when there is nothing to fix.",
    ].join("\n"),
    criteria: {
      resource_needs_release: "It acquires something it must release, and does not.",
      released_elsewhere: "The release is elsewhere by design.",
      unrelated_names: "The names are not a pair.",
      no_issue: "Nothing to fix.",
    },
  }),
  worth_fixing: Decision.probability({
    instructions: `Would the missing release cause a real problem a reviewer should fix? The declaration is \`atoms[${id}].declaration.name\` in \`atoms[${id}].declaration.path\`.`,
    criteria: { false: "No, it would not.", true: "Yes, it would." },
  }),
})

const candidatesIn = (workspace: Workspace, scope: Scope): ReadonlyArray<Candidate> => {
  const found: Array<Candidate> = []
  for (const file of workspace.files) {
    if (scope.changed !== undefined && !scope.changed.has(file.path)) continue
    for (const unit of file.units) {
      if (unit.kind !== "function" || unit.calls.length === 0) continue
      const methods = unit.calls.map(methodOf)
      for (const [present, missing] of PAIRS) {
        if (methods.includes(present) && !methods.includes(missing)) found.push({ unit, present, missing })
      }
    }
  }
  return found
}

export const temporalCoupling: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A function that acquires something it may not release.",
  judged: true,
  onUnavailable: "propagate",
  messages: messages({
    unpaired_operations:
      "{{name}} calls {{present}}() without {{missing}}() in the same scope.",
    unpaired_operations_help:
      "If {{present}} throws, {{missing}} never runs. Put them in a try/finally, or make one helper own both halves.{{review}}",
  }),
  plan: Effect.fn("joggle/temporal-coupling")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(temporalCoupling, locator(workspace))
    const candidates = candidatesIn(workspace, scope)
    if (candidates.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no function called one half of a paired operation"]),
      }
    }
    const budget = policy.temporalCoupling.maxDeclarations
    const judged = candidates.slice(0, budget)
    const label = (candidate: Candidate): string =>
      candidate.unit.name + " (" + candidate.unit.file + ")"
    const atoms = yield* Atoms
    const planned: Array<{ readonly candidate: Candidate; readonly plan: Plan<DecisionAnswers> }> = []
    for (const candidate of judged) {
      const id = yield* atoms.add({
        declaration: {
          name: candidate.unit.name,
          path: candidate.unit.file,
          source: candidate.unit.text.slice(0, policy.evidence.maxSourceChars),
          present: candidate.present,
          missing: candidate.missing,
        },
      })
      planned.push({
        candidate,
        plan: {
          ruleId: RULE_ID,
          subject: label(candidate),
          concerns: [candidate.unit.file],
          atoms: [id],
          violations: { verdict: ["resource_needs_release"] },
          decisions: temporalReview(id),
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: label(candidate),
      stage: "budget" as const,
      reason: "past the budget of " + budget + " paired-operation candidates",
    }))

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overflow]
        planned.forEach((entry, index) => {
          const candidate = entry.candidate
          const answer = verdicts[index]
          if (answer === undefined) {
        drops.push({
          ruleId: RULE_ID,
          subject: label(candidate),
          stage: "unreadable",
          reason: "the response did not judge this declaration",
        })
        return
      }
      const verdict = answer["verdict"]
      const worth = answer["worth_fixing"]
      if (verdict === undefined || !("label" in verdict)) {
        drops.push({
          ruleId: RULE_ID,
          subject: label(candidate),
          stage: "unreadable",
          reason: "the response did not contain a verdict",
        })
        return
      }
      if (declined(verdict.label) || verdict.label === "released_elsewhere" || verdict.label === "unrelated_names") {
        drops.push({
          ruleId: RULE_ID,
          subject: label(candidate),
          stage: "declined",
          reason: "the model says " + verdict.label.replace(/_/g, " "),
        })
        return
      }
      const probability = worth !== undefined && "probability" in worth ? worth.probability : undefined
      const confidence = verdict.confidence ?? 1
      const quality = qualityOf({
        score: probability ?? confidence,
        margin: marginOfAnswer(verdict),
        confidence,
      })
      if (quality.quality === "drop") {
        drops.push({ ruleId: RULE_ID, subject: label(candidate), stage: "gated", reason: quality.reason })
        return
      }
      const review = quality.quality === "review"
      diagnostics.push(
        report({
                  about: candidate.unit,
                  messageId: "unpaired_operations",
                  data: {
                    name: candidate.unit.name,
                    present: candidate.present,
                    missing: candidate.missing,
                    review: review ? " For review: " + quality.reason + "." : "",
                  },
                  helpId: "unpaired_operations_help",
                  identity: [RULE_ID, candidate.unit.file, candidate.unit.name, candidate.present].join("\u0000"),
                  confidence,
                  score: probability ?? confidence,
                  judged: true,
                  severity: review ? "info" : "warn",
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "paired-operation candidates",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map(label),
          }),
          drops,
        )
      },
    }
  })
}
