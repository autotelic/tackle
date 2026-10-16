import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { duplicateMeaning } from "../src/rules/duplicate-meaning.ts"
import type { DropStage } from "../src/schema.ts"
import { plannedDiagnosticsOf, type StubAnswer } from "../src/testing.ts"
import { funnelNotes } from "../src/report.ts"
import { modelStub, noul, withWorkspace } from "./support.ts"

const spread = (probabilities: Record<string, number>): StubAnswer => ({
  type: "choice",
  choice: Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "",
  probabilities,
  confidence: 0.5,
})

const stagesOf = (drops: ReadonlyArray<{ stage: DropStage }>): ReadonlyArray<DropStage> =>
  drops.map((drop) => drop.stage)

it.effect("a decline is recorded as a decline", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const { drops } = yield* plannedDiagnosticsOf(duplicateMeaning, workspace)
      expect(stagesOf(drops)).toEqual(["declined"])
      expect(drops[0]?.reason).toContain("found nothing to change")
      // The candidate is named, so a reader can go and look at it.
      expect(drops[0]?.subject.length).toBeGreaterThan(0)
    }).pipe(
      Effect.provide(
        modelStub({ verdict: spread({ no_issue: 0.9 }), canonical: spread({ member_0: 1 }), redundant: noul(0.9) }),
      ),
    ),
  ),
)

it.effect("a failed gate is recorded as a gate, not as a decline", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // The distinction is the point of the funnel: "the model said no" and "the
      // model said yes but not confidently" need different fixes.
      const { drops } = yield* plannedDiagnosticsOf(duplicateMeaning, workspace)
      expect(stagesOf(drops)).toEqual(["gated"])
      expect(drops[0]?.reason).toContain("answered no")
    }).pipe(
      Effect.provide(
        modelStub({ verdict: spread({ collapse: 1 }), canonical: spread({ member_0: 1 }), redundant: noul(0.1) }),
      ),
    ),
  ),
)

it.effect("a fact-based rule reports rather than drops", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // Exact duplicates are provable, so a failed gate downgrades the finding
      // instead of removing it. Nothing is dropped, and the report says so.
      const { diagnostics, drops } = yield* plannedDiagnosticsOf(duplicateImplementation, workspace)
      expect(diagnostics.length).toBe(1)
      expect(diagnostics[0]?.judged).toBe(false)
      expect(stagesOf(drops)).toEqual([])
    }).pipe(
      Effect.provide(
        modelStub({ verdict: spread({ collapse: 1 }), canonical: spread({ member_0: 1 }), redundant: noul(0.1) }),
      ),
    ),
  ),
)

it("the funnel is one line per rule, with a stage breakdown", () => {
  const notes = funnelNotes([
    { ruleId: "joggle/a", subject: "one", stage: "gated", reason: "not decisive" },
    { ruleId: "joggle/a", subject: "two", stage: "gated", reason: "not decisive" },
    { ruleId: "joggle/a", subject: "three", stage: "declined", reason: "said no" },
    { ruleId: "joggle/b", subject: "four", stage: "budget", reason: "past the budget" },
  ])
  expect(notes.length).toBe(2)
  // Sorted by stage, so two runs of the same rule read the same way.
  expect(notes[0]?.reason).toContain("declined 1, gated 2")
  // The example is what makes a count actionable.
  expect(notes[0]?.reason).toContain("e.g. one: not decisive")
  expect(notes[1]?.reason).toContain("budget 1")
})

it("a run with no drops says nothing", () => {
  // Silence here means every candidate was reported or none existed. Both are
  // clean, and neither needs a line.
  expect(funnelNotes([])).toEqual([])
})

it.effect("a rule whose gate rejects every candidate drops them, with a reason", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // The Noul says no, which is a verdict, so the candidates are dropped
      // rather than reported. This is the case the finding count alone cannot
      // distinguish from a rule with nothing to look at, which is exactly why
      // the funnel is reported.
      const { diagnostics, drops } = yield* plannedDiagnosticsOf(duplicateMeaning, workspace)
      expect(diagnostics).toEqual([])
      expect(drops.length).toBeGreaterThan(0)
    }).pipe(Effect.provide(modelStub({ redundant: noul(0.1) }))),
  ),
)
