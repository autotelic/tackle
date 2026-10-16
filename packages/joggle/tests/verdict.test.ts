import { describe, expect, it } from "vitest"
import { verdictOf } from "../src/verdict.ts"

/**
 * One reduction from any answer to P(this rule is violated).
 *
 * A Choice is relative (its probabilities distribute over the labels), a Noul is
 * absolute (its probability is already the answer), and the two are not
 * comparable as numbers -- which is why the violating labels are declared per
 * question rather than assumed.
 */
describe("verdictOf", () => {
  it("sums the mass on the violating labels of a Choice", () => {
    const verdict = verdictOf(
      {
        _tag: "Classify",
        label: "drift",
        probabilities: { drift: 0.6, two_concepts: 0.3, compatible: 0.1 },
        confidence: 0.8,
      } as never,
      ["drift", "two_concepts"],
    )
    expect(verdict?.probability).toBeCloseTo(0.9)
    expect(verdict?.label).toBe("drift")
    expect(verdict?.margin).toBeCloseTo(0.3)
    expect(verdict?.confidence).toBe(0.8)
  })

  it("treats a Noul's probability as the violation probability", () => {
    const verdict = verdictOf({ _tag: "Probability", probability: 0.18 } as never, [])
    expect(verdict?.probability).toBeCloseTo(0.18)
    expect(verdict?.label).toBeUndefined()
    expect(verdict?.margin).toBe(1)
  })

  it("handles a bare pick with no distribution", () => {
    const yes = verdictOf({ _tag: "Classify", label: "one_concept" } as never, ["one_concept"])
    expect(yes?.probability).toBe(1)
    const no = verdictOf({ _tag: "Classify", label: "coincidental" } as never, ["one_concept"])
    expect(no?.probability).toBe(0)
  })

  it("returns undefined for an answer that carries nothing", () => {
    expect(verdictOf(undefined, ["x"])).toBeUndefined()
  })
})

it("a Noul's agreement becomes its margin", () => {
  // Every ask agreed: a full margin, as a unanimous Choice would have.
  expect(verdictOf({ probability: 0.8, consistency: 1 }, [])?.margin).toBe(1)
  // Two of three: some margin.
  expect(verdictOf({ probability: 0.8, consistency: 2 / 3 }, [])?.margin).toBeCloseTo(1 / 3, 5)
  // An even split: no margin at all, so `qualityOf` flags it for review.
  expect(verdictOf({ probability: 0.8, consistency: 0.5 }, [])?.margin).toBe(0)
  // Asked once: no signal, so the floor is the only gate.
  expect(verdictOf({ probability: 0.8 }, [])?.margin).toBe(1)
})
