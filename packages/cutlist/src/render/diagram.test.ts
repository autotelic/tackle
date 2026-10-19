import { describe, expect, it } from "vitest"
import { emptyCatalog, type Catalog, type CatalogComponent } from "@autotelic/protocol"
import {
  compositionMermaid,
  hooksMermaid,
  ownersMermaid,
  pageOf,
  renderDiagramIndex,
  renderDiagrams,
  scopeMermaid,
} from "./diagram.ts"

/*
 * The diagrams read the catalog and nothing else, and they read the `signature` the menu
 * flattens. These tests pin the facts that make them trustworthy: a rendered tag resolves to
 * the component it names, the same model renders the same bytes, and the drawing erases the
 * ink that is not data (a duplicate edge, an isolated part) rather than the data itself.
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

/** The ids are positional, so assert on the class statement rather than a particular id. */
const hasClass = (mermaid: string, kind: string): boolean =>
  new RegExp(`^ {2}class .*\\b${kind}$`, "mu").test(mermaid)

describe("compositionMermaid", () => {
  it("resolves a rendered component tag to the component it names", () => {
    const mermaid = compositionMermaid(
      catalog([
        component({ name: "project-toolbar", tier: "shared", signature: ["tag:Card"] }),
        component({ name: "card", signature: ["tag:section"] }),
      ]),
    )
    expect(mermaid).toContain('["card"]')
    expect(mermaid).not.toContain('["Card"]')
    expect(mermaid).toContain('["section"]')
    expect(hasClass(mermaid, "part")).toBe(true)
  })

  it("does not draw a primitive's own element as an edge", () => {
    const mermaid = compositionMermaid(
      catalog([component({ name: "button", signature: ["tag:button"] })]),
    )
    expect(mermaid).toContain('["button"]')
    expect(mermaid).not.toContain("-->")
  })

  it("draws a hook as a dashed edge, not a second component", () => {
    const mermaid = compositionMermaid(catalog([component({ signature: ["hook:useState"] })]))
    expect(mermaid).toContain('["useState"]')
    expect(mermaid).toContain("-.->")
    expect(hasClass(mermaid, "hook")).toBe(true)
  })

  it("draws a repeated render once, because an edge is a fact and not a count", () => {
    const mermaid = compositionMermaid(
      catalog([
        component({ name: "page", signature: ["tag:Card", "tag:Card"] }),
        component({ name: "Card", tier: "shared" }),
      ]),
    )
    expect(mermaid.split("\n").filter((line) => line.includes("-->"))).toHaveLength(1)
  })

  it("leaves an isolated part out of a graph that has edges: the menu is its home", () => {
    const mermaid = compositionMermaid(
      catalog([
        component({ name: "page", signature: ["tag:Card"] }),
        component({ name: "Card", tier: "shared" }),
        component({ name: "unused-helper", tier: "local" }),
      ]),
    )
    expect(mermaid).toContain('["page"]')
    expect(mermaid).not.toContain('["unused-helper"]')
  })

  it("degrades to a list of its parts when there is no composition at all", () => {
    const mermaid = compositionMermaid(
      catalog([component({ name: "one" }), component({ name: "two" })]),
    )
    expect(mermaid).toContain('["one"]')
    expect(mermaid).toContain('["two"]')
    expect(mermaid).not.toContain("-->")
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
    expect(hasClass(mermaid, "hook")).toBe(true)
  })
})

describe("ownersMermaid", () => {
  it("draws an owner to each component it owns", () => {
    const mermaid = ownersMermaid(catalog([component({ owners: ["dashboard"] })]))
    expect(mermaid).toContain('["dashboard"]')
    expect(hasClass(mermaid, "owner")).toBe(true)
    expect(mermaid).toContain("-->")
  })
})

describe("scopeMermaid", () => {
  it("contracts each owner to one node labelled with the size of its subtree", () => {
    const mermaid = scopeMermaid(
      catalog([
        component({ name: "page", owners: ["finance"], signature: ["tag:Card"] }),
        component({ name: "other", owners: ["finance"] }),
        component({ name: "Card", tier: "shared", owners: ["shared"] }),
      ]),
    )
    expect(mermaid).toContain('["finance · 2"]')
    expect(mermaid).toContain('["shared · 1"]')
    expect(mermaid).toContain("-->")
  })

  it("labels a crossing with the number of composition edges behind it", () => {
    const mermaid = scopeMermaid(
      catalog([
        component({ name: "one", owners: ["finance"], signature: ["tag:Card", "tag:Table"] }),
        component({ name: "two", owners: ["finance"], signature: ["tag:Card"] }),
        component({ name: "Card", tier: "shared", owners: ["shared"] }),
        component({ name: "Table", tier: "shared", owners: ["shared"] }),
      ]),
    )
    expect(mermaid).toContain("|3|")
  })

  it("keeps a scope with no crossings, because a scope is data even when it composes nothing", () => {
    const mermaid = scopeMermaid(catalog([component({ name: "page", owners: ["finance"] })]))
    expect(mermaid).toContain('["finance · 1"]')
  })
})

describe("renderDiagrams", () => {
  const sample = (): Catalog =>
    catalog([component({ owners: ["app"], signature: ["hook:useState"] })])

  it("renders every viewpoint through pele when each has data", () => {
    const diagrams = renderDiagrams(sample())
    expect(diagrams.map((diagram) => diagram.name)).toEqual(["composition", "hooks", "owners"])
    for (const diagram of diagrams) expect(diagram.svg.startsWith("<svg")).toBe(true)
  })

  it("titles each panel with its scope and its counts, directly on the panel", () => {
    const [diagram] = renderDiagrams(sample())
    expect(diagram?.mermaid.startsWith("---\ntitle: composition · 2 nodes, 1 edges\n---\n")).toBe(
      true,
    )
  })

  it("is byte-stable for the same model, because `--check` compares these bytes", () => {
    expect(renderDiagrams(sample())).toEqual(renderDiagrams(sample()))
  })

  it("draws nothing for an empty catalog: an empty picture is not a finding", () => {
    expect(renderDiagrams(catalog([]))).toEqual([])
  })

  it("splits a panel that fits `pele` but does not read", () => {
    const dense = catalog([
      component({ name: "a", owners: ["a"], signature: ["tag:Card"] }),
      component({ name: "b", owners: ["b"], signature: ["tag:Card"] }),
      component({ name: "c", owners: ["c"], signature: ["tag:Card"] }),
      component({ name: "Card", tier: "shared" }),
    ])
    const diagrams = renderDiagrams(dense, { nodes: 3 })
    expect(diagrams.some((diagram) => diagram.name === "composition")).toBe(false)
    expect(diagrams.every((diagram) => diagram.nodes <= 3)).toBe(true)
  })

  it("does not subdivide a scope with no edges: there is no smaller graph to find", () => {
    const isolated = catalog(
      Array.from({ length: 10 }, (_, index) =>
        component({ name: `part-${index}`, path: `src/part-${index}.tsx` }),
      ),
    )
    expect(renderDiagrams(isolated, { nodes: 2 })).toEqual([])
  })

  it("draws small multiples of the owners when the whole view does not fit", () => {
    const scoped = catalog([
      component({ name: "alpha", owners: ["a"], signature: ["tag:Card"] }),
      component({ name: "alpine", owners: ["a"], signature: ["tag:Card"] }),
      component({ name: "alto", owners: ["a"], signature: ["tag:Card"] }),
      component({ name: "beta", owners: ["b"], signature: ["tag:Card"] }),
      component({ name: "betamax", owners: ["b"], signature: ["tag:Card"] }),
      component({ name: "beton", owners: ["b"], signature: ["tag:Card"] }),
      component({ name: "Card", tier: "shared" }),
    ])
    const whole = compositionMermaid(scoped).length
    const diagrams = renderDiagrams(scoped, { source: whole })
    expect(diagrams.some((diagram) => diagram.name === "composition")).toBe(false)
    expect(diagrams.some((diagram) => diagram.name.startsWith("composition--a"))).toBe(true)
    expect(diagrams.some((diagram) => diagram.name.startsWith("composition--b"))).toBe(true)
    for (const diagram of diagrams) expect(diagram.svg.startsWith("<svg")).toBe(true)
  })

  it("joins the tree of trees: the contracted overview comes before its owner panels", () => {
    const scoped = catalog([
      component({ name: "alpha", owners: ["a"], signature: ["tag:Card"] }),
      component({ name: "alpine", owners: ["a"], signature: ["tag:Card"] }),
      component({ name: "beta", owners: ["b"], signature: ["tag:Card"] }),
      component({ name: "betamax", owners: ["b"], signature: ["tag:Card"] }),
      component({ name: "Card", tier: "shared" }),
    ])
    const diagrams = renderDiagrams(scoped, { source: compositionMermaid(scoped).length })
    const names = diagrams.map((diagram) => diagram.name)
    const overview = names.indexOf("composition--overview")
    expect(overview).toBeGreaterThanOrEqual(0)
    expect(overview).toBeLessThan(names.findIndex((name) => name.startsWith("composition--a")))
    expect(diagrams[overview]?.edges).toBeGreaterThan(0)
  })
})

describe("pageOf", () => {
  it("groups a flat route file with its route segment, not its URL", () => {
    expect(pageOf("services/ui/app/routes/accounts_.esg-sales.customers_.$customerId.tsx")).toBe(
      "routes/accounts",
    )
  })

  it("uses a nested route's directory as its page", () => {
    expect(pageOf("services/ui/app/routes/dashboard/index.tsx")).toBe("routes/dashboard")
  })

  it("falls back to the directory outside a route root", () => {
    expect(pageOf("services/ui/app/components/ui/button.tsx")).toBe("services/ui/app/components/ui")
  })
})

describe("renderDiagramIndex", () => {
  it("is the macro reading: one row per panel, with its counts", () => {
    const diagrams = renderDiagrams(catalog([component({ signature: ["hook:useState"] })]))
    const index = renderDiagramIndex(diagrams)
    expect(index).toContain("| scope")
    expect(index).toContain("| composition |")
    expect(index).toContain("(./composition.svg)")
    expect(index).toContain("![composition](./composition.svg)")
  })
})
