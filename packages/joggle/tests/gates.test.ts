import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { duplicateMeaning } from "../src/rules/duplicate-meaning.ts"
import { marginOfAnswer, qualityOf } from "../src/rule.ts"
import { plannedDiagnosticsOf, type StubAnswer } from "../src/testing.ts"
import { modelStub, noul, withWorkspace } from "./support.ts"

/** A Choice answer with a real distribution, which the shared stub does not carry. */
const spread = (probabilities: Record<string, number>): StubAnswer => ({
  type: "choice",
  choice: Object.entries(probabilities).sort((left, right) => right[1] - left[1])[0]?.[0] ?? "",
  probabilities,
  confidence: 0.5,
})

it("the margin is the gap the model left between two options", () => {
  expect(
    marginOfAnswer({
      label: "collapse",
      probabilities: { collapse: 0.6, keep_variants: 0.3, no_issue: 0.1 },
      confidence: 0.5,
    }),
  ).toBeCloseTo(0.3)
  // One option has nothing to be uncertain between.
  expect(marginOfAnswer({ label: "collapse", probabilities: { collapse: 1 }, confidence: 0.5 })).toBe(1)
})

it("a yes/no answer is a verdict, not a ranking", () => {
  const no = qualityOf({ score: 0.2, margin: 0.5 })
  expect(no.quality).toBe("drop")
  expect(no.reason).toContain("answered no")

  const yes = qualityOf({ score: 0.9, margin: 0.5 })
  expect(yes.quality).toBe("act")
})

it("a choice that barely won is not a decision", () => {
  const shrugged = qualityOf({ score: 0.9, margin: 0.05 })
  expect(shrugged.quality).toBe("review")
  expect(shrugged.reason).toContain("not decisive")
})

it("an unmeasurable margin does not block a good answer", () => {
  expect(qualityOf({ score: 0.9, margin: undefined }).quality).toBe("act")
  // Low confidence is a review, not a no.
  expect(qualityOf({ score: 0.9, margin: 0.5, confidence: 0.4 }).quality).toBe("review")
})

it.effect("a provable finding degrades to unverified when the model says no", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // Exact duplicates are a FACT, so this rule reports them either way -- but
      // the reason is now on the finding instead of being overruled by a Choice
      // that said `collapse`.
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      expect(findings.length).toBe(1)
      expect(findings[0]?.judged).toBe(false)
      expect(findings[0]?.help).toContain("the yes/no question answered no")
    }).pipe(
      Effect.provide(
        modelStub({ verdict: spread({ collapse: 1 }), canonical: spread({ member_0: 1 }), redundant: noul(0.2) }),
      ),
    ),
  ),
)

it.effect("a guessed finding disappears when the model says no", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateMeaning, workspace)).diagnostics
      expect(findings).toEqual([])
    }).pipe(
      Effect.provide(
        modelStub({ verdict: spread({ collapse: 1 }), canonical: spread({ member_0: 1 }), redundant: noul(0.1) }),
      ),
    ),
  ),
)

it.effect("a shrug across two options is reported for review, not acted on", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // The docs route on confidence in three ranges: act, review, drop. A shrug
      // is the middle one -- the model did not say no, it said it was not sure --
      // so the finding is reported at info for a reader to weigh.
      const findings = (yield* plannedDiagnosticsOf(duplicateMeaning, workspace)).diagnostics
      expect(findings.length).toBe(1)
      expect(findings[0]?.severity).toBe("info")
      expect(findings[0]?.help).toContain("For review")
    }).pipe(
      Effect.provide(
        modelStub({
          verdict: spread({ collapse: 0.45, keep_variants: 0.4 }),
          canonical: spread({ member_0: 1 }),
          redundant: noul(0.9),
        }),
      ),
    ),
  ),
)
