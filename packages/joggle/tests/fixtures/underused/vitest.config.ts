import { defineConfig } from "vitest/config"

/** The suite's own numbers. A round literal here is not a re-implementation. */
export default defineConfig({
  test: {
    testTimeout: 30_000,
    hookTimeout: 60_000,
    teardownTimeout: 5_000,
  },
})
