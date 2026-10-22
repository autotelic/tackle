import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { declaredStaleness } from "../src/rules/declared-staleness.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub, noul } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/strata", ["src"])

it.effect("a projection the classifier allows and reads as undeclared is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(declaredStaleness, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("summarizeDeliveries")
  }).pipe(
    Effect.provide(
      modelStub({ verdict: choice("allowed", 0.95), undeclared: noul(0.9) }),
    ),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a declared staleness bound is not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(declaredStaleness, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(
      modelStub({ verdict: choice("allowed", 0.95), undeclared: noul(0.1) }),
    ),
    Effect.provide(NodeServices.layer),
  ),
)
