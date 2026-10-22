import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { factOrDerivation } from "../src/rules/fact-or-derivation.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/strata", ["src"])

it.effect("a writer and a reader of one column reach the fact-or-derivation question", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(factOrDerivation, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("refreshPayrollTotals")
    expect(messages).toContain("payroll_runs")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("recomputation", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a column the classifier reads as neither is not counted twice", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(factOrDerivation, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("neither", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
