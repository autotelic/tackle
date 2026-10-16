import { expect, test } from "vitest"
import type { TypeSafeSchema } from "@effect/ai-typesafe"
import { cacheKeyFor } from "../src/decision.ts"

const payload = (
  state: Record<string, string>,
  repository?: string,
): typeof TypeSafeSchema.SystemOneRequest.Encoded => ({
  model: "jev-latest",
  state: repository === undefined ? state : { ...state, repository },
  questions: {
    verdict: {
      type: "choice",
      instructions: "Should this change?",
      criteria: { a: "It should.", b: "It should not." },
    },
  },
})

const evidence = { file: "src/a.ts" }

test("the declared architecture is part of the key, by construction", () => {
  // It used to be a second argument, and forgetting to pass it replayed every
  // verdict made under the previous architecture. It is now a field of the state
  // being keyed, so there is nothing to forget.
  const under = cacheKeyFor(payload(evidence, "Pages compose bundles."))
  const other = cacheKeyFor(payload(evidence, "There is no React here."))
  expect(other).not.toBe(under)
})

test("declaring no architecture is not the same as declaring an empty one", () => {
  expect(cacheKeyFor(payload(evidence))).not.toBe(cacheKeyFor(payload(evidence, "")))
})

test("the key is stable for the same request", () => {
  expect(cacheKeyFor(payload(evidence, "x"))).toBe(cacheKeyFor(payload(evidence, "x")))
})

test("the key follows the state and the questions", () => {
  expect(cacheKeyFor(payload({ file: "src/a.ts" }, "x"))).not.toBe(
    cacheKeyFor(payload({ file: "src/b.ts" }, "x")),
  )
})

test("property order in the state does not change the key", () => {
  // A judgement must not miss its own cache because a state object was built in a
  // different order, which is what canonicalisation is for.
  expect(cacheKeyFor(payload({ a: "1", b: "2" }))).toBe(cacheKeyFor(payload({ b: "2", a: "1" })))
})
