import { describe, expect, it } from "vitest"
import { decodeMenu, type Menu } from "@autotelic/protocol"
import { renderMenu, renderMenuJson } from "./menu.ts"

/*
 * The menu renderer reads the menu and nothing else. These tests pin the two facts that
 * matter: an authored summary shows, and its absence is flagged; the derived halves
 * (duplicates, orphans) come from the menu, not from a fresh catalog passed alongside.
 */

const menu = (overrides: Partial<Menu> = {}): Menu => ({
  lexicon: { name: "menu", version: 1 },
  title: "UI menu",
  hash: "abc123",
  entries: [
    {
      name: "button",
      path: "src/components/ui/button.tsx",
      tier: "primitive",
      summary: "The one button.",
      composedOf: ["button"],
    },
    {
      name: "badge",
      path: "src/components/ui/badge.tsx",
      tier: "primitive",
      composedOf: ["span"],
    },
  ],
  orphans: [],
  duplicates: [],
  ...overrides,
})

describe("renderMenu", () => {
  it("shows an authored summary and flags a part without one", () => {
    const markdown = renderMenu(menu())
    expect(markdown).toContain(
      "- `button` — `src/components/ui/button.tsx` — The one button. — composed of button",
    )
    expect(markdown).toContain(
      "- `badge` — `src/components/ui/badge.tsx` — composed of span _(undocumented)_",
    )
  })

  it("renders the menu's own duplicates and orphans", () => {
    const markdown = renderMenu(
      menu({
        orphans: ["src/components/ui/badge.tsx"],
        duplicates: [{ left: "a.tsx", right: "b.tsx", score: 0.9, basis: "skeleton" }],
      }),
    )
    expect(markdown).toContain("## duplicate candidates (1)")
    expect(markdown).toContain("## orphans (1)")
  })
})

describe("renderMenuJson", () => {
  it("serializes the model, not a re-derivation", () => {
    // Decoding proves the round trip: the bytes parse back into the same model, so a
    // renderer that emits something the reader cannot read fails here, not in a consumer.
    const parsed = decodeMenu(JSON.parse(renderMenuJson(menu())))
    expect(parsed?.lexicon.name).toBe("menu")
    expect(parsed?.hash).toBe("abc123")
    expect(parsed?.entries[0]).toMatchObject({ name: "button", summary: "The one button." })
  })
})
