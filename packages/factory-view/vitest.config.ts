import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const here = dirname(fileURLToPath(import.meta.url))

/**
 * The JSON report is the loop's feature-done contract: it compares this run's test
 * count against the branch's starting count, and a branch whose build never writes
 * one looks like it added no tests at all. `.treadle/` is local state (gitignored),
 * so the artifact travels with the worktree, never with the branch.
 */
export default defineConfig({
  test: {
    root: here,
    reporters: ["default", "json"],
    outputFile: { json: resolve(here, "../../.treadle/reports/unit.json") },
  },
})
