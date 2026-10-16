import { describe, expect, it } from "vitest"
import { summarizeCalibration } from "../src/calibration.ts"

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
