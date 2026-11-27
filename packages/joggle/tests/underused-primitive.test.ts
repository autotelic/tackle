import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { evidenceKinds } from "../src/evidence.ts"
import { representativeUnits, underusedPrimitive } from "../src/rules/underused-primitive.ts"
import { projectRootOf, surfaceFileOf, surfaceOutputOf } from "../src/surface.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub, noul } from "./support.ts"

const fixture = (paths: ReadonlyArray<string> = ["src/timing.ts"]) =>
  loadWorkspace("tests/fixtures/underused", paths)

const judged = { does: noul(0.92), disposition: choice("use_export", 0.95) }

const surface = (name: string): string => join(process.cwd(), "tests/fixtures/underused", name)

it.effect("three declarations doing raw milliseconds are one finding when Duration is imported nowhere", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface.json") },
    })
    expect(result.diagnostics.length).toBe(1)
    const found = result.diagnostics[0]!
    expect(found.message).toContain("Duration")
    expect(found.message).toContain("3 declaration")
    expect(found.message).toContain("import { Duration } from \"effect\"")
    expect(found.identity).toContain("round-millisecond")
    expect(found.judged).toBe(true)
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("two declarations are a coincidence, not a capability", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture(["src/pair.ts"])
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface.json") },
    })
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("coincidence"))).toBe(true)
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("the same arithmetic is silent when the workspace imports Duration", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture(["src/importing.ts"])
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface.json") },
    })
    expect(result.diagnostics).toEqual([])
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("a missing surface is a note, never silence and never a crash", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("missing.json") },
    })
    expect(result.diagnostics).toEqual([])
    expect(result.notes.some((note) => note.includes("surface"))).toBe(true)
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("a family the surface does not offer is not a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface-no-family.json") },
    })
    expect(result.diagnostics).toEqual([])
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("a declined Duration falls through to Clock, and the finding names Clock", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface-fallback.json") },
    })
    expect(result.diagnostics.length).toBe(1)
    const found = result.diagnostics[0]!
    expect(found.message).toContain("Clock")
    expect(found.message).not.toContain("import { Duration }")
    expect(found.message).toContain("3 declaration")
  }).pipe(
    Effect.provide(
      modelStub({
        "does@0": noul(0.04),
        "disposition@0": choice("use_export", 0.9),
        "does@1": noul(0.92),
        "disposition@1": choice("use_export", 0.95),
      }),
    ),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("test files and config files are the suite's numbers, not evidence", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture([
      "src/pair.ts",
      "vitest.config.ts",
      "tests/timing.test.ts",
    ])
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface.json") },
    })
    expect(result.diagnostics).toEqual([])
    // src/pair.ts holds the only two product sites left; the config's three round
    // literals and the spec's clock arithmetic subtract from nothing.
    expect(result.drops.some((drop) => drop.reason.includes("only 2 declaration"))).toBe(true)
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("the sample is one site per shape, and the count stays the true total", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture(["src/repeated.ts"])
    const result = yield* plannedDiagnosticsOf(underusedPrimitive, workspace, {
      config: { surfacePath: surface("surface.json") },
    })
    expect(result.diagnostics.length).toBe(1)
    const found = result.diagnostics[0]!
    expect(found.message).toContain("4 declaration")
  }).pipe(Effect.provide(modelStub(judged)), Effect.provide(NodeServices.layer)),
)

it.effect("the judgement is shown one site per normalized shape, not the pool", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture(["src/repeated.ts"])
    const units = workspace.units.filter((unit) => evidenceKinds[0]!.matches(unit))
    expect(units.length).toBe(4)
    expect(representativeUnits(units).length).toBe(1)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it("surface build's default output is the path the rule reads", () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-surface-"))
  const packageDirectory = join(root, "packages", "joggle")
  mkdirSync(join(root, ".git"), { recursive: true })
  mkdirSync(packageDirectory, { recursive: true })

  const built = surfaceOutputOf({ start: packageDirectory, out: undefined })
  const read = surfaceFileOf({
    root: projectRootOf(packageDirectory),
    surfacePath: undefined,
  })

  expect(projectRootOf(packageDirectory)).toBe(root)
  expect(built).toBe(join(root, ".joggle", "surface.json"))
  expect(read).toBe(built)
})
