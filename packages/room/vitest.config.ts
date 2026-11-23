import { defineConfig } from "vitest/config"

// Room tests spawn the CLI and real child processes; under a workspace-wide parallel run a
// five-second ceiling measures the machine's load, not the claim under test.
export default defineConfig({ test: { testTimeout: 20_000 } })
