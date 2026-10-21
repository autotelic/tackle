import fc from "fast-check"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import {
  artifactPaths,
  findMatches,
  readArtifact,
  renderMatches,
  renderMenuJson,
  renderSummary,
} from "./menu.ts"

const root = mkdtempSync(join(tmpdir(), "jig-menu-"))
const artifactDir = join(root, "tools", "ui-catalog")
mkdirSync(artifactDir, { recursive: true })

const write = (name: string, value: unknown): void => {
  writeFileSync(join(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`)
}

write("menu.json", {
  lexicon: { name: "menu", version: 1 },
  title: "UI menu",
  hash: "abc123",
  health: {
    parts: 3,
    sharedReach: 0.5,
    localOnly: 1,
    duplicateClusters: 1,
    documented: 1,
    deprecatedInUse: 0,
  },
  entries: [
    {
      name: "dialog",
      path: "src/components/dialog.tsx",
      tier: "primitive",
      kind: "component",
      exports: ["Dialog"],
      usedBy: 4,
      composedOf: ["DialogPrimitive"],
    },
    {
      name: "wizard",
      path: "src/components/wizard",
      tier: "shared",
      kind: "component",
      exports: ["Wizard"],
      usedBy: 1,
      composedOf: [],
    },
  ],
  orphans: [],
  duplicates: [],
})
write("patterns.json", {
  lexicon: { name: "patterns", version: 1 },
  hash: "abc123",
  stable: [
    {
      id: "src/components/dialog",
      name: "dialog",
      kind: "primitive",
      path: "src/components/dialog.tsx",
      stability: 0.8,
      usedBy: 4,
      summary: "The modal primitive.",
      tier: "primitive",
      role: "component",
      owners: [],
      exports: ["Dialog"],
      composedOf: [],
      relations: [],
      factors: {
        tier: 1,
        adoption: 1,
        ownership: 0,
        variant: 0.8,
        documented: 0.3,
      },
    },
  ],
  compositions: [],
  primitives: [],
  shared: [],
  families: [],
  compression: { orphans: [], variants: [], deprecated: [] },
})
write("recipes.json", {
  lexicon: { name: "recipes", version: 1 },
  hash: "abc123",
  features: [],
  parts: [
    {
      id: "src/components/dialog",
      name: "dialog",
      path: "src/components/dialog.tsx",
      kind: "part",
      source: "src/components/dialog.tsx",
      stability: 0.8,
      import: { from: "src/components/dialog", binding: "Dialog", mode: "named" },
      usage: "<Dialog>Example</Dialog>",
      notes: ["4 importer(s)"],
    },
  ],
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe("the jig menu artifact reader", () => {
  const artifact = readArtifact(root)

  it("resolves the default cutlist paths and decodes the menu", () => {
    expect(artifactPaths(root).menuJson).toBe(join(artifactDir, "menu.json"))
    expect(artifact.menu?.hash).toBe("abc123")
    expect(artifact.patterns?.stable).toHaveLength(1)
    expect(artifact.recipes?.parts).toHaveLength(1)
  })

  it("prefers the recipe import and merges the pattern summary", () => {
    const [match] = findMatches(artifact, "dialog", 5)
    expect(match).toMatchObject({
      kind: "part",
      name: "dialog",
      importLine: 'import { Dialog } from "src/components/dialog"',
      usage: "<Dialog>Example</Dialog>",
      summary: "The modal primitive.",
      stability: 0.8,
      usedBy: 4,
    })
  })

  it("finds a feature by its recipe and an entry by its exports", () => {
    const matches = findMatches(artifact, "wizard", 5)
    expect(matches[0]?.name).toBe("wizard")
    expect(matches[0]?.importLine).toBe('import { Wizard } from "src/components/wizard"')
  })

  it("renders a summary, matches, and JSON", () => {
    const summary = renderSummary(artifact, 5)
    expect(summary).toContain("3 parts")
    expect(summary).toContain("stable shape:")
    expect(summary).toContain("dialog")
    const text = renderMatches(artifact, findMatches(artifact, "dialog", 5), "dialog")
    expect(text).toContain("jig menu: 1 match(es)")
    expect(text).toContain('import { Dialog } from "src/components/dialog"')
    const json = JSON.parse(renderMenuJson(artifact, findMatches(artifact, "dialog", 5), "dialog"))
    expect(json.artifact.menuJson).toBe(join(artifactDir, "menu.json"))
    expect(json.matches[0].usage).toBe("<Dialog>Example</Dialog>")
  })

  it("never returns more than the limit", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (limit) => {
        expect(findMatches(artifact, "dialog", limit).length).toBeLessThanOrEqual(limit)
      }),
    )
  })
})
