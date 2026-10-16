import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { nullabilityDrift } from "../src/rules/nullability-drift.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * One column, two nullabilities, across the artifact boundary no linter reaches.
 *
 * The migration leaves `payroll_crew.shakti_user_id` nullable; the row contract
 * requires it. The disagreement is a fact; whether it is a defect or a handled
 * null is the question.
 */
const drift = { verdict: choice("drift", 0.95) }
const fixture = () => loadWorkspace("tests/fixtures/nullability-drift", ["src"])

it.effect("a disagreement the model reads as drift is reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(nullabilityDrift, workspace)
    expect(result.diagnostics.length).toBe(1)
    const found = result.diagnostics[0]!
    expect(found.message).toContain("payroll_crew.shakti_user_id")
    expect(found.message).toContain("nullable in the migration")
    expect(found.message).toContain("required in the schema")
    expect(found.message).toContain("personId")
    expect(found.judged).toBe(true)
  }).pipe(Effect.provide(modelStub(drift)), Effect.provide(NodeServices.layer)),
)

it.effect("a null the model reads as handled is dropped, not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(nullabilityDrift, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("adapter handles"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("handled", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
