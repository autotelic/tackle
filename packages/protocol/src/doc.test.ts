import { describe, expect, it } from "vitest"
import fc from "fast-check"
import { emptyCatalog, type Catalog, type CatalogComponent } from "./catalog.ts"
import { decodeIntent, projectMenu } from "./doc.ts"

/*
 * The menu is the one mixed record: derived composition joined with authored intent. These
 * tests pin the join — an entry with no intent stays undocumented, and an entry with one
 * carries exactly the sentence a person wrote.
 */

const component = (overrides: Partial<CatalogComponent> = {}): CatalogComponent => ({
  path: "src/components/ui/button.tsx",
  name: "button",
  tier: "primitive",
  owners: [],
  props: ["variant"],
  tags: ["button"],
  signature: ["tag:button", "hook:useState"],
  documented: true,
  ...overrides,
})

const catalog = (components: ReadonlyArray<CatalogComponent>): Catalog => ({
  ...emptyCatalog("."),
  hash: "abc123",
  components,
})

describe("projectMenu", () => {
  it("derives composition and leaves intent absent", () => {
    const menu = projectMenu({ catalog: catalog([component()]) })
    expect(menu.entries).toEqual([
      {
        name: "button",
        path: "src/components/ui/button.tsx",
        tier: "primitive",
        composedOf: ["button", "useState"],
      },
    ])
    expect(menu.hash).toBe("abc123")
  })

  it("joins authored intent by name when the catalog has no id", () => {
    const intent = new Map([
      ["button", { summary: "The one button in the app.", useInstead: ["link-button"] }],
    ])
    const menu = projectMenu({ catalog: catalog([component()]), intent })
    expect(menu.entries[0]?.summary).toBe("The one button in the app.")
    expect(menu.entries[0]?.useInstead).toEqual(["link-button"])
  })

  it("joins by stable id, so two parts named the same keep their own intent", () => {
    const menu = projectMenu({
      catalog: catalog([
        component({ id: "a--Comments", name: "Comments", path: "a/Comments.tsx" }),
        component({ id: "b--Comments", name: "Comments", path: "b/Comments.tsx" }),
      ]),
      intent: new Map([
        ["a--Comments", { summary: "The first comments panel." }],
        ["b--Comments", { summary: "The second comments panel." }],
      ]),
    })
    expect(menu.entries.map((entry) => entry.summary)).toEqual([
      "The first comments panel.",
      "The second comments panel.",
    ])
    expect(menu.entries.map((entry) => entry.id)).toEqual(["a--Comments", "b--Comments"])
  })

  it("leaves a part with no intent undocumented", () => {
    const intent = new Map([["other", { summary: "Nope." }]])
    const menu = projectMenu({ catalog: catalog([component()]), intent })
    expect(menu.entries[0]?.summary).toBeUndefined()
  })

  it("carries exports, adoption, lifecycle and the catalog's health", () => {
    const menu = projectMenu({
      catalog: {
        ...catalog([
          component({ exports: ["Button"], usedBy: 4 }),
          component({ id: "old", name: "old", path: "old.tsx", usedBy: 1 }),
        ]),
        health: { parts: 2, sharedReach: 0.5, localOnly: 1, duplicateClusters: 1 },
        clusters: [
          {
            canonical: "src/components/ui/button.tsx",
            name: "button",
            members: ["src/components/ui/button.tsx", "old.tsx"],
            score: 0.9,
            usedBy: 5,
          },
        ],
      },
      intent: new Map([
        ["button", { status: "deprecated", useInstead: ["IconButton"], whenToUse: "An action." }],
      ]),
    })
    expect(menu.entries[0]).toMatchObject({
      exports: ["Button"],
      usedBy: 4,
      status: "deprecated",
      useInstead: ["IconButton"],
      whenToUse: "An action.",
    })
    expect(menu.health).toEqual({
      parts: 2,
      sharedReach: 0.5,
      localOnly: 1,
      duplicateClusters: 1,
      documented: 1,
      deprecatedInUse: 1,
    })
    expect(menu.clusters).toHaveLength(1)
  })
})

describe("decodeIntent", () => {
  it("reads a summary", () => {
    expect(decodeIntent({ summary: "Click it." })).toEqual({ summary: "Click it." })
  })

  it("reads alternatives without a summary", () => {
    expect(decodeIntent({ useInstead: ["other"] })).toEqual({ useInstead: ["other"] })
  })

  it("treats an empty record as a miss, not an empty intent", () => {
    expect(decodeIntent({})).toBeUndefined()
  })

  it("reads lifecycle, states and examples", () => {
    expect(
      decodeIntent({
        status: "deprecated",
        states: ["loading", "empty"],
        examples: ["<Button />"],
        whenToUse: "A primary action.",
        whenNotToUse: "A destructive action.",
      }),
    ).toEqual({
      status: "deprecated",
      states: ["loading", "empty"],
      examples: ["<Button />"],
      whenToUse: "A primary action.",
      whenNotToUse: "A destructive action.",
    })
  })

  it("rejects a badly typed field rather than half-reading it", () => {
    expect(decodeIntent({ summary: 1 })).toBeUndefined()
    expect(decodeIntent({ useInstead: "other" })).toBeUndefined()
  })
})

// The projection is one entry per component, carrying that component's own path and name:
// the menu is an index of the catalog, so a projection that dropped or renamed an entry
// would be a lie about the tree rather than a rendering choice.
describe("projectMenu property", () => {
  it("yields one entry per component, with its path", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9]*$/u), { maxLength: 6 }),
        (names) => {
          const components = names.map((name) => component({ path: `src/${name}.ts`, name }))
          const menu = projectMenu({ catalog: catalog(components) })
          expect(menu.entries.length).toBe(components.length)
          expect(menu.entries.map((entry) => entry.path)).toEqual(
            components.map((entry) => entry.path),
          )
        },
      ),
    )
  })
})
