import { defineConfig } from "vitest/config"

// joggle is a one-package project; repos/ holds checkouts we analyse, not code
// we test. Without this, vitest happily discovers every spec in the monorepo
// and exits non-zero on other people's missing dependencies.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules/**", "repos/**", "entropy-machine/**", "tests/fixtures/**"],
  },
})
