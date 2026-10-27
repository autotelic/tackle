import { describe, expect, it } from "vitest"
import { importerGraph, renderEdgesOf } from "./catalog.ts"
import { parseModule } from "./crawl.ts"
import { stripSourceExtension } from "./paths.ts"

/*
 * The render edge is the fact the catalog used to discard: a JSX name plus the import that
 * makes it a part. These tests pin the two things that can go wrong quietly — resolving the
 * wrong module in a multi-root tree, and inventing an edge for a binding that is not one.
 */

const PARTS = [
  "services/ui/app/components/Card.tsx",
  "services/ui/app/routes/dashboard/route.tsx",
  "services/auth-ui/app/components/Card.tsx",
] as const

const byBase = (): ReadonlyMap<string, string> => {
  const index = new Map<string, string>()
  for (const path of PARTS) index.set(stripSourceExtension(path), path)
  return index
}

const edgesOf = ({
  path,
  text,
  alias = {},
  roots = ["services/ui/app", "services/auth-ui/app"],
}: {
  readonly path: string
  readonly text: string
  readonly alias?: Readonly<Record<string, ReadonlyArray<string>>>
  readonly roots?: ReadonlyArray<string>
}) =>
  renderEdgesOf({
    module: parseModule({ filename: path, text }),
    byBase: byBase(),
    alias,
    roots,
  })

describe("parseModule import bindings", () => {
  const module = parseModule({
    filename: "app/route.tsx",
    text: `
import { Card } from "./components/Card.tsx"
import Default, { Named as Alias } from "./components/Card.tsx"
import * as UI from "./components/Card.tsx"
import type { Props } from "./components/Card.tsx"
`,
  })

  it("keeps the local name each specifier binds", () => {
    const bindings = module.importEdges.flatMap((edge) => edge.bindings)
    expect(bindings).toContain("Card")
    expect(bindings).toContain("Default")
    expect(bindings).toContain("Alias")
    // A namespace binding names the module's exports, not the part, and a type import is
    // erased before runtime; neither can name a rendered part.
    expect(bindings).not.toContain("UI")
    expect(bindings).not.toContain("Props")
  })

  it("records where each JSX element was written", () => {
    const withJsx = parseModule({
      filename: "app/route.tsx",
      text: `export const A = () => (\n  <div>\n    <Card />\n  </div>\n)\n`,
    })
    expect(withJsx.renders).toContainEqual({ tag: "Card", line: 3 })
  })
})

describe("renderEdgesOf", () => {
  it("resolves a relative import to the part, with the line of first use", () => {
    const edges = edgesOf({
      path: "services/ui/app/routes/dashboard/route.tsx",
      text: `
import { Card } from "../../components/Card.tsx"
export const Route = () => (
  <section>
    <Card />
    <Card />
  </section>
)
`,
    })
    expect(edges).toEqual([
      {
        part: "services/ui/app/components/Card.tsx",
        tag: "Card",
        line: 5,
        count: 2,
      },
    ])
  })

  it("prefers the alias target in the importer's own root", () => {
    const edges = edgesOf({
      path: "services/auth-ui/app/routes/login/route.tsx",
      text: `
import { Card } from "~/components/Card"
export const Route = () => <Card />
`,
      alias: { "~/*": ["services/ui/app/*", "services/auth-ui/app/*"] },
    })
    expect(edges.map((edge) => edge.part)).toEqual(["services/auth-ui/app/components/Card.tsx"])
  })

  it("makes no edge for a namespace binding, a local declaration, or a host tag", () => {
    const edges = edgesOf({
      path: "services/ui/app/routes/dashboard/route.tsx",
      text: `
import * as UI from "../../components/Card.tsx"
const Local = () => <div />
export const Route = () => (
  <UI.Card>
    <Local />
    <div />
  </UI.Card>
)
`,
    })
    // Three wrong-edge opportunities, three refusals. A guessed edge is worse than none:
    // the reader is a mock author who stops looking once the tool has answered.
    expect(edges).toEqual([])
  })

  it("does not draw an edge from a module to itself", () => {
    const edges = edgesOf({
      path: "services/ui/app/components/Card.tsx",
      text: `
import { Card } from "./Card.tsx"
export const Nested = () => <Card />
`,
    })
    expect(edges).toEqual([])
  })

  it("agrees with the use-graph about which module an alias names", () => {
    const route = parseModule({
      filename: "services/ui/app/routes/dashboard/route.tsx",
      text: `import { Card } from "~/components/Card"\nexport const Route = () => <Card />\n`,
    })
    const card = parseModule({ filename: "services/ui/app/components/Card.tsx", text: "" })
    const graph = importerGraph([route, card], { "~/*": ["services/ui/app/*"] }, [
      "services/ui/app",
    ])
    const edges = renderEdgesOf({
      module: route,
      byBase: byBase(),
      alias: { "~/*": ["services/ui/app/*"] },
      roots: ["services/ui/app"],
    })
    expect([...graph.keys()]).toEqual(edges.map((edge) => edge.part))
  })
})
