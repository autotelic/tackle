import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { duplicateCallRun } from "../src/rules/duplicate-call-run.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/call-run", ["."])

it.effect("a shared run the model reads as a helper is reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(duplicateCallRun, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("share 4 call(s)")
    expect(result.diagnostics[0]?.judged).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("shared_helper", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a run the model reads as a common idiom is dropped", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(duplicateCallRun, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("common idiom"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("common_idiom", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
