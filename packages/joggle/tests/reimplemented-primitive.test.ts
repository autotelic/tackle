import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import { NodeServices } from "@effect/platform-node"
import { reimplementedPrimitive } from "../src/rules/reimplemented-primitive.ts"
import type { WorkspaceError } from "../src/schema.ts"
import type { StubAnswer } from "../src/testing.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelFailing, modelStub } from "./support.ts"

/**
 * The deterministic half generates candidates; the judged half decides.
 *
 * The call graph keys a candidate, which is high recall. The question reads both
 * graphs and says whether they are the same OPERATION, which is what the key
 * alone cannot answer: `companyOwnership` and `crewOwnership` key identically
 * (same three callees, same input shape) and read different fields.
 */
const fixture = () => loadWorkspace("tests/fixtures/reimplemented", ["src"])

/** Every candidate answered `same_operation`, so a pair survives the gate. */
const sameOperation: StubAnswer = choice("same_operation", 0.95)

it.effect("a pair with the same call graph is a candidate, and the model decides", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/reimplemented", ["src"])
    const result = yield* plannedDiagnosticsOf(reimplementedPrimitive, workspace)
    const diagnostics = result.diagnostics
    expect(diagnostics.length).toBe(1)
    const found = diagnostics[0]!
    // The primitive is named, and it is the one whose whole body is the run.
    expect(found.message).toContain("cleanRow")
    expect(found.message).toContain("cleanInline")
    expect(found.repair?.operation).toBe("replace")
    expect(found.repair?.keep?.file).toBe("src/helper.ts")
    // The cascade: replace the run, and add the import.
    expect(found.repair?.cascade.length).toBe(2)
    expect(found.repair?.cascade[0]?.instruction).toContain("replace these 3 call(s)")
    expect(found.repair?.cascade[0]?.instruction).toContain("cleanRow")
    expect(found.repair?.cascade[1]?.instruction).toContain("import")
    expect(found.repair?.cascade[0]?.file).toBe("src/inline.ts")
  }).pipe(Effect.provide(modelStub({ same: sameOperation })), Effect.provide(NodeServices.layer)),
)

it.effect("two functions with the same callees and different inputs are not one operation", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(reimplementedPrimitive, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics.some((entry) => entry.message.includes("Ownership"))).toBe(false)
  }).pipe(Effect.provide(modelStub({ same: sameOperation })), Effect.provide(NodeServices.layer)),
)

it.effect("a pair the model reads as a different operation is dropped, not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(reimplementedPrimitive, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("different inputs"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ same: choice("different_inputs", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("an unreadable answer reports the candidate unverified, not silently", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(reimplementedPrimitive, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.judged).toBe(false)
    expect(result.diagnostics[0]?.help).toContain("Not verified")
  }).pipe(
    // A model that cannot answer at all: `onUnavailable: "report"` means the
    // candidate still surfaces, marked unverified.
    Effect.provide(modelFailing("the model was unreachable")),
    Effect.provide(NodeServices.layer),
  ),
)
