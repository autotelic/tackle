import { describe, expect, it } from "vitest"
import {
  agreement,
  fragmentSetHash,
  partition,
  splitReport,
  summarizeCalibration,
  withholdDuplicates,
  type Observation,
} from "../src/calibration.ts"

/**
 * A question is worth its gate when it answers near 0 or near 1 on real states.
 * One that sits in the middle is guessing; one that fires on most is too loose.
 */
describe("summarizeCalibration", () => {
  it("is decisive when answers land at both ends", () => {
    const summary = summarizeCalibration([0, 0.05, 0, 1, 0.95, 1].map((probability) => ({ probability, acted: probability >= 0.5 })))
    expect(summary.verdict).toBe("decisive")
    expect(summary.states).toBe(6)
    expect(summary.fired).toBe(3)
    expect(summary.median).toBeCloseTo(0.5)
    expect(summary.min).toBe(0)
    expect(summary.max).toBe(1)
  })

  it("is weak when answers sit in the middle", () => {
    const summary = summarizeCalibration([0.3, 0.4, 0.45, 0.35, 0.5].map((probability) => ({ probability, acted: false })))
    expect(summary.verdict).toBe("weak")
  })

  it("is noisy when it fires on most states", () => {
    const summary = summarizeCalibration([0.9, 0.8, 0.7, 0.95, 0.85, 0.9].map((probability) => ({ probability, acted: true })))
    expect(summary.verdict).toBe("noisy")
    expect(summary.fired).toBe(6)
  })

  it("is skipped below a handful of states", () => {
    expect(summarizeCalibration([0.9, 0.9].map((probability) => ({ probability, acted: true }))).verdict).toBe("skipped")
    expect(summarizeCalibration([]).verdict).toBe("skipped")
  })
})

/**
 * Rung 0: the numbers must survive their own test. The corpus repeats itself, so
 * a split on the candidate's name puts the same evidence on both sides. Split on
 * the decision cache key instead, and withhold exact duplicates first.
 */
describe("the split", () => {
  const observation = (atom: string, key: string, fragments: string, label = "one_concept"): Observation => ({
    atom,
    key,
    fragments: fragmentSetHash([fragments]),
    label,
  })

  it("lands the same answer planted under two atoms on exactly one side", () => {
    // Two declarations with the same body: different atoms, one state. The answer
    // was recorded twice because the ledger keys on the atoms; it is one
    // observation, and the split must not answer it from its own duplicate.
    const planted = [
      observation("src/a.ts#Shape", "key-1", "shape-body"),
      observation("src/b.ts#Shape", "key-1", "shape-body"),
    ]
    const deduped = withholdDuplicates(planted)
    expect(deduped.observations).toHaveLength(1)
    expect(deduped.collapsed).toBe(1)
    const keys = partition(deduped.observations, (one) => one.key)
    expect(keys.train.length + keys.test.length).toBe(1)

    // The old atom-keyed partition can split the same pair: find two atoms whose
    // stable sides disagree, which is the leak rung 0 exists to expose.
    const first = observation("atom-0", "key-2", "shape-body")
    let straddled: readonly [Observation, Observation] | undefined
    for (let index = 1; index < 1000 && straddled === undefined; index += 1) {
      const second = observation("atom-" + String(index), "key-2", "shape-body")
      const atoms = partition([first, second], (one) => one.atom)
      if (atoms.train.length === 1) straddled = [first, second]
    }
    expect(straddled).toBeDefined()
    if (straddled === undefined) return
    const atoms = partition(straddled, (one) => one.atom)
    expect(atoms.train).toHaveLength(1)
    expect(atoms.test).toHaveLength(1)
  })

  it("withholds an exact duplicate by fragment set and counts it", () => {
    const report = splitReport([
      observation("a", "key-1", "one-body"),
      observation("b", "key-2", "one-body"),
      observation("c", "key-3", "another-body", "coincidental"),
    ])
    expect(report.observations).toBe(3)
    expect(report.withheld).toBe(1)
    expect(report.collapsed).toBe(0)
    // The old number is measured on every observation, duplicates and all.
    expect(report.byAtom.train + report.byAtom.test).toBe(3)
    // The deduped number is measured on what is left.
    expect(report.byKey.train + report.byKey.test).toBe(2)
  })

  it("treats the fragment set as a set, so order does not defeat the dedupe", () => {
    expect(fragmentSetHash(["b", "a", "a"])).toBe(fragmentSetHash(["a", "b"]))
  })

  it("predicts held-out evidence from its duplicate, and says so", () => {
    const train = [
      observation("a", "key-1", "same", "yes"),
      observation("b", "key-2", "other", "no"),
    ]
    const test = [observation("c", "key-3", "same", "yes")]
    expect(agreement({ train, test })).toEqual({ train: 2, test: 1, agreed: 1, rate: 1 })
  })
})
