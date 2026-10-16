import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { meaningSwitchedByFlag } from "../src/rules/meaning-switched-by-flag.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * Two facts: a declared `boolean` field, and a guard whose test names it. Whether
 * a value beside the flag MEANS two things is the question -- not a name pattern
 * like `use*` or `total*`.
 */
const fixture = () => loadWorkspace("tests/fixtures/meaning-switched-by-flag", ["src"])

it.effect("a branch on a boolean field is a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(meaningSwitchedByFlag, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("useSwaDayRate")
    expect(result.diagnostics[0]?.move).toBe("expand")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("meaning_switched", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a flag that only selects behaviour is declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(meaningSwitchedByFlag, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.stage === "declined")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("independent", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
