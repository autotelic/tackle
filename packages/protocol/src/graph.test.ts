import { describe, expect, it } from "vitest"
import {
  emptyCatalog,
  type Catalog,
  type CatalogComponent,
  type PartRole,
  type RenderEdge,
} from "./catalog.ts"
import { findParts, nameSimilarity, pagesOfPart, partsOfPage, similarParts } from "./graph.ts"

/*
 * The render graph is one direction stored, two questions answered. These tests use a
 * four-part tree — a route, a wrapper, a leaf, and an unrelated part — because the claims
 * worth pinning are about direction, transitivity, and refusal.
 */

const part = ({
  path,
  name,
  kind = "component",
  renders,
  signature = [],
  usedBy,
}: {
  readonly path: string
  readonly name: string
  readonly kind?: PartRole
  readonly renders?: ReadonlyArray<RenderEdge>
  readonly signature?: ReadonlyArray<string>
  readonly usedBy?: number
}): CatalogComponent => ({
  path,
  name,
  kind,
  roles: [kind],
  tier: kind === "route" ? "local" : "shared",
  owners: [],
  props: [],
  tags: [],
  signature,
  documented: false,
  ...(renders === undefined ? {} : { renders }),
  ...(usedBy === undefined ? {} : { usedBy }),
})

const route = part({
  path: "app/routes/dashboard.tsx",
  name: "dashboard",
  kind: "route",
  renders: [{ part: "app/components/Wrapper.tsx", tag: "Wrapper", line: 10, count: 1 }],
})

const wrapper = part({
  path: "app/components/Wrapper.tsx",
  name: "Wrapper",
  renders: [{ part: "app/components/Leaf.tsx", tag: "Leaf", line: 4, count: 1 }],
  signature: ["tag:Leaf", "hook:useThing"],
})

const leaf = part({
  path: "app/components/Leaf.tsx",
  name: "Leaf",
  signature: ["tag:Leaf"],
})

const other = part({ path: "app/components/Other.tsx", name: "Other", signature: ["tag:Other"] })

const catalog: Catalog = {
  ...emptyCatalog("."),
  components: [route, wrapper, leaf, other],
}

describe("partsOfPage", () => {
  it("separates what the page names from what it shows", () => {
    const view = partsOfPage({ catalog, page: "app/routes/dashboard.tsx" })
    expect(view?.direct.map((edge) => edge.name)).toEqual(["Wrapper"])
    expect(view?.transitive).toEqual([
      {
        path: "app/components/Leaf.tsx",
        name: "Leaf",
        tag: "Leaf",
        line: 4,
        via: "app/components/Wrapper.tsx",
      },
    ])
  })

  it("answers undefined for a part the catalog does not have", () => {
    expect(partsOfPage({ catalog, page: "app/routes/nope.tsx" })).toBeUndefined()
  })

  it("says when the catalog could not answer, rather than claiming a page is empty", () => {
    const stale: Catalog = {
      ...catalog,
      components: [route, wrapper, leaf, other].map(
        ({ renders: _renders, ...component }) => component,
      ),
    }
    const view = partsOfPage({ catalog: stale, page: "app/routes/dashboard.tsx" })
    expect(view?.direct).toEqual([])
    expect(view?.edges).toBe(false)
  })
})

describe("pagesOfPart", () => {
  it("walks up to the route and keeps the chain between them", () => {
    const view = pagesOfPart({ catalog, part: "app/components/Leaf.tsx" })
    expect(view?.direct.map((parent) => parent.name)).toEqual(["Wrapper"])
    expect(view?.routes).toEqual([
      {
        path: "app/routes/dashboard.tsx",
        name: "dashboard",
        via: ["app/components/Wrapper.tsx"],
      },
    ])
  })

  it("stops the walk at a route rather than asking who imports the page", () => {
    const view = pagesOfPart({ catalog, part: "app/components/Wrapper.tsx" })
    expect(view?.routes.map((route) => route.name)).toEqual(["dashboard"])
    expect(view?.routes[0]?.via).toEqual([])
  })
})

describe("nameSimilarity", () => {
  it("reads a compound spelling as the same word", () => {
    expect(nameSimilarity({ left: "TablePanel", right: "Table" })).toBe(0.5)
    expect(nameSimilarity({ left: "ProgressMeter", right: "ProjectProgress" })).toBe(0.5)
    expect(nameSimilarity({ left: "SegmentedTabs", right: "SegmentedControl" })).toBe(0.5)
    // `tab` sits inside `table`; a three-letter prefix is where the rule stops being
    // evidence and starts inventing it.
    expect(nameSimilarity({ left: "SegmentedTabs", right: "Table" })).toBe(0)
  })

  it("is not a synonym table", () => {
    // The mockup spike expected these to match. Nothing in the names says so, and a guess
    // here would be confidently wrong exactly where the author cannot check it.
    expect(nameSimilarity({ left: "ModalShell", right: "Dialog" })).toBe(0)
    expect(nameSimilarity({ left: "Field", right: "InputSection" })).toBe(0)
  })
})

describe("similarParts", () => {
  it("scores structure within one kind and reports the shared composition", () => {
    const candidates = similarParts({ catalog, part: "app/components/Wrapper.tsx" })
    expect(candidates.map((candidate) => candidate.name)).toEqual(["Leaf"])
    expect(candidates[0]?.basis).toBe("skeleton")
    expect(candidates[0]?.shared).toEqual(["tag:Leaf"])
    expect(candidates[0]?.unshared).toEqual(["hook:useThing"])
  })

  it("does not compare a component against the page that renders it", () => {
    const candidates = similarParts({ catalog, part: "app/components/Leaf.tsx" })
    expect(candidates.map((candidate) => candidate.path)).not.toContain(route.path)
  })
})

describe("findParts", () => {
  it("prefers an address to a name, and a name to a path tail", () => {
    expect(findParts(catalog, "Leaf")).toHaveLength(1)
    expect(findParts(catalog, "app/components/Leaf.tsx")[0]?.name).toBe("Leaf")
    expect(findParts(catalog, "components/Leaf")[0]?.name).toBe("Leaf")
  })

  it("returns every part a name could mean rather than picking one", () => {
    const twice: Catalog = {
      ...catalog,
      components: [
        part({ path: "apps/a/Card.tsx", name: "Card" }),
        part({ path: "apps/b/Card.tsx", name: "Card" }),
      ],
    }
    expect(findParts(twice, "Card")).toHaveLength(2)
  })
})
