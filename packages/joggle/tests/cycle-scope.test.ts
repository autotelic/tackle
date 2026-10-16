import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { importCycle } from "../src/rules/import-architecture.ts"
import { everyFile, type Scope } from "../src/rule.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { modelStub } from "./support.ts"

/**
 * A cycle is only this run's business when one of its members moved.
 *
 * A PR-scoped run on a real repository reported all eight of the repository's
 * cycles while saying it had narrowed to the changed files.
 */
const cycleAnswer = {
  verdict: { _tag: "Classify", label: "cycle", probabilities: { cycle: 0.95 }, confidence: 0.9 },
}

it.effect("a scoped run reports only cycles a changed file participates in", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/cycles", ["src"])
    const run = (scope: Scope) =>
      Effect.gen(function* () {
        const planned = yield* importCycle.plan(workspace, scope, { config: {} })
        return planned.read(planned.plans.map(() => cycleAnswer))
      })

    const all = yield* run(everyFile)
    expect(all.diagnostics.length).toBe(1)

    const inside = yield* run({ changed: new Set(["src/b.ts"]) })
    expect(inside.diagnostics.length).toBe(1)
    expect(inside.diagnostics[0]?.location.file).toBe("src/b.ts")

    const outside = yield* run({ changed: new Set(["src/untouched.ts"]) })
    expect(outside.diagnostics.length).toBe(0)
    expect(outside.notes.join(" ")).toContain("outside the scope of this run")
  }).pipe(Effect.provide(modelStub({})), Effect.provide(NodeServices.layer)),
)
