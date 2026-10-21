import fc from "fast-check"
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
      "- `button` — `src/components/ui/button.tsx` — The one button. — composed of `button`",
    )
    expect(markdown).toContain(
      "- `badge` — `src/components/ui/badge.tsx` — composed of `span` _(undocumented)_",
    )
  })

  it("renders the menu's own duplicates and orphans", () => {
    const markdown = renderMenu(
      menu({
        orphans: ["src/components/ui/badge.tsx"],
        duplicates: [{ left: "a.tsx", right: "b.tsx", score: 0.9, basis: "skeleton" }],
      }),
    )
    expect(markdown).toContain("## duplicate candidate pairs (1)")
    expect(markdown).toContain("## orphans (1)")
  })

  it("caps long export and composition lists so the menu stays an index", () => {
    const markdown = renderMenu(
      menu({
        entries: [
          {
            name: "dialog",
            path: "src/components/ui/dialog.tsx",
            tier: "primitive",
            exports: ["A", "B", "C", "D", "E"],
            composedOf: ["a", "b", "c", "d", "e"],
          },
        ],
      }),
    )
    expect(markdown).toContain("exports `A`, `B`, `C` +2 more")
    expect(markdown).toContain("composed of `a`, `b`, `c`, `d` +1 more")
  })

  it("keeps every entry name in the rendered index", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            name: fc.string({ minLength: 1 }),
            path: fc.string(),
            tier: fc.constantFrom("primitive", "shared", "local"),
            composedOf: fc.array(fc.string()),
          }),
          { maxLength: 10 },
        ),
        (entries) => {
          const markdown = renderMenu(menu({ entries }))
          return entries.every((entry) => markdown.includes(`\`${entry.name}\``))
        },
      ),
    )
  })

  it("renders health, adoption, lifecycle and clusters", () => {
    const markdown = renderMenu(
      menu({
        health: {
          parts: 2,
          sharedReach: 0.5,
          localOnly: 1,
          duplicateClusters: 1,
          documented: 1,
          deprecatedInUse: 1,
        },
        clusters: [
          {
            canonical: "src/components/ui/button.tsx",
            name: "button",
            members: ["src/components/ui/button.tsx", "src/components/ui/old-button.tsx"],
            score: 0.92,
            usedBy: 7,
          },
        ],
        entries: [
          {
            name: "button",
            path: "src/components/ui/button.tsx",
            tier: "primitive",
            exports: ["Button"],
            usedBy: 7,
            status: "deprecated",
            useInstead: ["IconButton"],
            whenToUse: "A primary action.",
            composedOf: ["button"],
          },
        ],
      }),
    )
    expect(markdown).toContain("## health")
    expect(markdown).toContain("1 documented (50%)")
    expect(markdown).toContain("50% of local UI modules import a shared part")
    expect(markdown).toContain("1 deprecated part still imported")
    expect(markdown).toContain("exports `Button`")
    expect(markdown).toContain("7 importers")
    expect(markdown).toContain("when: A primary action.")
    expect(markdown).toContain("status: deprecated")
    expect(markdown).toContain("use IconButton instead")
    expect(markdown).toContain("## duplicate clusters (1)")
    expect(markdown).toContain("keep `src/components/ui/button.tsx`")
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
