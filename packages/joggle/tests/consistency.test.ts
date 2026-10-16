import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms, layer as atomsLayer } from "../src/atoms.ts"
import { answerPlansRaw, consistencyOf, reduceRepeats } from "../src/plans.ts"
import { decisionStub, planAnswersLayer } from "../src/testing.ts"
import { noul } from "./support.ts"

/**
 * A Noul is asked `policy.decision.consistency.repeats` times in one request,
 * because one yes/no carries no margin. `reduceRepeats` is the reduction; the
 * engine attaches what it returns and `verdictOf` reads it as the margin a
 * Choice gets from its own distribution.
 */
it("the reduction is the mean and the agreement", () => {
  expect(reduceRepeats([0.8, 0.8, 0.2])).toEqual({ probability: 0.6, consistency: 2 / 3 })
  expect(reduceRepeats([0.9, 0.9, 0.9])).toEqual({ probability: 0.9, consistency: 1 })
  expect(reduceRepeats([0.9, 0.1])).toEqual({ probability: 0.5, consistency: 0.5 })
  expect(reduceRepeats([])).toBeUndefined()
})

it.effect("a Noul asked three times comes back with its agreement attached", () =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    const id = yield* atoms.add({ x: 1 })
    const records = yield* answerPlansRaw([
      {
        ruleId: "test/consistency",
        subject: "x",
        concerns: [],
        atoms: [id],
        decisions: {
          q: Decision.probability({
            instructions: "Is `x` one?",
            criteria: { true: "It is one.", false: "It is not." },
          }),
        },
        read: (answers) => answers,
      },
    ])
    const answer = records[0]?.["q"]
    expect(answer).toBeDefined()
    if (answer === undefined) return
    // The stub answers every ask the same way, so the asks agreed and the mean is
    // the answer it gave.
    expect(consistencyOf(answer)).toBe(1)
    expect("probability" in answer ? answer.probability : 0).toBe(0.9)
  }).pipe(
    Effect.provide(atomsLayer),
    Effect.provide(planAnswersLayer),
    Effect.provide(decisionStub({ q: noul(0.9) })),
  ),
)
