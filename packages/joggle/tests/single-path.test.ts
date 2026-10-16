import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { singlePath } from "../src/rules/single-path.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * Two facts: an AST string construction, and the helpers the file already calls
 * that more than one file uses. Nothing classifies the string -- no `toFixed`, no
 * formatter names -- so the same rule reads any repository.
 */
const fixture = () => loadWorkspace("tests/fixtures/single-path", ["src"])

it.effect("a string built beside a helper the file already calls is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(singlePath, workspace)
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]?.message).toContain("formatDollar")
    expect(result.diagnostics[0]?.move).toBe("contract")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("reimplements", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a helper whose every return is a number is not the string path", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(singlePath, workspace, {
      config: {},
      // The checker answers the type at a return expression. This stub says the
      // helper returns a number, so it cannot be the path for a string.
      nodeTypes: (file) => (file.endsWith("money.ts") ? "number" : undefined),
    })
    expect(result.diagnostics).toEqual([])
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("reimplements", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a helper that returns a string stays a candidate when types ran", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(singlePath, workspace, {
      config: {},
      nodeTypes: (file) => (file.endsWith("money.ts") ? "string" : undefined),
    })
    expect(result.diagnostics.length).toBeGreaterThan(0)
    expect(result.diagnostics[0]?.message).toContain("formatDollar")
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("reimplements", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a local case no helper covers is declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(singlePath, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.stage === "declined")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("legitimate_local", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
