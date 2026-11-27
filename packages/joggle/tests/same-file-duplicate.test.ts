import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { modelStub, noul } from "./support.ts"

/**
 * A copy in the same file is the cheapest duplication to see and the easiest to
 * fix, and `distinctFiles: true` made every duplicate rule blind to it: this
 * repository shipped `blocksIn` and `declares` three lines apart with identical
 * bodies, and nothing fired.
 */
it.effect("two identical declarations in one file are one candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/same-file-dup", ["src"])
    const result = yield* plannedDiagnosticsOf(duplicateImplementation, workspace)
    expect(result.diagnostics.length).toBe(1)
    const found = result.diagnostics[0]!
    expect(found.message).toContain("firstNames")
    expect(found.message).toContain("otherNames")
  }).pipe(
    Effect.provide(modelStub({ redundant: noul(0.9) })),
    Effect.provide(NodeServices.layer),
  ),
)
