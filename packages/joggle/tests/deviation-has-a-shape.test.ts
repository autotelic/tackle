import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { deviationHasAConcept } from "../src/rules/deviation-has-a-shape.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/strata", ["src"])

it.effect("a boolean beside nullable siblings reaches the question", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(deviationHasAConcept, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("PayrollRun")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("deviation", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a shape the classifier reads as a state of the world is not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(deviationHasAConcept, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("state", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
