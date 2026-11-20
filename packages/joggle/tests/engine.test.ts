import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Ref } from "effect"
import { DecisionModel } from "effect/ai"
import { checkRepository } from "../src/check.ts"
import { DecisionStats, progressLine } from "../src/decision.ts"
import { PlanAnswers } from "../src/plans.ts"
import { builtIn } from "../src/rules/index.ts"
import { corpus, nodeLayer, tsgoStub } from "./support.ts"

const totals = { requests: 0, replayed: 0, calls: 0, unavailable: 0, inputTokens: 0, outputTokens: 0 }

/*
 * The progress line's two units, and its missing denominator.
 *
 * "findings" and "findings no judgement reached" being added into one number is what made a
 * budget-starved run read as debt, so the line names judged and replayed separately. Before
 * the plans exist there is no honest total, and a wrong denominator is worse than none.
 */
it("renders progress with both units and only a real denominator", () => {
  const known = progressLine({
    requests: 4210,
    calls: 1234,
    replayed: 2976,
    inputTokens: 1_900_000,
    total: 7787,
    budget: 4_000_000,
    elapsedMs: 800_000,
  })
  expect(known).toBe(
    "joggle: 4210/7787 candidate(s) resolved (1234 judged, 2976 replayed) · 1.9M/4.0M input tokens · 13m20s",
  )
  const unknown = progressLine({
    requests: 3,
    calls: 3,
    replayed: 0,
    inputTokens: 400,
    elapsedMs: 1_500,
  })
  expect(unknown).toBe("joggle: 3 candidate(s) resolved (3 judged, 0 replayed) · 400 input tokens · 1s")
})

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
                  decision.criteria.map((level) => [level.label, 1 / decision.criteria.length]),
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
    Layer.succeed(DecisionStats, { read: Effect.succeed(totals), setTotal: () => Effect.void }),
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
