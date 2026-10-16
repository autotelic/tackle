import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { dataErrorAsOutage } from "../src/rules/data-error-as-outage.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelFailing, modelStub, noul } from "./support.ts"

/**
 * The deterministic half finds the SHAPE; the judged half decides what it IS.
 *
 * The candidate is high recall and syntactic: a nullish guard, or a catch, that
 * answers a 5xx. It does not decide whether the branch is about a row -- that is
 * `about_a_row`, a Noul answered against the handler's source. Naming row reads
 * `find*`/`get*`/`parse*` in code was the classifier's work done ahead of time,
 * and it missed reads a name never covered.
 */
const fixture = () => loadWorkspace("tests/fixtures/data-error", ["src"])

/** Every candidate verified as about a row, and the absence read as normal. */
const allRow = {
  about_a_row: noul(0.95),
  verdict: choice("row_absence_is_normal", 0.95),
}

it.effect("a 5xx on a branch that could be about a row is a candidate, and the model reports it", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(dataErrorAsOutage, workspace)
    // Three candidates: the `!row`/`code(500)` guard (its read is `store.retrieve`,
    // which the old name gate would have missed), the `=== null`/`statusCode = 503`
    // guard, and the `try`/`catch` around a decode. The 404 and the unguarded 5xx
    // are not candidates.
    expect(result.diagnostics.length).toBe(3)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("getProject")
    expect(messages).toContain("500")
    expect(messages).toContain("getCrew")
    expect(messages).toContain("503")
    expect(messages).toContain("getReview")
    expect(messages).not.toContain("getProjectOk")
    expect(messages).not.toContain("listProjects")
    expect(result.diagnostics.every((entry) => entry.judged)).toBe(true)
  }).pipe(Effect.provide(modelStub(allRow)), Effect.provide(NodeServices.layer)),
)

it.effect("an .astro file's frontmatter is read for the same shape", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/data-error-astro", ["src"])
    const result = yield* plannedDiagnosticsOf(dataErrorAsOutage, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("getCrew")
    expect(result.diagnostics[0]?.location.file).toBe("src/pages/crew.astro")
  }).pipe(Effect.provide(modelStub(allRow)), Effect.provide(NodeServices.layer)),
)

it.effect("a branch the model reads as not about a row is dropped, not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(dataErrorAsOutage, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("not about a row"))).toBe(true)
  }).pipe(
    Effect.provide(
      modelStub({ about_a_row: noul(0.2), verdict: choice("row_absence_is_normal", 0.95) }),
    ),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a 5xx the model reads as a broken invariant is dropped, not reported", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(dataErrorAsOutage, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.reason.includes("broken invariant"))).toBe(true)
  }).pipe(
    Effect.provide(
      modelStub({ about_a_row: noul(0.95), verdict: choice("row_absence_is_an_error", 0.95) }),
    ),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("without a model a guard surfaces unverified, but a bare catch does not", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(dataErrorAsOutage, workspace)
    // The two nullish guards report unverified; the try/catch is dropped, because
    // every ordinary error handler has one and reporting it unverified is the
    // noise the verification exists to remove.
    expect(result.diagnostics.length).toBe(2)
    const messages = result.diagnostics.map((entry) => entry.message).join("\n")
    expect(messages).toContain("getProject")
    expect(messages).toContain("getCrew")
    expect(messages).not.toContain("getReview")
    expect(result.diagnostics.every((entry) => !entry.judged)).toBe(true)
    expect(result.diagnostics[0]?.help).toContain("Not verified")
    expect(result.drops.some((drop) => drop.reason.includes("too common to report"))).toBe(true)
  }).pipe(Effect.provide(modelFailing("the model was unreachable")), Effect.provide(NodeServices.layer)),
)
