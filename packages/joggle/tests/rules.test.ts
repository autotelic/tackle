import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { duplicateMeaning } from "../src/rules/duplicate-meaning.ts"
import { namingDrift, worthJudging } from "../src/rules/naming-drift.ts"
import { everyFile } from "../src/rule.ts"
import { choice, modelFailing, modelStub, noul, rate, withWorkspace } from "./support.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"

const collapse = (canonical: string, confidence = 0.85) => ({
  verdict: choice("collapse", confidence),
  canonical: choice(canonical, 0.8),
  redundant: noul(0.9),
  // The top consequence level: these are one thing AND it matters.
  consequence: rate(3),
})

it.effect("the report sorts by consequence, not by redundancy", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      expect(findings.length).toBe(1)
      // Redundancy 0.9 gates it in; consequence level 0 ranks it last. Both
      // facts survive, and they are different facts: this IS duplication, and it
      // does NOT matter. Before this, the report sorted by the first one, which is
      // how a spec re-implementing the function it tests ended up last.
      expect(findings[0]?.score).toBeCloseTo(0)
      expect(findings[0]?.judged).toBe(true)
    }).pipe(
      Effect.provide(
        modelStub({
          verdict: choice("collapse", 0.9),
          canonical: choice("member_0", 0.8),
          redundant: noul(0.9),
          consequence: rate(0),
        }),
      ),
    ),
  ),
)

it.effect("a cluster of identical declarations is one finding", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      // One cluster, not two. The fixture's two files each declare their own
      // `User`, so the two functions that take one are NOT the same function:
      // resolved type identity says users.ts#User and orders.ts#User are
      // different types. The old rule called them identical.
      expect(findings.length).toBe(1)
      for (const entry of findings) {
        expect(entry.judged).toBe(true)
        expect(entry.score).toBeCloseTo(1)
        expect(entry.message).toContain("is declared 2 times")
        // The model answers role and relationship, so the prescription is the
        // model's. The declared-layers fallback is only for a repository whose
        // judgement did not include them.
        expect(entry.help).toContain("Delete the copies and import one")
      }
    }).pipe(Effect.provide(modelStub(collapse("member_0")))),
  ),
)

it.effect("the model picks which member survives", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      expect(findings.length).toBe(1)
      // member_1 is src/users.ts, so the drop is src/orders.ts.
      for (const entry of findings) expect(entry.location.file).toBe("src/orders.ts")
    }).pipe(Effect.provide(modelStub(collapse("member_1")))),
  ),
)

it.effect("keep_variants and no_issue are both silence", () =>
  Effect.all(
    ["keep_variants", "no_issue"].map((verdict) =>
      withWorkspace((workspace) =>
        Effect.gen(function* () {
          const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
          expect(findings.length).toBe(0)
        }).pipe(Effect.provide(modelStub({ verdict: choice(verdict, 0.9) }))),
      ),
    ),
  ),
)

it.effect("a non-decisive verdict is reported for review", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      // The stub's verdict is an even split, so the model is not decisive. That
      // is a review, not a no: the finding is reported at info.
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      expect(findings.length).toBe(1)
      for (const entry of findings) {
        expect(entry.severity).toBe("info")
        expect(entry.help).toContain("For review")
      }
    }).pipe(Effect.provide(modelStub({}))),
  ),
)

it.effect("an unavailable judge still reports, unverified", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateImplementation, workspace)).diagnostics
      expect(findings.length).toBe(1)
      for (const entry of findings) expect(entry.judged).toBe(false)
    }).pipe(Effect.provide(modelFailing("TYPESAFE_API_KEY is not set"))),
  ),
)

it.effect("near-duplicates collapse when the cluster is judged one thing", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateMeaning, workspace)).diagnostics
      expect(findings.length).toBeGreaterThan(0)
      for (const entry of findings) {
        expect(entry.judged).toBe(true)
        expect(entry.ruleId).toBe("joggle/duplicate-meaning")
      }
    }).pipe(Effect.provide(modelStub(collapse("member_0", 0.8)))),
  ),
)

it.effect("near-duplicates stay quiet when the cluster is unrelated", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(duplicateMeaning, workspace)).diagnostics
      expect(findings.length).toBe(0)
    }).pipe(Effect.provide(modelStub({ verdict: choice("no_issue", 0.9) }))),
  ),
)

it.effect("naming drift collapses to the spelling the model chose", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(namingDrift, workspace)).diagnostics
      expect(findings.length).toBeGreaterThan(0)
      // The cluster message names every spelling it is collapsing.
      expect(findings.some((entry) => entry.message.includes("Profile"))).toBe(true)
      for (const entry of findings) expect(entry.judged).toBe(true)
    }).pipe(
      Effect.provide(
        modelStub({ verdict: choice("same_use_left", 0.85), one_concept: noul(0.9) }),
      ),
    ),
  ),
)

it("a pair that differs by one word is admitted, and the model decides", () => {
  // Whether the extra word changes what the function DOES is the question, not a
  // list of "words that do not count". `formatted` in the middle and `get` in
  // front are both admitted now; the model tells them apart.
  expect(
    worthJudging({ one: "convertUtcDateToFormattedLocalizedDateTime", two: "convertUtcDateToLocalizedDateTime" }),
  ).toBe(true)
  // And a word that adds nothing is not a difference at all.
  expect(worthJudging({ one: "getUserProfile", two: "userProfile" })).toBe(true)
  expect(worthJudging({ one: "calculateOrderTotal", two: "orderTotal" })).toBe(true)
  // Identical words, different spelling: the rule's best bucket.
  expect(worthJudging({ one: "userId", two: "userIdentifier" })).toBe(true)
  // A name against itself is not a pair.
  expect(worthJudging({ one: "parsePrice", two: "parsePrice" })).toBe(false)
})

it.effect("two distinct concepts are silence", () =>
  withWorkspace((workspace) =>
    Effect.gen(function* () {
      const findings = (yield* plannedDiagnosticsOf(namingDrift, workspace)).diagnostics
      expect(findings.length).toBe(0)
    }).pipe(
      Effect.provide(
        modelStub({ verdict: choice("no_issue", 0.9), one_concept: noul(0.1) }),
      ),
    ),
  ),
)
