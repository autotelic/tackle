import { defineConfig } from "vitest/config"

/**
 * The board's own tests live in `test/`.
 *
 * `view/` is its own workspace package (`@autotelic/board-view`) with its own
 * `vitest run`, and without `dir` the board's run discovers `view/test/**` too
 * and fails every one of those suites with "Vitest failed to find the current
 * suite" -- the files run without the view package's root, so the gate was red on
 * trunk for a directory that is not this package's to run.
 */
export default defineConfig({ test: { dir: "test" } })
