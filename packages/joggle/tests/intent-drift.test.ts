import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { intentDrift } from "../src/rules/intent-drift.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelFailing, modelStub } from "./support.ts"

const fixture = () => loadWorkspace("tests/fixtures/intent-drift", ["src"])
const missing = () => loadWorkspace("tests/fixtures/intent-drift-missing", ["src"])

const migrate = modelStub({ verdict: choice("migrate", 0.95) })
const fixTag = modelStub({ verdict: choice("fix_tag", 0.95) })
const keep = modelStub({ verdict: choice("keep", 0.95) })

it.effect("reports an import of a deprecated declaration and names its replacement", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(Effect.provide(migrate))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.message).toBe(
      "`OldButton` is deprecated; use `Button` instead.",
    )
    expect(result.diagnostics[0]?.judged).toBe(true)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("points at the import binding, not the declaration", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(Effect.provide(migrate))
    expect(result.diagnostics[0]?.location).toMatchObject({
      file: "src/page.ts",
      line: 1,
      column: 10,
    })
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("drops an import the model says is intentional", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(Effect.provide(keep))
    expect(result.diagnostics).toEqual([])
    expect(result.drops.length).toBeGreaterThan(0)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("does not report a deprecated declaration that is no longer imported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(Effect.provide(migrate))
    expect(
      result.diagnostics.some((diagnostic) => diagnostic.message.includes("LegacyThing")),
    ).toBe(false)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("reports a replacement that no declaration exports", () =>
  Effect.gen(function* () {
    const workspace = yield* missing()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(Effect.provide(fixTag))
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.message).toBe(
      "`Ghosted` is deprecated in favor of `GhostButton`, which no declaration exports.",
    )
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("does not ask the reader to migrate to a replacement that does not exist", () =>
  Effect.gen(function* () {
    const workspace = yield* missing()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(Effect.provide(migrate))
    expect(result.diagnostics).toEqual([])
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("reports the facts unjudged when the model is unavailable", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(intentDrift, workspace).pipe(
      Effect.provide(modelFailing("no key")),
    )
    expect(result.diagnostics).toHaveLength(1)
    expect(result.diagnostics[0]?.judged).toBe(false)
  }).pipe(Effect.provide(NodeServices.layer)),
)
