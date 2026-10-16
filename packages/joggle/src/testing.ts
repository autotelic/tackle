import { Effect, Layer } from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import { DecisionModel } from "effect/unstable/ai"
import { Atoms, layer as atomsLayer } from "./atoms.ts"
import { unavailableFor } from "./config.ts"
import { decisionError, isUnreachable } from "./decision.ts"
import { answerPlans, PlanAnswers, type PlanAnswerStore } from "./plans.ts"
import { countUnjudged, everyFile, type PlannedRule, type Rule, type RuleOutcome, type RunContext } from "./rule.ts"
import type { Diagnostic } from "./schema.ts"
import type { Workspace } from "./workspace.ts"

/** A test's answer for one decision, in the vocabulary the tests already use. */
export type StubAnswer =
  | { readonly type: "noul"; readonly noul: number }
  | {
      readonly type: "choice"
      readonly choice: string
      readonly probabilities: Readonly<Record<string, number>>
      readonly confidence: number
    }
  | {
      readonly type: "rate"
      readonly rating: number
      readonly probabilities?: Readonly<Record<string, number>>
      readonly confidence?: number
    }

/**
 * What a rule author needs in order to test a rule.
 *
 * Writing a second rule is the point of the registry, and nobody writes a second
 * rule without a way to run it. Every test in this repository hand-rolled the
 * same three lines to get a rule's diagnostics out of an Effect; that is exactly
 * the boilerplate a published surface should absorb.
 *
 * Deliberately small. A tester is not a framework: it runs one rule over one
 * already-loaded workspace and hands back what the rule said.
 */
export interface RuleTestOptions {
  /** What the rule is told about the run. Empty config by default. */
  readonly context?: RunContext | undefined
  /**
   * The answers to give, when the rule asks for any.
   *
   * Absent means a model that refuses with a clear reason. A structural rule
   * never reaches it -- and the type has to ask for a service either way, because
   * a rule that turns out to be judged must not be a compile error. Defaulting to
   * refusal rather than to silence means a rule that DOES ask fails loudly
   * instead of quietly reporting nothing.
   */
  readonly model?: Layer.Layer<DecisionModel.DecisionModel | Atoms | PlanAnswers> | undefined
}

/** The shared atom store, fresh per provide. */
export { atomsLayer }

/**
 * An answer cache that never remembers.
 *
 * A test that is not about caching should not have one, and a test that is can
 * provide a real store. What matters is that the engine always has a store to
 * ask, so a rule under test never has to know which kind it got.
 */
export const planAnswersLayer: Layer.Layer<PlanAnswers> = Layer.succeed(PlanAnswers, {
  get: () => Effect.succeedNone,
  put: () => Effect.void,
} satisfies PlanAnswerStore)

/** A model layer, with the shared services every judged rule now needs. */
const withShared = <R>(layer: Layer.Layer<R>): Layer.Layer<R | Atoms | PlanAnswers> =>
  Layer.mergeAll(layer, atomsLayer, planAnswersLayer)

/** Run a rule against a workspace and return its findings, for a test. */
export const diagnosticsOf = (
  rule: Rule,
  workspace: Workspace,
  options: RuleTestOptions = {},
): Effect.Effect<ReadonlyArray<Diagnostic>, AiError.AiError> =>
  rule.run(workspace, everyFile, options.context ?? { config: {} }).pipe(
    Effect.map((result) => result.diagnostics),
    Effect.provide(
      options.model ?? refusingModel("this rule asked for a judgement and none was provided"),
    ),
  )

/**
 * Run a planned rule the way the engine does, for one rule.
 *
 * The engine answers every planned rule's questions in one request; a test of one
 * rule wants the same three moves -- plan, answer, read -- without the rest of the
 * registry. The degrade behaviour matches the engine's, so a test can see what a
 * rule does when the model is unreachable.
 */
export const plannedDiagnosticsOf = (
  rule: PlannedRule,
  workspace: Workspace,
  context: RunContext = { config: {} },
): Effect.Effect<
  RuleOutcome,
  AiError.AiError,
  Atoms | PlanAnswers | DecisionModel.DecisionModel
> =>
  Effect.gen(function* () {
    const planned = yield* rule.plan(workspace, everyFile, context)
    const unavailable = unavailableFor(context.config, rule.id, rule.onUnavailable)
    let unreachable = false
    const answers = yield* answerPlans(planned.plans).pipe(
      Effect.catch((error) => {
        if (unavailable === "propagate" && isUnreachable(error)) return Effect.fail(error)
        unreachable = isUnreachable(error)
        return Effect.succeed(planned.plans.map(() => undefined))
      }),
    )
    const result = planned.read(answers)
    return unreachable && unavailable === "count"
      ? countUnjudged(result, "no judgement was available")
      : result
  })

/** A model that answers every decision from one table. */
export const answeringModel = (
  answers: Readonly<Record<string, StubAnswer>>,
): Layer.Layer<DecisionModel.DecisionModel | Atoms | PlanAnswers> => decisionStub(answers)

/** A model that cannot answer, for testing what a rule does without one. */
export const refusingModel = (
  reason: string,
): Layer.Layer<DecisionModel.DecisionModel | Atoms | PlanAnswers> =>
  withShared(
    Layer.effect(
      DecisionModel.DecisionModel,
      DecisionModel.make({
        decide: () =>
          Effect.fail(
            decisionError(["@autotelic/joggle/testing", "decide"], AiError.UnknownError.make({ description: reason })),
          ),
      }),
    ),
  )

/**
 * The name a test wrote, from the name the engine sent.
 *
 * The engine disambiguates a decision with the plan that asked it
 * (`verdict@3`), because two plans ask the same names. A test names the
 * decision, so the suffix is stripped before the lookup.
 */
// A request name back to the decision's own name. The engine disambiguates a
// decision by the plan that asked it (`name@3`), and a Noul asked `repeats` times
// adds the ask (`name@3~1`), so both suffixes come off.
const localName = (key: string): string => key.replace(/~\d+$/, "").replace(/@\d+$/, "")

/**
 * A DecisionModel that answers from a table of answers.
 *
 * The tests are about policy, so the model is a stub. A distribution with labels
 * missing gets the remainder spread over them, so a test can name only the
 * options it is about and still pass Effect's validation.
 */
export const decisionStub = (
  supplied: Readonly<Record<string, StubAnswer>> = {},
): Layer.Layer<DecisionModel.DecisionModel | Atoms | PlanAnswers> =>
  withShared(
    Layer.effect(
      DecisionModel.DecisionModel,
      DecisionModel.make({
      decide: ({ decisions }) =>
        Effect.succeed({
          answers: Object.fromEntries(
            Object.entries(decisions).map(([key, decision]) => {
              const answer = supplied[localName(key)]
              if (decision._tag === "Classify") {
                const labels = Object.keys(decision.criteria)
                const label =
                  answer !== undefined && answer.type === "choice" ? answer.choice : (labels[0] ?? "")
                const given =
                  answer !== undefined && answer.type === "choice" ? answer.probabilities : {}
                const missing = labels.filter((candidate) => given[candidate] === undefined)
                const total = Object.values(given).reduce((sum, value) => sum + value, 0)
                const remainder = missing.length === 0 ? 0 : Math.max(0, (1 - total) / missing.length)
                return [
                  key,
                  {
                    _tag: "Classify" as const,
                    label,
                    probabilities: Object.fromEntries(
                      labels.map((candidate) => [candidate, given[candidate] ?? remainder]),
                    ),
                    confidence:
                      answer !== undefined && answer.type === "choice" ? answer.confidence : 0.9,
                  },
                ]
              }
              if (decision._tag === "Rate") {
                const levels = decision.criteria
                if (answer === undefined || answer.type !== "rate") {
                  return [
                    key,
                    {
                      _tag: "Rate" as const,
                      rating: 0,
                      probabilities: Object.fromEntries(
                        levels.map((level, index) => [level, index === 0 ? 1 : 0]),
                      ),
                      confidence: 0.9,
                    },
                  ]
                }
                const provided = answer.probabilities ?? {}
                const missing = levels.filter((level) => provided[level] === undefined)
                const total = Object.values(provided).reduce((sum, value) => sum + value, 0)
                const remainder = missing.length === 0 ? 0 : Math.max(0, (1 - total) / missing.length)
                return [
                  key,
                  {
                    _tag: "Rate" as const,
                    rating: answer.rating,
                    probabilities: Object.fromEntries(
                      levels.map((level) => [level, provided[level] ?? remainder]),
                    ),
                    confidence: answer.confidence ?? 0.9,
                  },
                ]
              }
              return [
                key,
                {
                  _tag: "Probability" as const,
                  probability: answer !== undefined && answer.type === "noul" ? answer.noul : 0.9,
                },
              ]
            }),
          ),
          usage: { inputTokens: 0, outputTokens: 0 },
        }),
      }),
    ),
  )
