import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  ageLabel,
  checkpointLabel,
  FRESH_WINDOW_MS,
  freshnessOf,
  overallFreshness,
} from "../src/freshness.ts"

const NOW = Date.parse("2026-11-21T22:50:00.000Z")
const ago = (milliseconds: number): string => new Date(NOW - milliseconds).toISOString()

describe("freshness", () => {
  it("is fresh when the source was observed inside the window", () => {
    expect(freshnessOf({ at: ago(4_000), now: NOW })).toBe("fresh")
  })

  it("is stale when the source cursor is older than the window", () => {
    expect(freshnessOf({ at: ago(FRESH_WINDOW_MS + 1_000), now: NOW })).toBe("stale")
  })

  it("is unobserved when nobody looked, which is not stale and not fresh", () => {
    expect(freshnessOf({ at: undefined, now: NOW })).toBe("unobserved")
    expect(freshnessOf({ at: null, now: NOW })).toBe("unobserved")
    expect(freshnessOf({ at: "", now: NOW })).toBe("unobserved")
    expect(freshnessOf({ at: "not an instant", now: NOW })).toBe("unobserved")
  })

  it("keeps the three values distinct in an aggregate", () => {
    expect(overallFreshness(["unobserved", "unobserved"])).toBe("unobserved")
    expect(overallFreshness(["fresh", "unobserved"])).toBe("fresh")
    expect(overallFreshness(["fresh", "stale", "unobserved"])).toBe("stale")
  })

  it("is fresh exactly when the source is inside the window", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: FRESH_WINDOW_MS * 2 }), (milliseconds) => {
        const expected = milliseconds <= FRESH_WINDOW_MS ? "fresh" : "stale"
        expect(freshnessOf({ at: ago(milliseconds), now: NOW })).toBe(expected)
      }),
    )
  })
})

describe("ages", () => {
  it("names seconds, so a sub-minute age never renders as 0m", () => {
    expect(ageLabel({ at: NOW - 4_000, now: NOW })).toBe("4s ago")
    expect(ageLabel({ at: NOW - 30_000, now: NOW })).toBe("30s ago")
    expect(ageLabel({ at: NOW - 30_000, now: NOW })).not.toBe("0m ago")
    expect(ageLabel({ at: NOW - 12 * 60_000, now: NOW })).toBe("12m ago")
  })

  it("renders every sub-minute age in seconds", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 59_999 }), (milliseconds) => {
        const label = ageLabel({ at: NOW - milliseconds, now: NOW })
        expect(label.endsWith("s ago")).toBe(true)
        expect(label).not.toBe("0m ago")
      }),
    )
  })
})

describe("the checkpoint", () => {
  it("says no checkpoint yet for null, never a zero age", () => {
    const label = checkpointLabel({ checkpoint: null, now: NOW })
    expect(label).toBe("no checkpoint yet")
    expect(label).not.toContain("0m")
  })

  it("names the commit and its age when a checkpoint exists", () => {
    expect(
      checkpointLabel({
        checkpoint: { sha: "9f1c2ab812345", at: ago(12 * 60_000) },
        now: NOW,
      }),
    ).toBe("checkpoint 9f1c2ab8 · 12m ago")
  })
})
