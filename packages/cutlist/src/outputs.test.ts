import { describe, expect, it } from "vitest"
import { cutlistDefaultOutput, lexiconRef, type Menu } from "@autotelic/protocol"
import { outputsOf, type Renderings } from "./outputs.ts"

/*
 * The coverage test that would have caught the manifest gap.
 *
 * `--check` skipped `plumb-ui.config.json`, `hooks.md` and `tokens.md` because `build`
 * and the gate kept two hand-written lists. This file asserts the one invariant that
 * makes that impossible: every scalar path the config names is in the table, exactly
 * once. Diagrams are the exception, and they are the exception on purpose — the
 * projection is opt-in, so its files exist only when a directory is named.
 */

const menu: Menu = {
  lexicon: lexiconRef("menu"),
  title: "Menu",
  hash: "hash",
  entries: [],
  orphans: [],
  duplicates: [],
}

const diagrams = [
  ["tools/ui-catalog/diagrams/composition.mmd", "graph"],
  ["tools/ui-catalog/diagrams/composition.svg", "<svg/>"],
  ["tools/ui-catalog/diagrams/README.md", "# Diagrams"],
] as const

const renderings: Renderings = {
  catalog: "{}",
  manifest: "{}",
  menuJson: "{}",
  menu: "# Menu",
  patterns: "# Patterns",
  patternsJson: "{}",
  recipes: "# Recipes",
  recipesJson: "{}",
  hooks: "# Hooks",
  tokens: "# Tokens",
  diagrams: [],
}

describe("outputsOf", () => {
  it("covers every configured file output", () => {
    const files = outputsOf({
      output: cutlistDefaultOutput,
      renderings,
      catalogHash: "hash",
      menu,
    }).map((entry) => entry.file)
    // `intent` is a directory of authored records, not a rendering this table writes.
    const configured = Object.entries(cutlistDefaultOutput)
      .filter(([key]) => key !== "intent")
      .map(([, path]) => path)
    for (const path of configured) expect(files).toContain(path)
  })

  it("renders no diagrams until a directory is configured", () => {
    const off = outputsOf({
      output: cutlistDefaultOutput,
      renderings: { ...renderings, diagrams },
      catalogHash: "hash",
      menu,
    })
    expect(off.some((entry) => entry.file.includes("/diagrams/"))).toBe(false)

    const on = outputsOf({
      output: { ...cutlistDefaultOutput, diagrams: "tools/ui-catalog/diagrams" },
      renderings: { ...renderings, diagrams },
      catalogHash: "hash",
      menu,
    })
    expect(on.map((entry) => entry.file)).toContain("tools/ui-catalog/diagrams/composition.svg")
  })

  it("names every file exactly once", () => {
    const files = outputsOf({
      output: { ...cutlistDefaultOutput, diagrams: "tools/ui-catalog/diagrams" },
      renderings: { ...renderings, diagrams },
      catalogHash: "hash",
      menu,
    }).map((entry) => entry.file)
    expect(new Set(files).size).toBe(files.length)
  })

  it("follows a custom output map rather than the defaults", () => {
    const custom = {
      ...cutlistDefaultOutput,
      catalog: "docs/vocabulary/catalog.json",
      manifest: "docs/vocabulary/plumb-ui.config.json",
      intent: "docs/vocabulary/intent",
    }
    const files = outputsOf({
      output: custom,
      renderings,
      catalogHash: "hash",
      menu,
    }).map((entry) => entry.file)
    expect(files).toContain("docs/vocabulary/catalog.json")
    expect(files).toContain("docs/vocabulary/plumb-ui.config.json")
    expect(files).not.toContain(cutlistDefaultOutput.catalog)
  })
})
