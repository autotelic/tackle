import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { appendOnlyHonoured } from "../src/rules/append-only-honoured.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/strata", ["src"])

it.effect("a call the classifier reads as rewriting a record is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(appendOnlyHonoured, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("payroll_runs")
    expect(result.diagnostics[0]?.move).toBe("expand")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("supersede_only", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a call the classifier reads as mutable is not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(appendOnlyHonoured, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("mutable", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
