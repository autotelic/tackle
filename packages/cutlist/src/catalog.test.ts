import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { CatalogComponent, PartRole } from "@autotelic/protocol"
import { duplicateCandidates, duplicateClusters, idOfModule, importerGraph } from "./catalog.ts"
import { parseModule, type SourceModule } from "./crawl.ts"
import { ownerOf } from "./owners.ts"
import { skeletonOf } from "./signature.ts"
import { tierOf } from "./tier.ts"

const COMBOBOX = `
import { Combobox } from "@headlessui/react"
import { CheckIcon, ChevronUpDownIcon } from "@heroicons/react/20/solid"
import { useMemo, useState } from "react"

export function Combobox({ items, label }: { items: string[]; label: string }) {
  const [query, setQuery] = useState("")
  const filtered = useMemo(() => items, [items])
  return (
    <div className="wrapper">
      <Combobox value={query} onChange={setQuery}>
        <Combobox.Input />
        <Combobox.Options>
          <Combobox.Option>{label}<CheckIcon /><ChevronUpDownIcon /></Combobox.Option>
        </Combobox.Options>
      </Combobox>
    </div>
  )
}
`

describe("parseModule", () => {
  const module = parseModule({ filename: "app/components/Combobox.tsx", text: COMBOBOX })

  it("reads the behavioral skeleton inputs", () => {
    expect(module.imports).toContain("@headlessui/react")
    expect(module.tags).toContain("Combobox.Input")
    expect(module.tags).toContain("CheckIcon")
    expect(module.hooks).toContain("useState")
    expect(module.exports).toContain("Combobox")
  })

  it("reads destructured props", () => {
    expect(module.props).toEqual(["items", "label"])
  })

  it("keeps the headless wrapper in the skeleton, not generic tags", () => {
    const skeleton = skeletonOf(module)
    expect(skeleton).toContain("uses:@headlessui/react")
    expect(skeleton).toContain("hook:useState")
    expect(skeleton).toContain("tag:Combobox.Input")
    // The wrapper `<div>` is the frame, not the composition. Two components that both
    // render one must not become near-duplicates on that fact alone.
    expect(skeleton).not.toContain("tag:div")
  })
})

describe("idOfModule", () => {
  it("derives an identity from the path, not the colliding name", () => {
    expect(idOfModule("services/ui/app/components/Comments.tsx")).toBe(
      "services--ui--app--components--Comments",
    )
    expect(idOfModule("services/ui/app/routes/dashboard_.$id.tsx")).toBe(
      "services--ui--app--routes--dashboard_.$id",
    )
  })
})

describe("duplicateCandidates", () => {
  const component = (
    path: string,
    signature: ReadonlyArray<string>,
    kind: PartRole = "component",
  ): CatalogComponent => ({
    path,
    name: path,
    tier: "shared",
    owners: [],
    props: [],
    tags: [],
    signature,
    documented: false,
    kind,
    roles: [kind],
  })

  it("does not compare signatures that carry a single fact", () => {
    const candidates = duplicateCandidates(
      [
        component("app/components/FirstDialog.tsx", ["tag:Dialog"]),
        component("app/components/SecondDialog.tsx", ["tag:Dialog"]),
        component("app/components/FirstContext.ts", ["hook:useContext"]),
        component("app/components/SecondContext.ts", ["hook:useContext"]),
      ],
      "app/routes/",
    )
    expect(candidates).toEqual([])
  })

  it("keeps a rich pair that shares enough of its skeleton", () => {
    const signature = ["uses:@headlessui/react", "tag:Combobox", "tag:Combobox.Input"]
    const candidates = duplicateCandidates(
      [
        component("app/components/Combobox.tsx", signature),
        component("app/components/ComboBoxV2.tsx", signature),
      ],
      "app/routes/",
    )
    expect(candidates).toHaveLength(1)
    expect(candidates[0]?.score).toBe(1)
  })

  it("never compares a hook with a component, however alike their skeletons", () => {
    const signature = ["hook:useEffect", "hook:useRef"]
    const candidates = duplicateCandidates(
      [
        component("app/hooks/useFirst.ts", signature, "hook"),
        component("app/hooks/useSecond.ts", signature, "hook"),
        component("app/components/FirstDialog.tsx", ["tag:Dialog", "tag:Dialog.Content"]),
        component("app/components/SecondDialog.tsx", [
          "tag:Dialog",
          "tag:Dialog.Content",
          "hook:useState",
        ]),
      ],
      "app/routes/",
    )
    expect(candidates.map((candidate) => [candidate.left, candidate.right])).toEqual([
      ["app/components/FirstDialog.tsx", "app/components/SecondDialog.tsx"],
      ["app/hooks/useFirst.ts", "app/hooks/useSecond.ts"],
    ])
  })
})

describe("duplicateClusters", () => {
  const component = (path: string, usedBy: number): CatalogComponent => ({
    path,
    name: path,
    tier: "shared",
    owners: [],
    props: [],
    tags: [],
    signature: [],
    documented: false,
    usedBy,
  })

  it("turns connected pairs into one cluster and keeps the most-used member", () => {
    const components = [
      component("app/components/a.tsx", 1),
      component("app/components/b.tsx", 6),
      component("app/components/c.tsx", 2),
    ]
    const clusters = duplicateClusters(components, [
      {
        left: "app/components/a.tsx",
        right: "app/components/b.tsx",
        score: 0.9,
        basis: "skeleton",
      },
      {
        left: "app/components/b.tsx",
        right: "app/components/c.tsx",
        score: 0.8,
        basis: "skeleton",
      },
    ])
    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({
      canonical: "app/components/b.tsx",
      members: ["app/components/b.tsx", "app/components/c.tsx", "app/components/a.tsx"],
      score: 0.9,
      usedBy: 9,
    })
  })

  it("does not make a cluster from a disconnected pair", () => {
    const clusters = duplicateClusters(
      [component("a.tsx", 1), component("b.tsx", 1), component("c.tsx", 1)],
      [{ left: "a.tsx", right: "b.tsx", score: 0.9, basis: "skeleton" }],
    )
    expect(clusters.map((cluster) => cluster.members)).toEqual([["a.tsx", "b.tsx"]])
  })
})

describe("ownerOf", () => {
  const options = {
    root: "app",
    routeDir: "routes",
    sharedRoots: ["components"],
    routeOwner: "first-segment" as const,
  }

  it("collapses a deep route to its first segment", () => {
    expect(ownerOf("app/routes/projects_.$id.sponsors/route.tsx", options)).toBe("projects")
  })

  it("reads a shared-root importer as one owner", () => {
    expect(ownerOf("app/components/PageCard.tsx", options)).toBe("shared")
  })

  it("reads nothing from an unrelated module", () => {
    expect(ownerOf("app/services/db.ts", options)).toBeUndefined()
  })
})

describe("tierOf", () => {
  const options = {
    root: "app",
    primitiveRoots: ["components/ui"],
    sharedRoots: ["components"],
    localRoots: ["routes"],
  }

  it("sends a primitive root to primitive regardless of owners", () => {
    expect(tierOf("app/components/ui/button.tsx", [], options)).toBe("primitive")
  })

  it("promotes two route owners to shared", () => {
    expect(tierOf("app/components/Badge.tsx", ["accounts", "projects"], options)).toBe("shared")
  })

  it("keeps one route owner local", () => {
    expect(tierOf("app/components/Badge.tsx", ["accounts"], options)).toBe("local")
  })
})

describe("importerGraph", () => {
  // Every reader in this workspace imports WITH an extension; the older test data here never
  // did, which is why the graph looked correct while every real component read as an orphan.
  const modules: ReadonlyArray<SourceModule> = [
    parseModule({
      filename: "src/routes/dashboard.tsx",
      text: 'import { Button } from "../components/ui/button.tsx"',
    }),
    parseModule({ filename: "src/components/ui/button.tsx", text: "export function Button() {}" }),
    parseModule({
      filename: "src/components/panel.tsx",
      text: 'import { Button } from "./ui/button"',
    }),
    parseModule({
      filename: "src/components/index.ts",
      text: 'export { Button } from "./ui/button.tsx"',
    }),
    parseModule({
      filename: "src/routes/settings.tsx",
      text: 'import { Panel } from "@/components/panel"',
    }),
  ]
  const alias = { "@/*": ["src/*"] }

  it("matches a specifier that carries a source extension", () => {
    const graph = importerGraph(modules, alias)
    expect([...(graph.get("src/components/ui/button.tsx") ?? [])]).toEqual([
      "src/components/index.ts",
      "src/components/panel.tsx",
      "src/routes/dashboard.tsx",
    ])
  })

  it("matches one that does not, and one written through an alias", () => {
    const graph = importerGraph(modules, alias)
    expect([...(graph.get("src/components/panel.tsx") ?? [])]).toEqual(["src/routes/settings.tsx"])
  })
})

describe("parseModule (property)", () => {
  it("never throws on arbitrary source text", () => {
    fc.assert(
      fc.property(fc.string(), (text) => {
        expect(() => parseModule({ filename: "x.tsx", text })).not.toThrow()
      }),
    )
  })
})
