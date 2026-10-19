import { describe, expect, it } from "vitest"
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

  it("joins authored intent by name", () => {
    const intent = new Map([
      ["button", { summary: "The one button in the app.", useInstead: ["link-button"] }],
    ])
    const menu = projectMenu({ catalog: catalog([component()]), intent })
    expect(menu.entries[0]?.summary).toBe("The one button in the app.")
    expect(menu.entries[0]?.useInstead).toEqual(["link-button"])
  })

  it("leaves a part with no intent undocumented", () => {
    const intent = new Map([["other", { summary: "Nope." }]])
    const menu = projectMenu({ catalog: catalog([component()]), intent })
    expect(menu.entries[0]?.summary).toBeUndefined()
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

  it("rejects a badly typed field rather than half-reading it", () => {
    expect(decodeIntent({ summary: 1 })).toBeUndefined()
    expect(decodeIntent({ useInstead: "other" })).toBeUndefined()
  })
})
