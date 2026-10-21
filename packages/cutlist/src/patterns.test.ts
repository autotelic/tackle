import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  emptyCatalog,
  type Catalog,
  type CatalogComponent,
  type CatalogFeature,
  type Intent,
} from "@autotelic/protocol"
import { patternsOf } from "./patterns.ts"

const part = (path: string, overrides: Partial<CatalogComponent> = {}): CatalogComponent => ({
  id: path,
  path,
  name: path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/u, ""),
  tier: "shared",
  owners: [],
  props: [],
  tags: [],
  signature: [],
  documented: false,
  kind: "component",
  ...overrides,
})

const button = part("src/components/ui/button.tsx", {
  tier: "primitive",
  kind: "component",
  exports: ["Button"],
  usedBy: 6,
  signature: ["tag:Button"],
})
const oldButton = part("src/components/old-button.tsx", {
  exports: ["OldButton"],
  usedBy: 2,
  signature: ["tag:Button"],
  feature: "src/components",
})
const page = part("src/routes/page.tsx", { tier: "local", kind: "route" })
const context = part("src/components/context.ts", {
  kind: "context",
  exports: ["ButtonContext"],
})
const feature: CatalogFeature = {
  dir: "src/components",
  name: "Components",
  context: context.path,
  blocks: [oldButton.path],
  hooks: ["useButton"],
  valueKeys: ["state"],
}
const catalog: Catalog = {
  ...emptyCatalog("."),
  hash: "abc123",
  components: [button, oldButton, page, context],
  features: [feature],
  clusters: [
    {
      canonical: button.path,
      name: "button",
      members: [button.path, oldButton.path],
      score: 1,
      usedBy: 8,
    },
  ],
  orphans: [page.path],
  duplicates: [],
}
const intent = new Map<string, Intent>([
  [oldButton.path, { summary: "The old button.", status: "deprecated", useInstead: ["Button"] }],
])

describe("patternsOf", () => {
  const view = patternsOf({ catalog, intent })

  it("keeps the primitive, composition, family, and compression views", () => {
    expect(view.primitives.map((pattern) => pattern.name)).toEqual(["button"])
    expect(view.compositions.map((pattern) => pattern.name)).toEqual(["Components"])
    expect(view.families).toHaveLength(1)
    expect(view.compression.orphans).toEqual([page.path])
    expect(view.compression.deprecated).toEqual([oldButton.path])
    expect(view.compression.variants[0]?.members).toEqual([oldButton.path])
  })

  it("carries authored intent and the facts around it", () => {
    const old = view.primitives
      .concat(view.shared, view.compositions)
      .find((pattern) => pattern.path === oldButton.path)
    expect(old).toMatchObject({
      summary: "The old button.",
      status: "deprecated",
      useInstead: ["Button"],
      usedBy: 2,
    })
    const primitive = view.primitives[0]
    expect(primitive?.stability).toBeGreaterThan(0)
    expect(primitive?.factors.tier).toBe(1)
    expect(old?.relations.some((relation) => relation.kind === "variant-of")).toBe(true)
  })

  it("keeps stability inside the unit interval for arbitrary adoption", () => {
    fc.assert(
      fc.property(fc.nat({ max: 100 }), (usedBy) => {
        const model = patternsOf({
          catalog: { ...catalog, components: [{ ...button, usedBy }] },
          intent: undefined,
        })
        return model.stable.every((pattern) => pattern.stability >= 0 && pattern.stability <= 1)
      }),
    )
  })
})
