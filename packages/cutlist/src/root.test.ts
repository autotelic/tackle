import { cpSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { buildCatalog } from "./catalog.ts"
import { loadConfig } from "./config.ts"

/*
 * The catalog recorded the absolute path it was crawled from, and that path is inside
 * the hash `--check` compares. The exemplar's committed catalog was therefore current on
 * the machine that generated it and stale on every other, with no change to the tree.
 */

const exemplar = join(import.meta.dirname, "..", "..", "..", "examples", "self")

const catalogAt = (directory: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const config = yield* loadConfig(join(directory, "cutlist.config.json"))
      return yield* buildCatalog(directory, config)
    }).pipe(Effect.provide(NodeServices.layer)),
  )

/** Copy the exemplar's crawled inputs under a fresh directory, at a chosen depth. */
const copyAt = (segments: ReadonlyArray<string>) => {
  const root = mkdtempSync(join(tmpdir(), "cutlist-root-"))
  const at = join(root, ...segments)
  cpSync(join(exemplar, "src"), join(at, "src"), { recursive: true })
  cpSync(join(exemplar, "cutlist.config.json"), join(at, "cutlist.config.json"))
  return { root, at }
}

describe("the catalog does not depend on where it was crawled", () => {
  it("records `.` as its root, so the hash is the same in any checkout", async () => {
    const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,7}$/)
    await fc.assert(
      fc.asyncProperty(
        fc.array(segment, { minLength: 1, maxLength: 3 }),
        fc.array(segment, { minLength: 1, maxLength: 3 }),
        async (left, right) => {
          const one = copyAt(left)
          const two = copyAt(right)
          try {
            const [first, second] = await Promise.all([catalogAt(one.at), catalogAt(two.at)])
            expect(first.root).toBe(".")
            expect(second).toEqual(first)
          } finally {
            rmSync(one.root, { recursive: true, force: true })
            rmSync(two.root, { recursive: true, force: true })
          }
        },
      ),
      { numRuns: 8 },
    )
  })
})
