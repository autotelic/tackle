import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { underusedPrimitive } from "../src/rules/underused-primitive.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub, noul } from "./support.ts"

const fixture = (paths: ReadonlyArray<string> = ["src/timing.ts"]) =>
  loadWorkspace("tests/fixtures/underused", paths)

const judged = { does: noul(0.92), disposition: choice("use_export", 0.95) }

it.effect("two declarations doing raw milliseconds are one finding when Duration is imported nowhere", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: "surface.json" },
    })
    expect(result.diagnostics.length).toBe(1)
    const found = result.diagnostics[0]!
    expect(found.message).toContain("Duration")
    expect(found.message).toContain("2 declaration")
    expect(found.message).toContain("import { Duration } from \"effect\"")
    expect(found.identity).toContain("duration")
    expect(found.judged).toBe(true)
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("the same arithmetic is silent when the workspace imports Duration", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture(["src/importing.ts"])
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: "surface.json" },
    })
    expect(result.diagnostics).toEqual([])
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("a missing surface is a note, never silence and never a crash", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: "missing.json" },
    })
    expect(result.diagnostics).toEqual([])
    expect(result.notes.some((note) => note.includes("surface"))).toBe(true)
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("a family the surface does not offer is not a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: "surface-no-family.json" },
    })
    expect(result.diagnostics).toEqual([])
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)
