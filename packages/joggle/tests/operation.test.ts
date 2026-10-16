import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { derivedOperation, permitted, settle } from "../src/operation.ts"
import { loadWorkspace } from "../src/workspace.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

/* -------------------------------------------------------------------------- */
/* the table                                                                   */
/* -------------------------------------------------------------------------- */

test("the table reads the answers, and it is a policy rather than a proof", () => {
  // A name declared twice, and the difference is a constant: merge.
  expect(derivedOperation({ candidate: "duplicated", oneThing: 0.9, difference: "value" })).toBe("merge")
  // The difference is a meaning: the shared part moves somewhere both can reach.
  expect(derivedOperation({ candidate: "duplicated", oneThing: 0.9, difference: "meaning" })).toBe("move")
  // The model said these are two things, which is a verdict.
  expect(derivedOperation({ candidate: "duplicated", oneThing: 0.2, difference: "value" })).toBeUndefined()
  // The evidence does not say what the difference is, so the table has no opinion.
  expect(derivedOperation({ candidate: "duplicated", oneThing: 0.9, difference: "unclear" })).toBeUndefined()
  // One name with two meanings has exactly one repair.
  expect(derivedOperation({ candidate: "overloaded", oneThing: 0.9, difference: "value" })).toBe("split")
  // Logic in the wrong place moves, whatever the other answers say.
  expect(derivedOperation({ candidate: "misplaced", oneThing: 0.9, difference: "value" })).toBe("move")
})

/* -------------------------------------------------------------------------- */
/* the constraint                                                              */
/* -------------------------------------------------------------------------- */

test("a merge is not permitted across packages", async () => {
  const permittedSets = await run(
    Effect.gen(function* () {
      const same = yield* loadWorkspace("tests/fixtures/cascade", ["src"])
      const split = yield* loadWorkspace("tests/fixtures/two-packages", ["packages"])
      const inSame = same.units.filter((unit) => unit.name === "loadTask")
      const inSplit = split.units.filter((unit) => unit.name === "loadTask")
      return {
        same: permitted(same, inSame),
        split: permitted(split, inSplit),
        splitPackages: inSplit.map((unit) => unit.file),
      }
    }),
  )
  // One package: the copies can reach each other, so both operations are open.
  expect(permittedSets.same).toEqual(["merge", "move"])
  // Two packages: the model may only propose the move, because a merge would ask
  // one package to import from another that cannot depend on it.
  expect(permittedSets.split).toEqual(["move"])
  expect(permittedSets.splitPackages).toEqual([
    "packages/left/index.ts",
    "packages/right/index.ts",
  ])
})

/* -------------------------------------------------------------------------- */
/* the gate                                                                    */
/* -------------------------------------------------------------------------- */

test("agreement is evidence, and disagreement is a signal", () => {
  const agree = settle({ derived: "merge", proposed: "merge", margin: 0.6, confidence: 0.9 })
  expect(agree.operation).toBe("merge")
  expect(agree.quality).toBe("act")
  expect(agree.reason).toContain("agree")

  const disagree = settle({ derived: "merge", proposed: "move", margin: 0.6, confidence: 0.9 })
  expect(disagree.operation).toBe("move")
  expect(disagree.quality).toBe("review")
  expect(disagree.reason).toContain("table says merge")
  expect(disagree.reason).toContain("model says move")

  // The model declined: that is a verdict, so there is no operation.
  const declined = settle({ derived: "merge", proposed: undefined, margin: 0.6, confidence: 0.9 })
  expect(declined.operation).toBeUndefined()
  expect(declined.quality).toBe("drop")

  // The table had no opinion, so the model's read is the only one there is.
  const alone = settle({ derived: undefined, proposed: "move", margin: 0.6, confidence: 0.9 })
  expect(alone.operation).toBe("move")
  expect(alone.quality).toBe("act")
  expect(alone.reason).toContain("stands alone")
})
