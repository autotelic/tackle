import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { genericCarriesACaller } from "../src/rules/generic-carries-a-caller.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * Two facts: a string literal in a unit, and the unit being rendered by two
 * files. Nothing decides whether the string "looks like copy" or the path is
 * "generic" -- the same rule reads any repository.
 */
const fixture = () => loadWorkspace("tests/fixtures/generic-carries-a-caller", ["src"])

it.effect("a shared component stating one caller's label is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(genericCarriesACaller, workspace)
    const messages = result.diagnostics.map((entry) => entry.message)
    expect(messages.some((message) => message.includes("Company total") && message.includes("YearColumns"))).toBe(true)
    expect(result.diagnostics.every((entry) => entry.move === "expand")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("names_a_caller", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("the unit's own words are declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(genericCarriesACaller, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.stage === "declined")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("general", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
