import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { unaccountedDrop } from "../src/rules/unaccounted-drop.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelFailing, modelStub } from "./support.ts"

/**
 * Two facts: an exported function, and a `continue` inside it. Nothing decides
 * whether the function is an "adapter" or whether it "accounts" -- the same rule
 * reads any repository.
 */
const fixture = () => loadWorkspace("tests/fixtures/unaccounted-drop", ["src"])

it.effect("an exported path that skips items is a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unaccountedDrop, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("adaptRows")
    expect(result.diagnostics[0]?.move).toBeUndefined()
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("unaccounted", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a test helper that skips is not a boundary", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unaccountedDrop, workspace)
    expect(result.diagnostics.some((entry) => entry.message.includes("testRows"))).toBe(false)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("unaccounted", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a repository can make an unavailable rule step aside", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const error = yield* plannedDiagnosticsOf(unaccountedDrop, workspace, {
      config: {
        rules: { "joggle/unaccounted-drop": { severity: "warn", onUnavailable: "propagate" } },
      },
    }).pipe(Effect.flip)
    expect(String(error)).toContain("unreachable")
  }).pipe(
    Effect.provide(modelFailing("the model was unreachable")),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a repository can count unjudged candidates instead of printing them", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unaccountedDrop, workspace, {
      config: { unavailable: "count" },
    })
    expect(result.diagnostics).toEqual([])
    expect(result.notes.some((note) => note.includes("candidate(s) were not judged"))).toBe(true)
  }).pipe(
    Effect.provide(modelFailing("the model was unreachable")),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a function that returns a boolean is not a data funnel when types ran", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unaccountedDrop, workspace, {
      config: {},
      nodeTypes: (file) => (file.endsWith("rows.ts") ? "boolean" : undefined),
    })
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("unaccounted", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a function that returns a collection stays a candidate when types ran", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unaccountedDrop, workspace, {
      config: {},
      nodeTypes: (file) => (file.endsWith("rows.ts") ? "ReadonlyArray<Row>" : undefined),
    })
    expect(result.diagnostics.length).toBe(1)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("unaccounted", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a skip the caller does not need to see is declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(unaccountedDrop, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.stage === "declined")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("internal_only", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
