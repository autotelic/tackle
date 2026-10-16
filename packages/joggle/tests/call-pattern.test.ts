import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { callPattern } from "../src/rules/call-pattern.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/call-pattern", ["src"])

it.effect("a shared call sequence the model reads as one orchestration is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(callPattern, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("same 4 call(s)")
    expect(result.diagnostics[0]?.judged).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("same_orchestration", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a shared sequence the model reads as different inputs is dropped", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(callPattern, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("different inputs"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("different_inputs", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
