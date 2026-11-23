import fc from "fast-check"
import { describe, expect, it } from "vitest"

import { normalizeShadeName, paletteToTheme } from "./palette.ts"

const EXCERPT = `// Palette 1
{
  // Primary
  "cyan-050": "#E0FCFF",
  "cyan-100": "#BEF8FD",
  "cyan-500": "#2CB1BC",

  // Neutrals
  "grey-050": "#F0F4F8", // the lightest surface
  "grey-900": "#102A43"
}
`

describe("paletteToTheme", () => {
  it("renders a v4 theme, normalizing 050 to 50 and keeping group comments", () => {
    const render = paletteToTheme({ input: EXCERPT })
    expect(render.ok).toBe(true)
    if (!render.ok) return
    expect(render.css).toBe(
      `@theme {
  /* Palette 1 */
  /* Primary */
  --color-cyan-50: #E0FCFF;
  --color-cyan-100: #BEF8FD;
  --color-cyan-500: #2CB1BC;
  /* Neutrals */
  --color-grey-50: #F0F4F8; /* the lightest surface */
  --color-grey-900: #102A43;
}
`,
    )
    expect(render.colors).toEqual(["cyan-50", "cyan-100", "cyan-500", "grey-50", "grey-900"])
  })

  it("fails on a line it cannot read, rather than guessing", () => {
    const render = paletteToTheme({ input: `{\n  "cyan-050" "#E0FCFF"\n}` })
    expect(render.ok).toBe(false)
    if (render.ok) return
    expect(render.reason).toContain("line 2")
  })

  it("fails on a file with no entries", () => {
    expect(paletteToTheme({ input: "{\n}\n" })).toEqual({
      ok: false,
      reason: "no color entries found",
    })
  })

  it("is deterministic and keeps every value verbatim", () => {
    const namePart = fc.string({
      unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz".split("")),
      minLength: 2,
      maxLength: 8,
    })
    const shade = fc.constantFrom("050", "100", "300", "500", "900")
    const hex = fc
      .string({
        unit: fc.constantFrom(..."0123456789abcdef".split("")),
        minLength: 6,
        maxLength: 6,
      })
      .map((digits) => `#${digits}`)
    const entry = fc.tuple(namePart, shade, hex)
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 20 }), (entries) => {
        const input = `{\n${entries.map(([name, shadeValue, value]) => `  "${name}-${shadeValue}": "${value}",`).join("\n")}\n}`
        const first = paletteToTheme({ input })
        const second = paletteToTheme({ input })
        expect(first).toEqual(second)
        if (!first.ok) return
        for (const [name, shadeValue, value] of entries) {
          const shade = shadeValue === "050" ? "50" : shadeValue
          expect(first.css).toContain(`--color-${name}-${shade}: ${value};`)
        }
      }),
    )
  })
})

describe("normalizeShadeName", () => {
  it("maps 050 to 50 and leaves other names alone", () => {
    expect(normalizeShadeName("cyan-050")).toBe("cyan-50")
    expect(normalizeShadeName("cyan-500")).toBe("cyan-500")
    expect(normalizeShadeName("brand")).toBe("brand")
    expect(normalizeShadeName("neon-green-100")).toBe("neon-green-100")
  })
})
