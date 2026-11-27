import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { containment } from "../src/rules/containment.ts"
import { containmentOf, similarityOf } from "../src/similarity.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { choice, modelFailing, modelStub } from "./support.ts"

const workspace = () => loadWorkspace("testdata/containment", ["src"])

// The pair has to be skewed, not merely similar: the rule leaves anything at or
// above the duplicate threshold to duplicate-meaning, so a fixture that straddles
// it tests silence instead of the subset relation.
it.effect("the fixture pair belongs to containment, not to duplicate-meaning", () =>
  Effect.gen(function* () {
    const loaded = yield* workspace()
    expect(loaded.units.length).toBe(2)
    for (const left of loaded.units) {
      for (const right of loaded.units) {
        if (left === right) continue
        const contained = containmentOf({ left: left.shingles, right: right.shingles })
        const similar = similarityOf({ left: left.shingles, right: right.shingles })
        expect(contained).toBeGreaterThanOrEqual(0.9)
        expect(similar).toBeLessThan(0.4)
      }
    }
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("a smaller declaration contained in a larger one is a finding", () =>
  Effect.gen(function* () {
    const loaded = yield* workspace()
    const result = yield* plannedDiagnosticsOf(containment, loaded).pipe(
      Effect.provide(modelStub({ relation: choice("extend_the_primitive", 0.95) })),
    )
    expect(result.diagnostics.length).toBe(1)
    const finding = result.diagnostics[0]
    expect(finding?.message).toContain("readUserName")
    expect(finding?.message).toContain("readUserRecord")
    expect(finding?.message).toContain("%")
    expect(finding?.help).toContain("larger primitive")
    expect(finding?.move).toBe("combine")
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("coincidence is silence", () =>
  Effect.gen(function* () {
    const loaded = yield* workspace()
    const result = yield* plannedDiagnosticsOf(containment, loaded).pipe(
      Effect.provide(modelStub({ relation: choice("coincidence", 0.95) })),
    )
    expect(result.diagnostics.length).toBe(0)
    expect(result.drops.map((drop) => drop.reason).join(" ")).toContain("unrelated")
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("an unavailable judge still reports the containment fact", () =>
  Effect.gen(function* () {
    const loaded = yield* workspace()
    const result = yield* plannedDiagnosticsOf(containment, loaded).pipe(
      Effect.provide(modelFailing("TYPESAFE_API_KEY is not set")),
    )
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.judged).toBe(false)
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("test and fixture declarations are not candidates", () =>
  Effect.gen(function* () {
    const loaded = yield* loadWorkspace("testdata/containment-test-only", ["."])
    const result = yield* plannedDiagnosticsOf(containment, loaded).pipe(
      Effect.provide(modelStub({ relation: choice("extend_the_primitive", 0.95) })),
    )
    expect(result.diagnostics.length).toBe(0)
    const notes = result.notes.join(" ")
    expect(notes).toContain("removed as test/fixture")
    expect(notes).toContain("pair(s) were removed because a declaration is a test or fixture")
  }).pipe(Effect.provide(NodeServices.layer)),
)

it.effect("a pair below the min-token floor is not a candidate", () =>
  Effect.gen(function* () {
    const loaded = yield* loadWorkspace("testdata/containment-short", ["src"])
    expect(loaded.units.every((unit) => unit.tokens.length < 40)).toBe(true)
    const result = yield* plannedDiagnosticsOf(containment, loaded).pipe(
      Effect.provide(modelStub({ relation: choice("extend_the_primitive", 0.95) })),
    )
    expect(result.diagnostics.length).toBe(0)
    expect(result.notes.join(" ")).toContain("min-token floor 40")
  }).pipe(Effect.provide(NodeServices.layer)),
)
