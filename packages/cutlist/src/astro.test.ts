import fc from "fast-check"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { NodeServices } from "@effect/platform-node"
import { Effect } from "effect"
import { describe, expect, it } from "vitest"
import { buildCatalog } from "./catalog.ts"
import { defaultConfig } from "./config.ts"
import { jsxFriendly, splitAstro } from "./astro.ts"
import { parseModule } from "./crawl.ts"

const CARD = `---
import Button from "./Button.astro"
import { Icon } from "../icons.ts"
interface Props {
  title: string
  tone?: "plain" | "loud"
}
const { title } = Astro.props
---
<!-- a comment -->
<article class:list={["card"]}>
  <h2 set:html={title} />
  <img src="/x.png" alt="">
  <Button href="/go"><Icon name="arrow" />Go</Button>
  <slot />
</article>
<style>
  .card { color: red; }
</style>
<script>
  const x = { a: 1 }
</script>
`

describe("splitAstro", () => {
  it("returns no script when the file has no frontmatter", () => {
    expect(splitAstro("<p>hi</p>")).toEqual({ script: "", template: "<p>hi</p>" })
  })

  it("does not treat a rule lower in the template as a fence", () => {
    const parts = splitAstro("<p>a</p>\n---\n<p>b</p>")
    expect(parts.script).toBe("")
  })

  it("keeps every rendered tag on its original line", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 0, max: 12 }),
        (scriptLines, templateLines) => {
          const script = Array.from({ length: scriptLines }, (_, i) => `const a${i} = ${i}`)
          const filler = Array.from({ length: templateLines }, () => "<p>x</p>")
          const text = ["---", ...script, "---", ...filler, "<Marker />"].join("\n")
          const marker = parseModule({ filename: "x.astro", text }).renders.find(
            (site) => site.tag === "Marker",
          )
          expect(marker?.line).toBe(text.split("\n").length)
        },
      ),
    )
  })
})

describe("jsxFriendly", () => {
  it("blanks style and script bodies without moving lines", () => {
    const out = jsxFriendly("<style>\n.a { b: c }\n</style>\n<p/>")
    expect(out.split("\n").length).toBe(4)
    expect(out).not.toContain("{")
  })

  it("self-closes void elements and leaves closed ones alone", () => {
    expect(jsxFriendly('<img src="a">')).toBe('<img src="a" />')
    expect(jsxFriendly('<img src="a" />')).toBe('<img src="a" />')
    expect(jsxFriendly("<br>")).toBe("<br />")
  })
})

describe("parseModule on an .astro file", () => {
  const module = parseModule({ filename: "src/components/Card.astro", text: CARD })

  it("is a component with a default export", () => {
    expect(module.exports).toEqual(["default"])
    expect(module.declarations.some((d) => d.exported && d.renders)).toBe(true)
  })

  it("reads imports and their bindings from the frontmatter", () => {
    expect(module.imports).toEqual(["../icons.ts", "./Button.astro"])
    expect(module.importEdges.flatMap((edge) => edge.bindings)).toEqual(["Icon", "Button"])
  })

  it("reads rendered tags from the template, with real line numbers", () => {
    expect(module.tags).toContain("Button")
    expect(module.tags).toContain("Icon")
    const button = module.renders.find((site) => site.tag === "Button")
    expect(button?.line).toBe(CARD.split("\n").findIndex((l) => l.includes("<Button")) + 1)
  })

  it("reads props from the Props interface", () => {
    expect(module.props).toEqual(["title", "tone"])
  })

  it("does not read CSS or script bodies as template", () => {
    expect(module.tags).not.toContain("style")
    expect(module.objects.map((o) => o.keys).flat()).not.toContain("a")
  })

  it("survives a frontmatter that returns early", () => {
    const early = parseModule({
      filename: "x.astro",
      text: `---\nimport A from "./A.astro"\nif (!ok) return Astro.redirect("/")\n---\n<A />`,
    })
    expect(early.imports).toEqual(["./A.astro"])
    expect(early.tags).toContain("A")
  })

  it("reads a file with no frontmatter", () => {
    const plain = parseModule({ filename: "x.astro", text: "<main><Hero /></main>" })
    expect(plain.tags).toContain("Hero")
    expect(plain.exports).toEqual(["default"])
  })
})

describe("an Astro tree through buildCatalog", () => {
  const tree = (dir: string): void => {
    mkdirSync(join(dir, "src/components"), { recursive: true })
    mkdirSync(join(dir, "src/pages/work"), { recursive: true })
    mkdirSync(join(dir, "src/pages/_partials"), { recursive: true })
    writeFileSync(join(dir, "src/components/Button.astro"), "---\n---\n<button><slot /></button>\n")
    writeFileSync(
      join(dir, "src/components/Card.astro"),
      '---\nimport Button from "./Button.astro"\ninterface Props { title: string }\n---\n<article><Button>{Astro.props.title}</Button></article>\n',
    )
    writeFileSync(
      join(dir, "src/pages/index.astro"),
      '---\nimport Card from "../components/Card.astro"\n---\n<Card title="Home" />\n',
    )
    writeFileSync(
      join(dir, "src/pages/work/[slug].astro"),
      '---\nimport Card from "../../components/Card.astro"\n---\n<Card title="Work" />\n',
    )
    writeFileSync(join(dir, "src/pages/_partials/Aside.astro"), "<aside />\n")
  }

  const config = {
    ...defaultConfig,
    roots: ["src"],
    tiers: { primitive: [], shared: ["components"], local: ["pages"] },
    tokens: { from: "src/none.css" },
    ownership: { routeOwner: "first-segment", transitive: true },
  } as const

  it("resolves .astro imports into a use-graph, with pages as routes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cutlist-astro-"))
    try {
      tree(dir)
      const catalog = await Effect.runPromise(
        buildCatalog(dir, config).pipe(Effect.provide(NodeServices.layer)),
      )
      const byPath = new Map(catalog.components.map((c) => [c.path, c]))
      expect(byPath.get("src/components/Card.astro")?.usedBy).toBe(2)
      expect(byPath.get("src/components/Button.astro")?.owners).toEqual(["index", "shared", "work"])
      expect(byPath.get("src/pages/index.astro")?.kind).toBe("route")
      expect(byPath.get("src/pages/work/[slug].astro")?.kind).toBe("route")
      expect(byPath.get("src/pages/_partials/Aside.astro")?.kind).not.toBe("route")
      expect(byPath.get("src/components/Card.astro")?.props).toEqual(["title"])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
