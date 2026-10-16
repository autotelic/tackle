import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { choice, modelStub, noul, rate, withWorkspace } from "./support.ts"

const collapse = (canonical: string) => ({
  verdict: choice("collapse", 0.9),
  canonical: choice(canonical, 0.8),
  redundant: noul(0.9),
  consequence: rate(3),
})

it.effect("a merge finding carries the smaller form and the sites that change", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      const repaired = findings.filter((entry) => entry.repair !== undefined)
      expect(repaired.length).toBeGreaterThan(0)
      const repair = repaired[0]?.repair
      expect(repair?.operation).toBe("merge")
      expect(repair?.complete).toBe(true)
      // The cascade names the sites, so an agent needs no search of its own.
      expect(repair?.cascade.length).toBeGreaterThan(0)
      expect(repair?.cascade.every((edit) => edit.instruction.length > 0)).toBe(true)
      // The operation was settled by the table and the model agreeing, and the
      // reason is on the finding so a reader can see which method said what.
      expect(repair?.settled).toContain("agree")
    }).pipe(Effect.provide(modelStub(collapse("member_0")))),
  ),
)

it.effect("a finding with no operation is an observation, not a work order", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // The model declines the verdict, so there is nothing to do and no repair.
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      for (const entry of findings) expect(entry.repair).toBeUndefined()
    }).pipe(Effect.provide(modelStub({ verdict: choice("no_issue", 0.9) }))),
  ),
)
