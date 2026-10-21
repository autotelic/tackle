import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { emptyCatalog, type Catalog, type CatalogComponent } from "@autotelic/protocol"
import { patternsOf } from "../patterns.ts"
import { recipesOf, renderRecipes, renderRecipesJson } from "./recipes.ts"

const base = (path: string, overrides: Partial<CatalogComponent> = {}): CatalogComponent => ({
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

const badge = base("src/components/badge.tsx", {
  tier: "primitive",
  exports: ["default"],
  usedBy: 2,
  props: ["children", "variant"],
})
const hook = base("src/components/use-theme.ts", {
  kind: "hook",
  exports: ["useTheme"],
  usedBy: 1,
})
const provider = base("src/components/theme-provider.tsx", {
  kind: "provider",
  exports: ["ThemeProvider"],
  usedBy: 2,
})
const catalog: Catalog = {
  ...emptyCatalog("."),
  hash: "abc123",
  components: [badge, hook, provider],
  features: [
    {
      dir: "src/components",
      name: "Theme",
      context: "src/components/theme-context.ts",
      provider: provider.path,
      blocks: [],
      hooks: ["useTheme"],
      valueKeys: ["state"],
    },
  ],
  clusters: [],
  orphans: [],
  duplicates: [],
}

describe("recipesOf", () => {
  const view = patternsOf({ catalog, intent: undefined })
  const recipes = recipesOf({ catalog, view })

  it("turns a default export into a default import and a bounded usage", () => {
    const recipe = recipes.parts.find((candidate) => candidate.name === "badge")
    expect(recipe?.import).toMatchObject({
      from: "src/components/badge",
      binding: "Badge",
      mode: "default",
    })
    expect(recipe?.usage).toContain('<Badge variant="…">Example</Badge>')
    expect(recipe?.props).toEqual(["children", "variant"])
  })

  it("imports a hook by name and calls it", () => {
    const recipe = recipes.parts.find((candidate) => candidate.name === "use-theme")
    expect(recipe?.import).toMatchObject({ binding: "useTheme", mode: "named" })
    expect(recipe?.usage).toBe("const value = useTheme()")
  })

  it("writes a feature import, shape, and hook line", () => {
    const recipe = recipes.features[0]
    expect(recipe?.import.from).toBe("src/components/theme-provider")
    expect(recipe?.usage).toContain("<ThemeProvider>")
    expect(recipe?.notes).toContain("const { state } = useTheme()")
  })

  it("renders both the human and machine surfaces", () => {
    const markdown = renderRecipes(recipes)
    expect(markdown).toContain("# Recipes")
    expect(markdown).toContain('import Badge from "src/components/badge"')
    expect(markdown).toContain("```text")
    expect(JSON.parse(renderRecipesJson(recipes)).hash).toBe("abc123")
  })

  it("serializes any adoption count", () => {
    fc.assert(
      fc.property(fc.nat({ max: 100 }), (usedBy) => {
        const model = recipesOf({
          catalog: { ...catalog, components: [{ ...badge, usedBy }] },
          view: patternsOf({
            catalog: { ...catalog, components: [{ ...badge, usedBy }] },
            intent: undefined,
          }),
        })
        return JSON.parse(renderRecipesJson(model)).hash === "abc123"
      }),
    )
  })
})
