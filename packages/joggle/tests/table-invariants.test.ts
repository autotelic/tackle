import { expect, it } from "@effect/vitest"
import { Effect, Result } from "effect"
import { NodeServices } from "@effect/platform-node"

import { plannedDiagnosticsOf } from "../src/testing.ts"
import { tableInvariants } from "../src/rules/table-invariants.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { modelFailing, modelStub, noul } from "./support.ts"

/**
 * The rule's evidence is a fact (two files write one table through a
 * `knex("…")` literal); whether the writers carry the same invariants is the
 * model's. The fixture pairs an escalation-checked writer with one that only
 * checks for an existing row.
 */
const fixture = () => loadWorkspace("tests/fixtures/table-invariants", ["src"])

it.effect("two writers to one table with different guards is a finding", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(tableInvariants, workspace)
    expect(result.diagnostics.length).toBe(1)
    const finding = result.diagnostics[0]
    expect(finding?.message).toContain("`authorization_rule`")
    expect(finding?.judged).toBe(true)
    // The rule never names which writer is wrong: it hands a person the pair.
    expect(finding?.message).toContain("grant")
    expect(finding?.message).toContain("addRule")
    expect(finding?.help).toContain("Extract one guard both call")
  }).pipe(
    Effect.provide(modelStub({ drift: noul(0.9) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a low drift probability is the model saying no, and is dropped", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(tableInvariants, workspace)
    expect(result.diagnostics.length).toBe(0)
    expect(result.drops.some((drop) => drop.stage === "gated")).toBe(true)
    // The reason is the shared gate's own wording — one gate, one vocabulary.
    expect(result.drops[0]?.reason).toContain("answered no")
  }).pipe(
    Effect.provide(modelStub({ drift: noul(0.2) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a rule whose judgement is a guess steps aside without a model", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* Effect.result(plannedDiagnosticsOf(tableInvariants, workspace))
    // `propagate`: the finding is a guess, so with no judgement there is
    // nothing to stand on and the engine reports the rule as skipped.
    expect(Result.isFailure(result)).toBe(true)
  }).pipe(
    Effect.provide(modelFailing("no key")),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("one writer to a table is not a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const scoped = { ...workspace, units: workspace.units.filter((unit) => unit.file !== "src/rules.ts") }
    const result = yield* plannedDiagnosticsOf(tableInvariants, scoped)
    expect(result.diagnostics.length).toBe(0)
    expect(result.notes[0]).toContain("nothing to compare")
  }).pipe(
    Effect.provide(modelStub({ drift: noul(0.9) })),
    Effect.provide(NodeServices.layer),
  ),
)
