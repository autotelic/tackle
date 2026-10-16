import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { composeTypes } from "../src/rules/compose-types.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * The containment is a fact; the name-drift case is the defect and the compose
 * case is advice. Advice is recorded, not printed.
 */
const fixture = () => loadWorkspace("tests/fixtures/compose-types", ["src"])

it.effect("compose advice is a notice, move: combine", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(composeTypes, workspace)
    // The primitives exist and the combination was never written: a real move,
    // so it is reported -- at notice severity, and as `combine`, not `expand`.
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics.every((entry) => entry.severity === "info")).toBe(true)
    expect(result.diagnostics.every((entry) => entry.move === "combine")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("composes", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a name declared twice is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(composeTypes, workspace)
    expect(result.diagnostics.length).toBe(2)
    expect(result.diagnostics.every((entry) => entry.severity === "warn")).toBe(true)
    expect(result.diagnostics.every((entry) => entry.move === "expand")).toBe(true)
    expect(result.diagnostics.some((entry) => entry.message.includes("declared in two places"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("same_name_drift", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a coincidence is dropped, not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(composeTypes, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("coincidence"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("independent", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
