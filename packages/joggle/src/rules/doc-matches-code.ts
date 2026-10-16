import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  declined,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/doc-matches-code"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["stale_reference", "wrong_contract", "wrong_behavior"] } as const

/**
 * A JSDoc that makes a claim the implementation contradicts.
 *
 * Three comments in three merged PRs on one repository were the same defect: a
 * doc block that had drifted from the code it sat on.
 *
 *   "comment says 'null for people with no project role' but band is typed as
 *    ReportingBand (not nullable)"
 *   "This points at a compareYears note that does not exist."
 *   "JSDoc says title-cased but there is no capitalization in here"
 *
 * None is a type error and none is a lint error. The type checker reads the type,
 * not the prose, and a linter reads syntax. The doc is the one artefact with no
 * checker at all, which is why it is the one that drifts.
 *
 * The model is the right instrument because the question is about meaning: does
 * the sentence describe what the code does? The prompt is strict on purpose --
 * a concrete contradiction only -- so the rule reports drift rather than style.
 */

const docReview = (id: string) => ({
  verdict: Decision.classify({
    instructions: [
      `Does the JSDoc on \`atoms[${id}].declaration.name\` state a fact that \`atoms[${id}].declaration.source\` contradicts?`,
      "Choose `no_issue` when the doc states no fact the code contradicts. This is the answer for a doc that is short, informal, high-level, or a summary rather than a full description.",
      "Choose a contradiction ONLY when you can point to the source that contradicts the doc:",
      "- `stale_reference`: the doc names a symbol, note, option or parameter that does not exist.",
      "- `wrong_contract`: the doc states a nullability, default, type, casing or format the code contradicts.",
      "- `wrong_behavior`: the doc describes behaviour the code does not have.",
    ].join("\n"),
    criteria: {
      no_issue: "The doc states no fact the code contradicts.",
      stale_reference: "The doc names a symbol, note, option or parameter that does not exist.",
      wrong_contract: "The doc states a nullability, default, type, casing or format the code contradicts.",
      wrong_behavior: "The doc describes behaviour the code does not have.",
    },
  }),
})

/**
 * The prose of a doc block.
 *
 * `@param`, `@returns` and `@see` are a second contract, and the type checker
 * already reads the real one. Comparing the tags to the code reports the tag's
 * wording rather than the doc's meaning, so the model sees the prose only.
 */
const proseOf = (doc: string): string =>
  doc
    .split("\n")
    .filter((line) => !line.trim().startsWith("@"))
    .join("\n")
    .trim()

/** An exported declaration with a doc block and enough in it to document. */
const candidatesIn = (workspace: Workspace, scope: Scope): ReadonlyArray<Unit> =>
  workspace.units
    .filter((unit) => unit.exported && unit.doc !== undefined && unit.doc.trim().length > 0)
    .filter((unit) => unit.tokens.length >= policy.docMatchesCode.minTokens)
    .filter((unit) => scope.changed === undefined || scope.changed.has(unit.file))
    .sort((left, right) => left.file.localeCompare(right.file) || left.start - right.start)

export const docMatchesCode: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A JSDoc that makes a claim the implementation contradicts.",
  judged: true,
  onUnavailable: "propagate",
  messages: messages({
    doc_contradicts: "{{where}} has a doc block that contradicts the code: {{contradiction}}.",
    doc_contradicts_help:
      "Fix the doc to match the code, or the code to match the doc. The doc is the one artefact no checker reads, so it is the one that drifts.",
  }),
  plan: Effect.fn("joggle/doc-matches-code")(function* (
    workspace: Workspace,
    scope: Scope,
  ) {
    const report = reporter(docMatchesCode, locator(workspace))
    const candidates = candidatesIn(workspace, scope)
    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no exported declaration carries a doc block long enough to document a contract",
          ]),
      }
    }

    const budget = policy.docMatchesCode.maxDeclarations
    const judged = candidates.slice(0, budget)
    const label = (unit: Unit): string => unit.name + " (" + unit.file + ")"
    const atoms = yield* Atoms
    const planned: Array<{ readonly unit: Unit; readonly plan: Plan<DecisionAnswers> }> = []
    for (const unit of judged) {
      const id = yield* atoms.add({
        declaration: {
          name: unit.name,
          path: unit.file,
          kind: unit.kind,
          doc: proseOf(unit.doc ?? "").slice(0, policy.evidence.maxDocChars * 4),
          source: unit.text.slice(0, policy.evidence.maxSourceChars * 2),
          types: unit.typeRefs,
        },
      })
      planned.push({
        unit,
        plan: {
          ruleId: RULE_ID,
          subject: label(unit),
          concerns: [unit.file],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: docReview(id),
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = candidates.slice(budget).map((unit) => ({
      ruleId: RULE_ID,
      subject: label(unit),
      stage: "budget" as const,
      reason: "past the budget of " + budget + " documented declarations",
    }))

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overflow]
        planned.forEach((entry, index) => {
          const unit = entry.unit
          const answer = verdicts[index]
          if (answer === undefined) {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "unreadable",
          reason: "the response did not judge this doc block",
        })
        return
      }
      const verdict = verdictOf(answer["verdict"], VIOLATIONS.verdict)
      if (verdict === undefined) {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "unreadable",
          reason: "the response did not contain a usable verdict",
        })
        return
      }
      if (verdict.label === "no_issue" || declined(verdict.label)) {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "declined",
          reason: "the doc matches the code",
        })
        return
      }
      const quality = qualityOf({ score: verdict.probability, margin: verdict.margin, confidence: verdict.confidence })
      if (quality.quality === "drop") {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "gated",
          reason: quality.reason,
        })
        return
      }
      diagnostics.push(
        report({
                  about: unit,
                  messageId: "doc_contradicts",
                  data: { where: label(unit), contradiction: (verdict.label ?? "unreadable").replace(/_/g, " ") },
                  helpId: "doc_contradicts_help",
                  identity: [RULE_ID, unit.file, unit.name].join("\u0000"),
                  confidence: verdict.confidence ?? 1,
                  score: verdict.probability,
                  judged: true,
                  severity: quality.quality === "review" ? "info" : "warn",
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "documented declarations",
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
