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

/**
 * A prose word equal to the sentinel cannot collapse the choice to one label.
 *
 * Effect 4.0.5 rejects a `Classify` with fewer than two criteria. The sentinel used to be
 * `none`; a doc block repeating `None` mid-sentence produced the term `none`, the two
 * merged into one label, and the run threw while building the question. The sentinel is
 * reserved now, and this is the shape that used to crash.
 */
it.effect("a prose word that used to equal the decline label no longer crashes the run", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/language-drift-sentinel", ["src"])
    const result = yield* plannedDiagnosticsOf(languageDrift, workspace)
    // The candidate exists and is judged; before the fix the run threw while building the
    // question, so reaching a finding at all is the regression.
    expect(result.diagnostics.some((entry) => entry.message.includes("none"))).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ concept: choice("none", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

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
