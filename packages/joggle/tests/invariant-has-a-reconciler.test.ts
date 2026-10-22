import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { invariantHasAReconciler } from "../src/rules/invariant-has-a-reconciler.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/strata", ["src"])

it.effect("an exported check over stored rows reaches the repair-path question", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(invariantHasAReconciler, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("reconcileDelivered")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("detect_only", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a check the classifier reads as having a repair path is not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(invariantHasAReconciler, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("repair_path", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
