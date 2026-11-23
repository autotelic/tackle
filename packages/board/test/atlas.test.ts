/* oxlint-disable plumb/prefer-property-tests -- two fixed manifest trees; each case pins the exact read the board serves. */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { atlasOf, summaryOf } from "../src/atlas.ts"

const scratch = (): string => {
  const root = mkdtempSync(join(tmpdir(), "atlas-"))
  mkdirSync(join(root, "packages", "alpha"), { recursive: true })
  mkdirSync(join(root, "packages", "beta"), { recursive: true })
  writeFileSync(
    join(root, "packages", "alpha", "package.json"),
    JSON.stringify({
      name: "@autotelic/alpha",
      version: "0.1.0",
      description: "Alpha does one thing.",
      scripts: { build: "tsc", test: "vitest run" },
      dependencies: { "@autotelic/beta": "workspace:*", effect: "catalog:" },
    }),
  )
  writeFileSync(
    join(root, "packages", "alpha", "README.md"),
    "# Alpha\n\nAlpha does one thing.\n\n## Usage\n\nRun it.\n",
  )
  writeFileSync(
    join(root, "packages", "beta", "package.json"),
    JSON.stringify({ name: "@autotelic/beta", version: "0.0.0", private: true }),
  )
  return root
}

describe("the atlas reads the workspace", () => {
  it("keeps a package even when its README is missing", async () => {
    const root = scratch()
    try {
      const atlas = await atlasOf({ root, generatedAt: "2026-11-23T00:00:00.000Z" })
      expect(atlas.packages.map((entry) => entry.name)).toEqual([
        "@autotelic/alpha",
        "@autotelic/beta",
      ])
      expect(atlas.packages[1]?.summary).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("keeps only workspace-internal dependency edges", async () => {
    const root = scratch()
    try {
      const atlas = await atlasOf({ root, generatedAt: "2026-11-23T00:00:00.000Z" })
      expect(atlas.edges).toEqual([{ from: "@autotelic/alpha", to: "@autotelic/beta" }])
      expect(atlas.packages[0]?.workspaceDependencies).toEqual(["@autotelic/beta"])
      expect(atlas.packages[0]?.scripts).toEqual(["build", "test"])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("strips the markdown a README uses around its first paragraph", () => {
    expect(summaryOf("# Title\n\nA **bold** [claim](https://example.com).\n")).toBe("A bold claim.")
  })
})
