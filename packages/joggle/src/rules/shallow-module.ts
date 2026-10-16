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
import type { SourceFile, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/shallow-module"

/**
 * A file with a wide surface and little behind it.
 *
 * The CANDIDATE is structural: a file that exports more than a few things over a
 * thin body. That is a fact, and the ratio is exact.
 *
 * Whether it is a problem is not. Ousterhout's deep module is a simple interface
 * over a complex implementation; a wide interface over a thin one may be a grab
 * bag, or it may be a barrel file, a set of type re-exports, or a module whose
 * whole job is a thin facade. The old Rust tool reported every file under the
 * ratio. The verdict is a judgement, so the model makes it.
 *
 * The export names and the source are the state: the model can see what the file
 * promises, which is what decides whether the promises belong together.
 */
const implementationLines = (text: string): number =>
  text.split("\n").filter((line) => {
    const trimmed = line.trim()
    if (trimmed === "") return false
    if (trimmed.startsWith("//") || trimmed.startsWith("/*") || trimmed.startsWith("*")) return false
    if (trimmed.startsWith("import ") || trimmed.startsWith("} from ")) return false
    if (trimmed.startsWith("export interface ") || trimmed.startsWith("export type ")) return false
    return true
  }).length

/** The two questions about one file, pointing at its atom by id. */
const moduleReview = (id: string) => ({
  grab_bag: Decision.probability({
    instructions: [
      `Is \`atoms[${id}].module.path\` a grab bag rather than a module with one job?`,
      `\`atoms[${id}].module.exports\` are the names it promises and \`atoms[${id}].module.implementation\` is the number of lines behind them.`,
      "Answer true when the exports are unrelated things that happen to live in one file, so a reader has to open it to find out what it is for.",
      "Answer false when the file has one job: a facade over a subsystem, a barrel of related types, a collection of small helpers for one domain, or a file whose thinness is deliberate.",
      "A wide file is not automatically a grab bag. Judge whether the exports belong together, not how many there are.",
    ].join("\n"),
    criteria: {
      false: "The exports belong together.",
      true: "It is a grab bag.",
    },
  }),
  job: Decision.classify({
    instructions: [
      `What is the single job of \`atoms[${id}].module.path\`, if it has one?`,
      "Choose `no_issue` when the exports are unrelated things that happen to share a file.",
    ].join("\n"),
    criteria: {
      facade: "A simple interface over a subsystem.",
      related_helpers: "Small helpers that serve one domain.",
      type_surface: "A barrel of related types or re-exports.",
      no_issue: "The exports do not belong together.",
    },
  }),
})

export const shallowModule: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A file with many exports and little implementation behind them.",
  judged: true,
  move: "expand",
  onUnavailable: "propagate",
  messages: messages({
    grab_bag:
      "{{file}} exports {{exports}} thing(s) over {{lines}} implementation line(s), and they are a grab bag rather than one job.",
    grab_bag_help:
      "A deep module is a simple interface over a complex implementation. This is the other way round. Move the exports to where their work lives, or give the file the implementation that earns them.{{review}}",
  }),
  plan: Effect.fn("joggle/shallow-module")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(shallowModule, locator(workspace))
    const candidates = workspace.files.filter((file) => {
      if (scope.changed !== undefined && !scope.changed.has(file.path)) return false
      const exports = file.units.filter((unit) => unit.exported).length
      if (exports < policy.shallowModule.minExports) return false
      return implementationLines(file.text) / exports < policy.shallowModule.minDepth
    })
    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no file exported " +
              policy.shallowModule.minExports +
              " or more things over a thin body",
          ]),
      }
    }
    const budget = policy.shallowModule.maxFiles
    const judged = candidates.slice(0, budget)
    const atoms = yield* Atoms
    const planned: Array<{ readonly file: SourceFile; readonly plan: Plan<DecisionAnswers> }> = []
    for (const file of judged) {
      const exports = file.units.filter((unit) => unit.exported).map((unit) => unit.name)
      const id = yield* atoms.add({
        module: {
          path: file.path,
          exports,
          implementation: implementationLines(file.text),
          source: file.text.slice(0, policy.evidence.maxSourceChars * 4),
        },
      })
      planned.push({
        file,
        plan: {
          ruleId: RULE_ID,
          subject: file.path,
          concerns: [file.path],
          atoms: [id],
          violations: { grab_bag: [] },
          decisions: moduleReview(id),
          // The answer map IS this plan's result: one verdict per decision.
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = candidates.slice(budget).map((file) => ({
      ruleId: RULE_ID,
      subject: file.path,
      stage: "budget" as const,
      reason: "past the budget of " + budget + " wide, thin files",
    }))

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overflow]
        planned.forEach((entry, index) => {
          const file = entry.file
          const answer = verdicts[index]
          if (answer === undefined) {
            drops.push({
              ruleId: RULE_ID,
              subject: file.path,
              stage: "unreadable",
              reason: "the response did not judge this file",
            })
            return
          }
          const grab = answer["grab_bag"]
          const job = answer["job"]
          if (grab === undefined || !("probability" in grab) || job === undefined || !("label" in job)) {
            drops.push({
              ruleId: RULE_ID,
              subject: file.path,
              stage: "unreadable",
              reason: "the response did not contain a verdict",
            })
            return
          }
          if (declined(job.label)) {
            drops.push({
              ruleId: RULE_ID,
              subject: file.path,
              stage: "declined",
              reason: "the exports belong together",
            })
            return
          }
          const quality = qualityOf({
            score: grab.probability,
            margin: marginOfAnswer(job),
            confidence: job.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({ ruleId: RULE_ID, subject: file.path, stage: "gated", reason: quality.reason })
            return
          }
          const review = quality.quality === "review"
          const exports = file.units.filter((unit) => unit.exported).length
          diagnostics.push(
            report({
                          about: file,
                          messageId: "grab_bag",
                          data: {
                            file: file.path,
                            exports,
                            lines: implementationLines(file.text),
                            review: review ? " For review: " + quality.reason + "." : "",
                          },
                          helpId: "grab_bag_help",
                          identity: [RULE_ID, file.path].join("\u0000"),
                          confidence: job.confidence ?? 1,
                          score: grab.probability,
                          judged: true,
                          severity: review ? "info" : "warn",
                        }),
          )
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "wide, thin files",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((file) => file.path),
          }),
          drops,
        )
      },
    }
  }),
}
