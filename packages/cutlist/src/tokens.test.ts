import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { cssVariableKind } from "./tokens.ts"

describe("cssVariableKind", () => {
  it("reads the buckets a Tailwind :root block mixes together", () => {
    expect(cssVariableKind("background")).toBe("color")
    expect(cssVariableKind("font-display")).toBe("type")
    expect(cssVariableKind("radius")).toBe("shape")
    expect(cssVariableKind("spacing-page")).toBe("spacing")
    expect(cssVariableKind("nav-height")).toBe("none")
  })

  it("answers only the four buckets", () => {
    fc.assert(
      fc.property(fc.string(), (name) => {
        const kind = cssVariableKind(name)
        return ["color", "type", "shape", "spacing", "none"].includes(kind)
      }),
    )
  })
})
