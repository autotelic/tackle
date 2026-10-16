import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { nameThePrimitive } from "../src/rules/name-the-primitive.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * The deterministic half mines the group; the judged half says whether it is one
 * thing. The co-occurrence is a fact; "is this genuinely one thing?" is not.
 */
const fixture = () => loadWorkspace("tests/fixtures/name-the-primitive", ["src"])

it.effect("a repeated field group the model reads as one thing is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(nameThePrimitive, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("tenantId")
    expect(result.diagnostics[0]?.judged).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("one_thing", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a group the model reads as unrelated is dropped, not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(nameThePrimitive, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("different reasons"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("unrelated", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
