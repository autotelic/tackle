import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Ref } from "effect"
import { DecisionModel } from "effect/unstable/ai"
import { checkRepository } from "../src/check.ts"
import { DecisionStats } from "../src/decision.ts"
import { PlanAnswers } from "../src/plans.ts"
import { builtIn } from "../src/rules/index.ts"
import { corpus, nodeLayer, tsgoStub } from "./support.ts"

const totals = { requests: 0, replayed: 0, calls: 0, unavailable: 0, inputTokens: 0, outputTokens: 0 }

/** A model that counts its calls and answers every decision with its first option. */
const countingModel = (calls: Ref.Ref<number>): Layer.Layer<DecisionModel.DecisionModel> =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ decisions }) =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (count) => count + 1)
          const answers: Record<string, DecisionModel.ProviderAnswer> = {}
          for (const [key, decision] of Object.entries(decisions)) {
            if (decision._tag === "Classify") {
              const labels = Object.keys(decision.criteria)
              answers[key] = {
                _tag: "Classify",
                label: labels[0] ?? "",
                probabilities: Object.fromEntries(labels.map((label) => [label, 1 / labels.length])),
                confidence: 0.9,
              }
            } else if (decision._tag === "Rate") {
              answers[key] = {
                _tag: "Rate",
                rating: 0,
                probabilities: Object.fromEntries(
                  decision.criteria.map((level) => [level, 1 / decision.criteria.length]),
                ),
                confidence: 0.9,
              }
            } else {
              answers[key] = { _tag: "Probability", probability: 0.5 }
            }
          }
          return { answers, usage: { inputTokens: 0, outputTokens: 0 } }
        }),
    }),
  )

const engineLayer = (calls: Ref.Ref<number>): Layer.Layer<DecisionModel.DecisionModel | PlanAnswers | DecisionStats> =>
  Layer.mergeAll(
    countingModel(calls),
    Layer.succeed(PlanAnswers, {
      get: () => Effect.succeed(Option.none()),
      put: () => Effect.void,
    }),
    Layer.succeed(DecisionStats, { read: Effect.succeed(totals) }),
  )

it.effect("every planned rule's questions are answered in one request", () =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const report = yield* checkRepository({
      cwd: corpus,
      paths: ["src"],
      // Only the planned rules, so the count is the batch and nothing else. A
      // plain judged rule still calls the model itself.
      rules: [
        "joggle/duplicate-implementation",
        "joggle/duplicate-meaning",
        "joggle/naming-drift",
      ],
      typecheck: false,
      types: "off",
      useTsgo: false,
      cacheDirExplicit: true,
      cacheDir: "/tmp/joggle-engine-test",
      replayUnchanged: false,
      changed: false,
      baselinePath: undefined,
      updateBaselinePath: undefined,
      config: {},
    }).pipe(
      Effect.provide(engineLayer(calls)),
      Effect.provide(tsgoStub),
      Effect.provide(builtIn),
      Effect.provide(nodeLayer),
    )

    // Three planned rules reach the model on this fixture, and their questions
    // travel together: one request for the run, not one per rule.
    expect(yield* Ref.get(calls)).toBe(1)
    // And the findings still arrive.
    expect(report.diagnostics.length).toBeGreaterThan(0)
  }),
)
