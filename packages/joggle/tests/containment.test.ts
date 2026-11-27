import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { containment } from "../src/rules/containment.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { choice, modelFailing, modelStub } from "./support.ts"

const workspace = () => loadWorkspace("tests/fixtures/containment", ["src"])

it.effect("a smaller declaration contained in a larger one is a finding", () =>
  Effect.gen(function* () {
    const loaded = yield* workspace()
    const result = yield* plannedDiagnosticsOf(containment, loaded).pipe(
      Effect.provide(modelStub({ relation: choice("extend_the_primitive", 0.95) })),
    )
    expect(result.diagnostics.length).toBe(1)
    const finding = result.diagnostics[0]
    expect(finding?.message).toContain("readUserRecordOrUndefined")
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
