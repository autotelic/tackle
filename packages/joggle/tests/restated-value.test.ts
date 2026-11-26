import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { restatedValue } from "../src/rules/restated-value.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { modelStub, noul } from "./support.ts"

/**
 * Four facts in one fixture, because the rule's value is in the exclusions:
 *
 *   auth.ts / ui.ts        the same two-value vocabulary under two names  -> one finding
 *   same-home.ts           the same vocabulary beside the file it imports -> excluded
 *   region-a.ts / region-b the same single value under two names         -> excluded (not a set)
 */
const restated = () => loadWorkspace("tests/fixtures/values", ["src"])
const imported = () => loadWorkspace("tests/fixtures/values-imported", ["src"])

it.effect("one vocabulary in two independent files is one finding", () =>
  Effect.gen(function* () {
    const workspace = yield* restated()
    const result = yield* plannedDiagnosticsOf(restatedValue, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("admin")
    // auth.ts, ui.ts and the enum are three homes: an enum's member values are
    // the same vocabulary as a const array, so both spellings join one cluster.
    expect(result.diagnostics[0]?.message).toContain("3 times")
    expect(result.diagnostics[0]?.move).toBe("contract")
    expect(result.diagnostics[0]?.judged).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ redundant: noul(0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a declaration beside the file it imports is not a second home", () =>
  Effect.gen(function* () {
    const workspace = yield* restated()
    const result = yield* plannedDiagnosticsOf(restatedValue, workspace)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).not.toContain("same-home")
    // And the single-value pair is a constant, not a vocabulary.
    expect(messages).not.toContain("us-east-1")
  }).pipe(
    Effect.provide(modelStub({ redundant: noul(0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("importing a sibling's helper does not make this declaration homed", () =>
  Effect.gen(function* () {
    // ui.ts imports `allowed` from permissions.ts, which also declares the same
    // vocabulary. An import of ANY name used to excuse the copy; it has to be an
    // import of THIS declaration.
    const workspace = yield* loadWorkspace("tests/fixtures/values-unrelated-helper", ["src"])
    const result = yield* plannedDiagnosticsOf(restatedValue, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("admin")
  }).pipe(
    Effect.provide(modelStub({ redundant: noul(0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a vocabulary whose only copies have a home is silent", () =>
  Effect.gen(function* () {
    const workspace = yield* imported()
    const result = yield* plannedDiagnosticsOf(restatedValue, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ redundant: noul(0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
