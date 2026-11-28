import { describe, expect, test } from "vitest"
import { Effect, Result, Schema } from "effect"
import { Decision } from "effect/ai"
import { MissLedger, type Miss } from "./misses.ts"
import { Registry, missOf, model, questionOf, type SettledResponse } from "./provider.ts"

const ticking = (): (() => number) => {
  let tick = 1_000
  return () => {
    tick += 1
    return tick
  }
}

const Verdict = Decision.classify({
  instructions: "Is this a reimplementation of a primitive the repository already owns?",
  criteria: {
    reimplements: "It reimplements an existing primitive.",
    legitimate_local: "It is a local, legitimate adaptation.",
  },
})

const Score = Decision.probability({
  instructions: "Does the subject deserve a second look?",
  criteria: { false: "No.", true: "Yes." },
})

const definition = Decision.make({
  input: Schema.Struct({ text: Schema.String }),
  decisions: { verdict: Verdict, score: Score },
})

const input = { input: { text: "the candidate" } }

const missFor = (decision: Decision.Any, reason: Miss["reason"]): Miss => ({
  question: questionOf(decision),
  kind: decision._tag,
  labelSet:
    decision._tag === "Classify"
      ? Object.keys(decision.criteria)
      : decision._tag === "Rate"
        ? decision.criteria.map((level) => level.label)
        : ["false", "true"],
  reason,
})

describe("the abstaining provider", () => {
  test("a definition with no heads records one miss per decision and fails with no answers", async () => {
    const ledger = new MissLedger(ticking())
    const registry = new Registry()
    const provider = model({ registry, ledger })

    const result = await Effect.runPromise(Effect.result(provider.decide(definition, input)))

    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      const miss = missOf(result.failure)
      expect(miss?.reason).toBe("no-head")
      expect(miss?.question.tag).toBe("Classify")
    }
    // Both decisions are misses, not one failure that swallowed the other.
    expect(registry.asked).toBe(2)
    expect(ledger.total()).toBe(2)
    expect(
      ledger
        .snapshot()
        .map((row) => row.kind)
        .sort(),
    ).toEqual(["Classify", "Probability"])
  })

  test("a head for one decision and not the other answers one and misses one", async () => {
    const ledger = new MissLedger(ticking())
    const registry = new Registry()
    registry.register("verdict", () => ({
      label: "reimplements",
      probabilities: { reimplements: 0.9, legitimate_local: 0.1 },
      confidence: 0.8,
    }))
    const provider = model({ registry, ledger })

    const settled = (await Effect.runPromise(
      provider.decideSettled(definition, input),
    )) as SettledResponse<typeof definition.decisions>

    expect(Result.isSuccess(settled.outcomes.verdict)).toBe(true)
    expect(Result.isFailure(settled.outcomes.score)).toBe(true)
    // `decideSettled` is what keeps the answer instead of failing the whole batch.
    expect(ledger.total()).toBe(1)
    expect(ledger.snapshot()[0]?.kind).toBe("Probability")
    expect(ledger.snapshot()[0]?.reason).toBe("no-head")
  })

  test("a head that throws is a head-failed miss, not a zero", async () => {
    const ledger = new MissLedger(ticking())
    const registry = new Registry()
    registry.register("verdict", () => {
      throw new Error("the head is not installed")
    })
    registry.register("score", () => ({ probability: 0 }))
    const provider = model({ registry, ledger })

    const settled = await Effect.runPromise(provider.decideSettled(definition, input))

    expect(Result.isFailure(settled.outcomes.verdict)).toBe(true)
    const failed = ledger.snapshot().find((row) => row.kind === "Classify")
    expect(failed?.reason).toBe("head-failed")
    // The other head's real zero is still an answer, and is not recorded as a miss.
    expect(Result.isSuccess(settled.outcomes.score)).toBe(true)
    expect(ledger.snapshot()).toHaveLength(1)
  })

  test("an invalid head answer is a head-failed miss, not a bad answer", async () => {
    const ledger = new MissLedger(ticking())
    const registry = new Registry()
    registry.register("verdict", () => ({
      label: "reimplements",
      probabilities: { reimplements: 0.2, legitimate_local: 0.2 },
    }))
    const provider = model({ registry, ledger })

    const settled = await Effect.runPromise(provider.decideSettled(definition, input))

    expect(Result.isFailure(settled.outcomes.verdict)).toBe(true)
    expect(ledger.snapshot().find((row) => row.kind === "Classify")?.reason).toBe("head-failed")
  })
})

describe("the miss ledger", () => {
  test("render is deterministic and sorts by count then hash", () => {
    const first = new MissLedger(ticking())
    const left = missFor(Verdict, "no-head")
    const right = missFor(Score, "head-failed")
    first.record(left)
    first.record(right)
    first.record(left)

    const rendered = first.render()
    expect(rendered).toBe(first.render())
    const lines = rendered.split("\n")
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("2 questions")
    expect(lines[0]).toContain("no-head")
    expect(lines[0]).toContain(left.question.hash)
    expect(lines[0]).toContain("['reimplements','legitimate_local']")

    // A different insertion order, same rows: the output is the same bytes.
    const second = new MissLedger(ticking())
    second.record(right)
    second.record(left)
    second.record(left)
    expect(second.render()).toBe(rendered)
  })

  test("a malformed ledger decodes to empty rather than throwing", () => {
    const decoded = MissLedger.decode("{not json")
    expect(decoded.snapshot()).toEqual([])
    expect(decoded.total()).toBe(0)
  })
})
