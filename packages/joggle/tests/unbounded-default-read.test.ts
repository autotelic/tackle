import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { unboundedDefaultRead } from "../src/rules/unbounded-default-read.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * Three facts: a call whose callee has every filter optional, the callee's
 * declaration, and the data package its file imports. Whether the read is
 * unbounded is the question.
 */
const fixture = () => loadWorkspace("tests/fixtures/unbounded-default-read", ["src"])

it.effect("a call to an all-optional data read is a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unboundedDefaultRead, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("loadRows")
    expect(result.diagnostics[0]?.move).toBeUndefined()
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("unbounded", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a read something bounds is declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unboundedDefaultRead, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.stage === "declined")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("bounded", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
