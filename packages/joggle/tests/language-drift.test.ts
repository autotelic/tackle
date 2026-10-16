import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { languageDrift } from "../src/rules/language-drift.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * A capitalized English word mid-sentence is not a domain concept.
 *
 * "None of these values is required" put `None` into the candidate list, the
 * model -- correctly, given the option -- chose it, and the rule reported that
 * the prose says "none" and no declaration uses the word. It also collides with
 * the Choice's own decline option. It is filtered now, before the question.
 */
it.effect("an ordinary English word is not a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/language-drift", ["src"])
    const result = yield* plannedDiagnosticsOf(languageDrift, workspace)
    expect(result.diagnostics).toEqual([])
  }).pipe(Effect.provide(modelStub({})), Effect.provide(NodeServices.layer)),
)

const fixture = () => loadWorkspace("tests/fixtures/language-drift", ["src"])

it.effect("a confident answer is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(languageDrift, workspace)
    expect(result.diagnostics.some((entry) => entry.message.includes("harvest"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ concept: choice("harvest", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("an unsure answer is a notice, not withheld", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(languageDrift, workspace)
    // Confidence below the review floor is an unsure answer, not an absent one. It
    // is reported at notice severity rather than discarded.
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.severity).toBe("info")
  }).pipe(
    Effect.provide(modelStub({ concept: choice("harvest", 0.56) })),
    Effect.provide(NodeServices.layer),
  ),
)
