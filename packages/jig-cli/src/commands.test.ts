import fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  accept,
  diffBaseline,
  makeReport,
  type Diagnostic,
  type Report,
  type Severity,
} from "@autotelic/protocol"
import { explainRule, lesson, promotion, renderLesson, renderPromotion } from "./commands.ts"

/* The three read-only commands answer from a report and a diff. These fixtures are the
 * smallest report that makes one answer, and one property each for the part that must hold
 * for every report, not just the one I thought of. */

const diag = (input: {
  readonly engine?: string
  readonly ruleId: string
  readonly severity?: Severity
  readonly file?: string
  readonly identity?: string
  readonly help?: string
}): Diagnostic => {
  const base: Diagnostic = {
    engine: input.engine ?? "plumb",
    ruleId: input.ruleId,
    severity: input.severity ?? "error",
    message: `message for ${input.ruleId}`,
    location: { file: input.file ?? "a.ts", line: 1, column: 1 },
  }
  const withIdentity = input.identity === undefined ? base : { ...base, identity: input.identity }
  return input.help === undefined ? withIdentity : { ...withIdentity, help: input.help }
}

const reportOf = (diagnostics: ReadonlyArray<Diagnostic>): Report =>
  makeReport({
    diagnostics,
    files: new Set(diagnostics.map((d) => d.location.file)).size,
    generators: [],
  })

const diffOf = (baseline: ReadonlyArray<Diagnostic>, diagnostics: ReadonlyArray<Diagnostic>) =>
  diffBaseline(accept(baseline), diagnostics)

describe("explainRule", () => {
  it("names the configured engines when the engine is not one of them", () => {
    const text = explainRule(reportOf([]), "nope/x", ["plumb", "joggle"])
    expect(text).toContain('no configured engine named "nope"')
    expect(text).toContain("plumb, joggle")
  })

  it("says the engine ran and reported nothing, rather than silence", () => {
    const text = explainRule(reportOf([diag({ ruleId: "other" })]), "plumb/no-x", ["plumb"])
    expect(text).toContain("nothing in this run")
    expect(text).toContain("the plumb engine ran")
  })

  it("expands every finding of the rule into a work order", () => {
    const diagnostics = [
      diag({ ruleId: "no-x", file: "a.ts", help: "use Y" }),
      diag({ ruleId: "no-x", file: "b.ts" }),
      diag({ ruleId: "other" }),
    ]
    const text = explainRule(reportOf(diagnostics), "plumb/no-x", ["plumb"])
    expect(text).toContain("plumb/no-x — 2 finding(s)")
    expect(text).toContain("a.ts:1:1")
    expect(text).toContain("help: use Y")
  })

  it("matches a bare rule id across engines", () => {
    const diagnostics = [diag({ engine: "joggle", ruleId: "no-x", identity: "i" })]
    expect(explainRule(reportOf(diagnostics), "no-x", ["joggle"])).toContain("1 finding(s)")
  })
})

describe("promotion", () => {
  it("drops what no longer fires and holds what does, and never accepts the new", () => {
    const gone = diag({ ruleId: "gone", identity: "gone-1" })
    const stays = diag({ ruleId: "stays", identity: "stays-1" })
    const fresh = diag({ ruleId: "fresh", identity: "fresh-1" })
    const plan = promotion(diffOf([gone, stays], [stays, fresh]))
    expect(plan.stale).toEqual(["gone-1"])
    expect(plan.held).toEqual(["stays-1"])
    expect(plan.novel).toEqual(["fresh-1"])
  })

  it("says nothing to promote when the ledger is already tight", () => {
    const held = diag({ ruleId: "stays", identity: "stays-1" })
    const text = renderPromotion(promotion(diffOf([held], [held])))
    expect(text).toContain("nothing to promote")
  })

  it("prints the rung, and refuses to accept the new", () => {
    const gone = diag({ ruleId: "gone", identity: "gone-1" })
    const fresh = diag({ ruleId: "fresh", identity: "fresh-1" })
    const text = renderPromotion(promotion(diffOf([gone], [fresh])))
    expect(text).toContain("gone-1")
    expect(text).toContain("1 new and not accepted")
    expect(text).toContain("`jig baseline` accepts new ones")
  })

  it("partitions the ledger for every run (property)", () => {
    const found = fc.record({
      ruleId: fc.string({ minLength: 1, maxLength: 8 }),
      identity: fc.string({ minLength: 1, maxLength: 8 }),
    })
    fc.assert(
      fc.property(
        fc.array(found, { maxLength: 16 }),
        fc.array(found, { maxLength: 16 }),
        (a, b) => {
          const baseline = a.map((f) => diag(f))
          const diagnostics = b.map((f) => diag(f))
          const diff = diffOf(baseline, diagnostics)
          const plan = promotion(diff)
          const held = new Set(plan.held)
          for (const identity of plan.novel) expect(held.has(identity)).toBe(false)
          // `stale` and `held` are disjoint halves of the ledger: together they are the baseline.
          expect(plan.stale.length + plan.held.length).toBe(accept(baseline).identities.length)
        },
      ),
    )
  })
})

describe("renderLesson", () => {
  it("lists the accepted rules, and says so when there are none", () => {
    expect(renderLesson({ engines: ["plumb"], accepted: [] })).toContain("accepts no findings yet")
    const text = renderLesson({ engines: ["plumb", "joggle"], accepted: ["plumb/no-x"] })
    expect(text).toContain("plumb, joggle")
    expect(text).toContain("`plumb/no-x`")
  })

  it("reads accepted rule names off the diff's known half", () => {
    const held = diag({ ruleId: "no-x", identity: "i" })
    const l = lesson(["plumb"], diffOf([held], [held, diag({ ruleId: "new", identity: "n" })]))
    expect(l.accepted).toEqual(["plumb/no-x"])
  })

  it("names every accepted rule (property)", () => {
    const found = fc.record({
      engine: fc.constantFrom("plumb", "joggle"),
      ruleId: fc.string({ minLength: 1, maxLength: 8 }),
      identity: fc.string({ minLength: 1, maxLength: 8 }),
    })
    fc.assert(
      fc.property(fc.array(found, { maxLength: 12 }), (rows) => {
        const diagnostics = rows.map((r) => diag(r))
        const diff = diffOf(diagnostics, diagnostics)
        const text = renderLesson(lesson(["plumb", "joggle"], diff))
        for (const rule of lesson(["plumb", "joggle"], diff).accepted) {
          expect(text).toContain(rule)
        }
      }),
    )
  })
})
