import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { inferredOverRecorded } from "../src/rules/inferred-over-recorded.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * Three facts: a comparison in the unit (a language construct), a return, and a
 * type the unit names that records a boolean it does not read. Whether the
 * computation reconstructs the recorded field is the question.
 */
const fixture = () => loadWorkspace("tests/fixtures/inferred-over-recorded", ["src"])

it.effect("a derived boolean beside a recorded one is a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(inferredOverRecorded, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("useSwaDayRate")
    expect(result.diagnostics[0]?.move).toBe("contract")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("inferred", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a function that returns a count, not the boolean, is not a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(inferredOverRecorded, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).not.toContain("countDayRate")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("inferred", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a unit that names no such type is not a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/node-types", ["src"])
    const result = yield* plannedDiagnosticsOf(inferredOverRecorded, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("inferred", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
