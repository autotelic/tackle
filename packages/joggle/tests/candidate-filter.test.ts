import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub, noul } from "./support.ts"

const verdict = {
  verdict: choice("collapse", 0.9),
  canonical: choice("member_0", 0.8),
  redundant: noul(0.9),
}

test("test fixtures are compared only against each other", async () => {
  const outcome = await Effect.runPromise(
    Effect.gen(function* () {
      const workspace = yield* loadWorkspace("tests/fixtures/dup", ["."])
      return yield* plannedDiagnosticsOf(duplicateImplementation, workspace)
    }).pipe(Effect.provide(modelStub(verdict)), Effect.provide(NodeServices.layer)),
  )
  const whole = JSON.stringify(outcome)

  // Exactly one cluster survives. `escapeCsv` in production and `escapeCsvCopy`
  // in the spec that tests it is the valuable case: the spec is asserting
  // against its own copy, so it passes whatever production does.
  expect(outcome.diagnostics.length).toBe(1)
  // The stub keeps member_0, so the location is the spec's copy and prod.ts is
  // the one listed as a duplicate. What matters is that the pair is reported at
  // all: this is the spec-versus-production case.
  expect(whole.includes("consumer.spec.ts")).toBe(true)
  expect(whole.includes("prod.ts")).toBe(true)

  // Two fixtures in one spec file are what a factory is for. Silent.
  expect(whole.includes("buildRow")).toBe(false)

  // `type ErrorResponse = any` and `type ShippingTax = any` are both `any`, not
  // both one thing. Shape equality is exact, so this rule needed a floor.
  expect(whole.includes("ShippingTax")).toBe(false)
})
