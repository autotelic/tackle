import { describe, expect, it } from "vitest"
import { PATTERN_VALUE_KEYS } from "./catalog.ts"

describe("PATTERN_VALUE_KEYS", () => {
  it("is the tripartite pattern's value shape, in order", () => {
    expect(PATTERN_VALUE_KEYS).toEqual(["state", "actions", "meta"])
  })

  it("is frozen, so a reader cannot rewrite the seam's vocabulary", () => {
    expect(Object.isFrozen(PATTERN_VALUE_KEYS)).toBe(true)
  })
})
