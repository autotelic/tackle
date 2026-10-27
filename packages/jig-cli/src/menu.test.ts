import fc from "fast-check"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { emptyCatalog } from "@autotelic/protocol"
import {
  answerGraph,
  artifactPaths,
  findMatches,
  readArtifact,
  renderGraphAnswer,
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
  signals: { orphans: [], variants: [], deprecated: [] },
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

describe("graph questions", () => {
  write("catalog.json", {
    ...emptyCatalog(root),
    hash: "abc123",
    sharedRoots: ["src/components"],
    localRoots: ["src/routes"],
    components: [
      {
        id: "src--routes--dashboard",
        path: "src/routes/dashboard.tsx",
        name: "dashboard",
        kind: "route",
        roles: ["component", "route"],
        tier: "local",
        owners: [],
        props: [],
        tags: ["Wrapper"],
        signature: ["tag:Wrapper"],
        documented: false,
        renders: [{ part: "src/components/wrapper.tsx", tag: "Wrapper", line: 3, count: 1 }],
      },
      {
        id: "src--components--wrapper",
        path: "src/components/wrapper.tsx",
        name: "Wrapper",
        kind: "component",
        roles: ["component"],
        tier: "shared",
        owners: ["dashboard"],
        props: [],
        tags: ["Leaf"],
        signature: ["tag:Leaf"],
        documented: false,
        renders: [{ part: "src/components/leaf.tsx", tag: "Leaf", line: 4, count: 1 }],
      },
      {
        id: "src--components--leaf",
        path: "src/components/leaf.tsx",
        name: "Leaf",
        kind: "component",
        roles: ["component"],
        tier: "shared",
        owners: ["dashboard"],
        props: [],
        tags: [],
        signature: ["tag:Leaf"],
        documented: false,
      },
      {
        id: "src--components--table",
        path: "src/components/table.tsx",
        name: "Table",
        kind: "component",
        roles: ["component"],
        tier: "shared",
        owners: ["dashboard"],
        props: [],
        tags: [],
        signature: [],
        documented: false,
      },
    ],
  })
  const withCatalog = readArtifact(root)

  it("reads the catalog without touching the tree", () => {
    expect(withCatalog.catalog?.components).toHaveLength(4)
  })

  it("answers what a page renders, direct and through a child", () => {
    const answer = answerGraph(withCatalog, { kind: "page", ref: "dashboard" })
    expect(answer.ok).toBe(true)
    const text = renderGraphAnswer(answer)
    expect(text).toContain("page `dashboard`")
    expect(text).toContain("direct: `Wrapper`")
    expect(text).toContain("`Leaf` via `src/components/wrapper.tsx`")
  })

  it("answers which routes mount a part", () => {
    const answer = answerGraph(withCatalog, { kind: "part", ref: "leaf" })
    expect(renderGraphAnswer(answer)).toContain("routes: `dashboard`")
  })

  it("answers a name that is not in the catalog yet", () => {
    const answer = answerGraph(withCatalog, { kind: "similar", ref: "TablePanel" })
    expect(answer.ok).toBe(true)
    expect(renderGraphAnswer(answer)).toContain("`Table`")
  })

  it("says why it cannot answer when the catalog is missing", () => {
    const answer = answerGraph(
      { ...withCatalog, catalog: undefined },
      { kind: "page", ref: "dashboard" },
    )
    expect(answer.ok).toBe(false)
    expect(renderGraphAnswer(answer)).toContain("run `cutlist build`")
  })
})
