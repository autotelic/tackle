import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { importerGraph } from "./catalog.ts"
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
    <Combobox value={query} onChange={setQuery}>
      <Combobox.Input />
      <Combobox.Options>
        <Combobox.Option>{label}<CheckIcon /><ChevronUpDownIcon /></Combobox.Option>
      </Combobox.Options>
    </Combobox>
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
