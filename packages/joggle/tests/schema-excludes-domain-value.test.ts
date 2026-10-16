import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { schemaExcludesDomainValue } from "../src/rules/schema-excludes-domain-value.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub } from "./support.ts"

/**
 * Two facts: a `Schema.Struct` field's constructor chain, and a declared field of
 * the same name with its annotation. `Finite` excluding a value is the library's
 * vocabulary; whether the producer yields one is the question.
 */
const fixture = () => loadWorkspace("tests/fixtures/schema-excludes-domain-value", ["src"])

it.effect("a Finite schema against a number domain field is a candidate", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(schemaExcludesDomainValue, workspace)
    expect(result.diagnostics.length).toBe(1)
    expect(result.diagnostics[0]?.message).toContain("thetaStandardError")
    expect(result.diagnostics[0]?.message).toContain("Finite")
    expect(result.diagnostics[0]?.move).toBeUndefined()
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("excludes", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)

it.effect("a producer that cannot yield one is declined", () =>
  Effect.gen(function* () {
    const workspace = yield* fixture()
    const result = yield* plannedDiagnosticsOf(schemaExcludesDomainValue, workspace)
    expect(result.diagnostics).toEqual([])
    expect(result.drops.some((drop) => drop.stage === "declined")).toBe(true)
  }).pipe(
    Effect.provide(modelStub({ verdict: choice("agrees", 0.95) })),
    Effect.provide(NodeServices.layer),
  ),
)
