import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { DecisionModel } from "effect/ai"
import * as AiError from "effect/ai/AiError"
import { NodeServices } from "@effect/platform-node"
import { layer as atomsLayer, type Atoms } from "../src/atoms.ts"
import { decisionError } from "../src/decision.ts"
import type { PlanAnswers } from "../src/plans.ts"
import { reversal } from "../src/rules/reversal.ts"
import { everyFile } from "../src/rule.ts"
import { planAnswersLayer } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

type Model = Layer.Layer<DecisionModel.DecisionModel | Atoms | PlanAnswers>

const fixture = (name: string): string => "tests/fixtures/reversal/" + name

const run = (name: string, model: Model) =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(fixture(name), ["src"])
    return yield* reversal.run(workspace, everyFile, { config: {} })
  }).pipe(Effect.provide(model), Effect.provide(NodeServices.layer))

/**
 * A model that records the encoded STATE it was sent and answers the first
 * criterion.
 *
 * The state, not a typed input: the DecisionModel seam sees the encoded JSON, and
 * that is exactly what the answer cache keys on, so the test reads the same bytes
 * the cache does.
 */
const capturing = (states: Array<string>): Model =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ decisions, state }) => {
        states.push(JSON.stringify(state))
        return Effect.succeed({
          answers: Object.fromEntries(
            Object.entries(decisions).flatMap(([key, decision]) => {
              if (decision._tag !== "Classify") return []
              const label = Object.keys(decision.criteria)[0] ?? ""
              return [
                [
                  key,
                  {
                    _tag: "Classify" as const,
                    label,
                    probabilities: { [label]: 0.95 },
                    confidence: 0.95,
                  },
                ],
              ]
            }),
          ),
          usage: { inputTokens: 0, outputTokens: 0 },
        })
      },
    }),
  ).pipe((layer) => Layer.mergeAll(layer, atomsLayer, planAnswersLayer))

/** A layer that counts requests and refuses, so a stage that must not ask is visible. */
const refusing = (calls: { count: number }): Model =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: () => {
        calls.count += 1
        return Effect.fail(
          decisionError(
            ["@autotelic/joggle/testing", "reversal"],
            AiError.UnknownError.make({ description: "refused" }),
          ),
        )
      },
    }),
  ).pipe((layer) => Layer.mergeAll(layer, atomsLayer, planAnswersLayer))

it.effect("an exact copy stops at contract, and stages 2 and 3 are never asked", () => {
  const calls = { count: 0 }
  return run("copies", refusing(calls)).pipe(
    Effect.map((result) => {
      expect(calls.count).toBe(0)
      expect(result.diagnostics.length).toBe(1)
      expect(result.diagnostics[0]?.stoppedAt).toBe("contract")
      expect(result.diagnostics[0]?.judged).toBe(false)
      expect(result.diagnostics[0]?.message).toContain("Row")
    }),
  )
})

it.effect("a whole that repeats a named part stops at combine, with the part named, and asks nothing", () => {
  const calls = { count: 0 }
  return run("combine", refusing(calls)).pipe(
    Effect.map((result) => {
      expect(calls.count).toBe(0)
      expect(result.diagnostics.length).toBe(1)
      expect(result.diagnostics[0]?.stoppedAt).toBe("combine")
      expect(result.diagnostics[0]?.judged).toBe(false)
      expect(result.diagnostics[0]?.message).toContain("Whole")
      expect(result.diagnostics[0]?.message).toContain("Base")
      expect(result.diagnostics[0]?.message).toContain("extra")
    }),
  )
})

it.effect("a repeated unnamed field set stops at expand", () =>
  run("expand", modelStub({ expand: choice("one_thing", 0.95) })).pipe(
    Effect.map((result) => {
      expect(result.diagnostics.length).toBe(1)
      expect(result.diagnostics[0]?.stoppedAt).toBe("expand")
      expect(result.diagnostics[0]?.message).toContain("active, id, label")
    }),
  ),
)

it.effect("distinct declarations are silence", () => {
  const calls = { count: 0 }
  return run("silent", refusing(calls)).pipe(
    Effect.map((result) => {
      expect(result.diagnostics.length).toBe(0)
      expect(calls.count).toBe(0)
    }),
  )
})

it.effect("the expand stage carries what both earlier stages said", () => {
  const states: Array<string> = []
  return run("expand", capturing(states)).pipe(
    Effect.map(() => {
      expect(states.length).toBe(1)
      const state = JSON.parse(states[0] ?? "{}") as { stage?: unknown; earlier?: unknown }
      expect(state.stage).toBe("expand")
      expect(state.earlier).toEqual([
        { stage: "contract", outcome: "none" },
        { stage: "combine", outcome: "not_applicable" },
      ])
    }),
  )
})

it.effect("a stage's state is the same on a repeat run, so its key is stable", () => {
  const first: Array<string> = []
  const second: Array<string> = []
  return Effect.gen(function* () {
    yield* run("expand", capturing(first))
    yield* run("expand", capturing(second))
    expect(second[0]).toBe(first[0])
  })
})
