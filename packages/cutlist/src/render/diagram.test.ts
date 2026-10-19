import { describe, expect, it } from "vitest"
import { emptyCatalog, type Catalog, type CatalogComponent } from "@autotelic/protocol"
import { compositionMermaid, hooksMermaid, ownersMermaid, renderDiagrams } from "./diagram.ts"

/*
 * The diagrams read the catalog and nothing else, and they read the `signature` the menu
 * flattens. These tests pin the two facts that make them trustworthy: a rendered tag
 * resolves to the component it names, and the same model renders the same bytes.
 */

const component = (overrides: Partial<CatalogComponent> = {}): CatalogComponent => ({
  path: "src/components/ui/button.tsx",
  name: "button",
  tier: "primitive",
  owners: [],
  props: [],
  tags: [],
  signature: [],
  documented: false,
  ...overrides,
})

const catalog = (components: ReadonlyArray<CatalogComponent>): Catalog => ({
  ...emptyCatalog("."),
  hash: "abc123",
  components,
})

describe("compositionMermaid", () => {
  it("resolves a rendered component tag to the component it names", () => {
    const mermaid = compositionMermaid(
      catalog([
        component({ name: "project-toolbar", tier: "shared", signature: ["tag:Card"] }),
        component({ name: "card", signature: ["tag:section"] }),
      ]),
    )
    expect(mermaid).toContain('["card"]:::primitive')
    expect(mermaid).not.toContain('["Card"]')
    expect(mermaid).toContain('["section"]:::part')
  })

  it("does not draw a primitive's own element as an edge", () => {
    const mermaid = compositionMermaid(
      catalog([component({ name: "button", signature: ["tag:button"] })]),
    )
    expect(mermaid).toContain('["button"]:::primitive')
    expect(mermaid).not.toContain("-->")
  })

  it("draws a hook as a dashed edge, not a second component", () => {
    const mermaid = compositionMermaid(catalog([component({ signature: ["hook:useState"] })]))
    expect(mermaid).toContain('["useState"]:::hook')
    expect(mermaid).toContain("-.->")
  })
})

describe("hooksMermaid", () => {
  it("inverts the hook edges so a hook is the subject", () => {
    const mermaid = hooksMermaid(
      catalog([
        component({ name: "card", signature: ["hook:useState"] }),
        component({ name: "button", signature: ["hook:useState"] }),
      ]),
    )
    const edges = mermaid.split("\n").filter((line) => line.includes("-->"))
    expect(edges).toHaveLength(2)
    expect(mermaid).toContain('["useState"]:::hook')
  })
})

describe("ownersMermaid", () => {
  it("draws an owner to each component it owns", () => {
    const mermaid = ownersMermaid(catalog([component({ owners: ["dashboard"] })]))
    expect(mermaid).toContain('["dashboard"]:::owner')
    expect(mermaid).toContain("-->")
  })
})

describe("renderDiagrams", () => {
  const sample = (): Catalog => catalog([component({ signature: ["hook:useState"] })])

  it("renders every viewpoint through pele", () => {
    const diagrams = renderDiagrams(sample())
    expect(diagrams.map((diagram) => diagram.name)).toEqual(["composition", "hooks", "owners"])
    for (const diagram of diagrams) expect(diagram.svg.startsWith("<svg")).toBe(true)
  })

  it("is byte-stable for the same model, because `--check` compares these bytes", () => {
    expect(renderDiagrams(sample())).toEqual(renderDiagrams(sample()))
  })

  it("names an empty graph rather than drawing nothing", () => {
    expect(renderDiagrams(catalog([]))[0]?.mermaid).toContain("nothing to draw")
  })
})
