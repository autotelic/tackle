import { describe, expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { astroRegions, blankOutside, componentName } from "../src/astro.ts"
import { resolve } from "node:path"
import { discoverFiles, loadWorkspace } from "../src/workspace.ts"

const astroWorkspace = () =>
  Effect.runPromise(loadWorkspace("tests/fixtures/astro", ["src"]).pipe(Effect.provide(NodeServices.layer)))

const read = (text: string): ReadonlyArray<string> =>
  astroRegions(text).map((region) => text.slice(region.start, region.end))

describe("astroRegions", () => {
  test("the frontmatter is read, without its fences", () => {
    expect(read("---\nconst a = 1\n---\n<p>{a}</p>\n")).toEqual(["const a = 1\n"])
  })

  test("a file with no frontmatter has none", () => {
    expect(read("<p>hello</p>\n")).toEqual([])
  })

  test("a --- in the template is not a fence", () => {
    expect(read("<p>a</p>\n---\nconst b = 2\n---\n")).toEqual([])
  })

  test("script blocks are read after the frontmatter, in order", () => {
    const text = "---\nconst a = 1\n---\n<script>\nconst b = 2\n</script>\n<script type=\"module\">const c = 3</script>\n"
    expect(read(text)).toEqual(["const a = 1\n", "\nconst b = 2\n", "const c = 3"])
  })

  test("a script that is data or injected HTML is not read", () => {
    const text =
      "<script type=\"application/ld+json\">{\"a\":1}</script>\n<script set:html={x}></script>\n<script is:inline>const d = 4</script>\n"
    expect(read(text)).toEqual(["const d = 4"])
  })
})

describe("blankOutside", () => {
  test("keeps length, newlines and the regions, and blanks the rest", () => {
    const text = "---\nconst a = 1\n---\n<p>—</p>\n"
    const blanked = blankOutside(text, astroRegions(text))
    expect(blanked.length).toBe(text.length)
    expect(blanked).toBe("   \nconst a = 1\n   \n        \n")
  })
})

describe("parsing .astro files", () => {
  test("frontmatter declarations are units with their real text and lines", async () => {
    const workspace = await astroWorkspace()
    const heading = workspace.units.find((unit) => unit.name === "heading")
    expect(heading?.file).toBe("src/components/Card.astro")
    expect(heading?.location.line).toBe(11)
    expect(heading?.text).toBe("(): string => formatTitle(title)")
  })

  test("a script's declarations are units, located past non-ASCII template text", async () => {
    const workspace = await astroWorkspace()
    const toggle = workspace.units.find((unit) => unit.name === "toggleCard")
    expect(toggle?.file).toBe("src/components/Card.astro")
    expect(toggle?.location.line).toBe(17)
    expect(toggle?.text.startsWith("function toggleCard")).toBe(true)
  })

  test("a top-level return in the frontmatter is allowed", async () => {
    const workspace = await astroWorkspace()
    expect(workspace.units.some((unit) => unit.name === "destination")).toBe(true)
  })

  test("any other syntax error leaves the file unparsed, and says so", async () => {
    const workspace = await astroWorkspace()
    expect(workspace.unparsed.map((file) => file.path)).toEqual(["src/pages/broken.astro"])
  })

  test("a component's name comes from its file", () => {
    expect(componentName("src/components/cards/ProjectCard.astro")).toBe("ProjectCard")
    expect(componentName("src/pages/[slug].astro")).toBe("Slug")
    expect(componentName("src/pages/work/index.astro")).toBe("Index")
    expect(componentName("src/pages/not-found.astro")).toBe("NotFound")
  })

  test("an .astro file's Props is named after the component, at its real line", async () => {
    const workspace = await astroWorkspace()
    const props = workspace.units.find(
      (unit) => unit.file === "src/components/Card.astro" && unit.kind === "interface",
    )
    expect(props?.name).toBe("CardProps")
    expect(props?.location.line).toBe(5)
    expect(props?.text.startsWith("interface Props")).toBe(true)
    expect(workspace.units.some((unit) => unit.name === "Props")).toBe(false)
  })

  test("an import of an .astro file resolves to it", async () => {
    const workspace = await astroWorkspace()
    const edge = workspace.imports.edges.find((entry) => entry.specifier === "../components/Card.astro")
    expect(edge?.resolution).toBe("resolved")
    expect(edge?.to).toBe("src/components/Card.astro")
  })
})

test("with no paths, .astro files join tsgo's list, within tsconfig and outside .gitignore", async () => {
  const root = resolve("tests/fixtures/astro")
  const fromTsgo = [resolve(root, "src/utils/use-card.ts")]
  const found = await Effect.runPromise(
    discoverFiles(root, [], fromTsgo).pipe(Effect.provide(NodeServices.layer)),
  )
  const relative = found.files.map((file) => file.slice(root.length + 1)).sort()
  expect(relative).toEqual([
    "src/components/Card.astro",
    "src/pages/redirect.astro",
    "src/utils/use-card.ts",
  ])
})
