import { expect, it } from "@effect/vitest"
import { percentile } from "../src/stats.ts"

it("a percentile is interpolated from the sorted sample", () => {
  expect(percentile([0.9, 0.8, 1], 0)).toBe(0.8)
  expect(percentile([0.9, 0.8, 1], 100)).toBe(1)
  expect(percentile([0.8, 0.9, 1], 50)).toBeCloseTo(0.9)
  expect(percentile([0.8, 1], 75)).toBeCloseTo(0.95)
})

it("an empty sample has no percentile to report", () => {
  expect(percentile([], 99)).toBe(0)
})
