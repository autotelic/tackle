import { expect, it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { DecisionModel } from "effect/ai"
import * as AiError from "effect/ai/AiError"
import { decisionError } from "../src/decision.ts"
import {
  containmentPairs,
  exactGroups,
  namePairs,
  rankSpeculative,
  similarPairs,
  worthJudging,
  nameScore,
  sharedWords,
} from "../src/candidates.ts"
import { policy } from "../src/policy.ts"
import { everyFile } from "../src/rule.ts"
import { similarityOf } from "../src/similarity.ts"
import { typeUnits, unitFields } from "../src/workspace.ts"
import { modelStub, noul, withWorkspace } from "./support.ts"
import { NodeServices } from "@effect/platform-node"
import { loadWorkspace } from "../src/workspace.ts"

const key = (unit: { file: string; name: string; kind: string }): string =>
  unit.kind + " " + unit.file + "#" + unit.name

const sorted = (keys: ReadonlyArray<string>): ReadonlyArray<string> => [...keys].sort()

/**
 * The join the engine replaced, written out the way it was: one key, one map.
 *
 * The differential test is the contract: a consolidation that changes which
 * candidates a rule sees is a behaviour change wearing a refactor's clothes.
 */
const bruteForceShape = (
  units: ReadonlyArray<{ kind: string; name: string; file: string; tokens: ReadonlyArray<string>; normalizedHash: string; typeSignature: string; test: boolean }>,
  minTokens: number,
): ReadonlyArray<ReadonlyArray<string>> => {
  const groups = new Map<string, Array<(typeof units)[number]>>()
  for (const unit of units) {
    if (unit.tokens.length < minTokens) continue
    const at = unit.kind + ":" + unit.normalizedHash + ":" + unit.typeSignature
    const existing = groups.get(at)
    if (existing === undefined) groups.set(at, [unit])
    else existing.push(unit)
  }
  return [...groups.values()]
    .filter((group) => new Set(group.map((unit) => unit.file)).size >= 2)
    .filter((group) => !group.every((unit) => unit.test))
    .map((group) => sorted(group.map(key)))
}

it.effect("the exact shape join equals the grouping it replaced", () =>
  withWorkspace((workspace) =>
    Effect.sync(() => {
      const minTokens = policy.duplicateImplementation.minTokens
      const expected = bruteForceShape(workspace.units, minTokens)
      const actual = exactGroups({
        units: workspace.units,
        kinds: ["shape"],
        minTokens,
        distinctFiles: true,
        separateTests: true,
        scope: everyFile,
      }).map((group) => sorted(group.members.map(key)))
      expect(sorted(actual.map((group) => group.join("|")))).toEqual(
        sorted(expected.map((group) => group.join("|"))),
      )
    }),
  ),
)

it.effect("the similarity join equals an all-pairs sweep", () =>
  withWorkspace((workspace) =>
    Effect.sync(() => {
      const { minTokens, minSimilarity, maxSimilarity } = policy.duplicateMeaning
      const eligible = workspace.units.filter((unit) => unit.tokens.length >= minTokens)
      const expected: Array<string> = []
      for (let a = 0; a < eligible.length; a += 1) {
        for (let b = a + 1; b < eligible.length; b += 1) {
          const one = eligible[a]
          const two = eligible[b]
          if (one === undefined || two === undefined) continue
          if (one.file === two.file || one.kind !== two.kind) continue
          if (one.test && two.test) continue
          const score = similarityOf({ left: one.shingles, right: two.shingles })
          if (score < minSimilarity || score > maxSimilarity) continue
          expected.push([key(one), key(two)].sort().join("|"))
        }
      }
      const actual = similarPairs({
        units: workspace.units,
        minTokens,
        minSimilarity,
        maxSimilarity,
        kinds: undefined,
        scope: everyFile,
        separateTests: true,
      }).map((pair) => [key(pair.left), key(pair.right)].sort().join("|"))
      expect(sorted(actual)).toEqual(sorted(expected))
    }),
  ),
)

it.effect("the name join equals an all-pairs family sweep", () =>
  withWorkspace((workspace) =>
    Effect.sync(() => {
      const { minScore, minSharedWords } = policy.namingDrift
      const eligible = workspace.units.filter((unit) => unit.exported)
      const expected: Array<string> = []
      for (let a = 0; a < eligible.length; a += 1) {
        for (let b = a + 1; b < eligible.length; b += 1) {
          const one = eligible[a]
          const two = eligible[b]
          if (one === undefined || two === undefined) continue
          if (one.name === two.name || one.file === two.file || one.kind !== two.kind) continue
          if (one.test && two.test) continue
          if (sharedWords({ one: one.name, two: two.name }) < minSharedWords) continue
          if (nameScore({ one: one.name, two: two.name }) < minScore) continue
          if (!worthJudging({ one: one.name, two: two.name })) continue
          expected.push([key(one), key(two)].sort().join("|"))
        }
      }
      const actual = namePairs({
        units: workspace.units,
        minScore,
        minSharedWords,
        scope: everyFile,
        exportedOnly: true,
      }).map((pair) => [key(pair.left), key(pair.right)].sort().join("|"))
      expect(sorted(actual)).toEqual(sorted(expected))
    }),
  ),
)

it.effect("the containment join equals a subset sweep", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/compose-types", ["src"])
    return yield* Effect.sync(() => {
      const kinds = ["interface", "type"] as const
      const minFields = policy.composeTypes.minFields
      const types = workspace.units.filter(
        (unit) => (kinds as ReadonlyArray<string>).includes(unit.kind) && unitFields(unit).length >= minFields,
      )
      const expected: Array<string> = []
      for (const whole of types) {
        const wholeFields = new Set(unitFields(whole))
        for (const part of types) {
          if (part === whole) continue
          if (unitFields(part).length >= unitFields(whole).length) continue
          if (!unitFields(part).every((field) => wholeFields.has(field))) continue
          expected.push(key(whole) + " <- " + key(part))
        }
      }
      const actual = containmentPairs({
        units: workspace.units,
        kinds: [...kinds],
        minFields,
        maxTypes: policy.composeTypes.maxTypes,
        scope: everyFile,
      }).map((pair) => key(pair.whole) + " <- " + key(pair.part))
      // The engine picks ONE best part per whole; the sweep finds every subset,
      // so the assertion is containment rather than equality.
      for (const found of actual) expect(expected).toContain(found)
      expect(actual.length).toBeGreaterThan(0)
    })
  }).pipe(Effect.provide(NodeServices.layer)),
)

/** A model that records how many requests it was asked. */
const counting = (calls: { count: number }) =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: () => {
        calls.count += 1
        return Effect.fail(
          decisionError(
            ["@autotelic/joggle/testing", "rank"],
            AiError.UnknownError.make({ description: "ranked" }),
          ),
        )
      },
    }),
  )

it.effect("a set inside the budget is never sent for ranking", () => {
  const calls = { count: 0 }
  const items = [
    { item: "first", strength: 0.9, evidence: { names: ["a"], files: ["x.ts"], signal: "s" } },
    { item: "second", strength: 0.1, evidence: { names: ["b"], files: ["y.ts"], signal: "s" } },
  ]
  return rankSpeculative({ items, budget: 2 }).pipe(
    Effect.provide(counting(calls) as Layer.Layer<DecisionModel.DecisionModel>),
    Effect.map((ordered) => {
      expect(ordered).toEqual(["first", "second"])
      expect(calls.count).toBe(0)
    }),
  )
})

it.effect("an over-budget set is ranked in one request and only reordered", () => {
  const calls = { count: 0 }
  const items = [
    { item: "strong", strength: 0.9, evidence: { names: ["a"], files: ["x.ts"], signal: "s" } },
    { item: "weak", strength: 0.1, evidence: { names: ["b"], files: ["y.ts"], signal: "s" } },
  ]
  return rankSpeculative({ items, budget: 1 }).pipe(
    Effect.provide(
      modelStub({
        keep_0: noul(0.1),
        keep_1: noul(0.95),
      }),
    ),
    Effect.map((ordered) => {
      // Both survive: the ranking decides the front of the list, not membership.
      expect(sorted(ordered)).toEqual(["strong", "weak"])
      expect(ordered[0]).toBe("weak")
    }),
  )
})
