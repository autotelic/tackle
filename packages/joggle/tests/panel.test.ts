import { expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { render, type Report } from "../src/report.ts"
import { duplicateImplementation } from "../src/rules/duplicate-implementation.ts"
import { plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice, modelStub, noul, rate } from "./support.ts"

/**
 * The panel is the observability the blog argues for: a finding says which
 * judgement moved the outcome, not just how sure the model was overall.
 */
const answers = {
  redundant: noul(0.9),
  role: choice("domain_concept", 0.9),
  relationship: choice("same_package", 0.9),
  verdict: choice("collapse", 0.9),
  consequence: rate(3, 0.9),
  canonical: choice("member_0", 0.9),
  difference: choice("value", 0.9),
  prescription: choice("merge", 0.9),
  operation: choice("merge", 0.9),
}

const run = () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace("tests/fixtures/corpus", ["src"])
    return yield* plannedDiagnosticsOf(duplicateImplementation, workspace)
  }).pipe(Effect.provide(modelStub(answers)), Effect.provide(NodeServices.layer))

const reportOf = (diagnostics: Report["diagnostics"]): Report => ({
  diagnostics,
  files: 2,
  rules: 1,
  structure: { concepts: 1, declarations: 2, duplicated: 2, overloaded: 0 },
  skipped: [],
  notes: [],
  drops: [],
  timings: [],
  decision: { requests: 1, replayed: 0, calls: 1, unavailable: 0, inputTokens: 0, outputTokens: 0 },
  elapsedMs: 0,
  replayed: false,
})

it.effect("a judged finding carries every question, both operations, and the agreement", () =>
  Effect.gen(function* () {
    const result = yield* run()
    const finding = result.diagnostics.find((entry) => entry.panel !== undefined)
    expect(finding).toBeDefined()
    const panel = finding?.panel
    if (panel === undefined) return

    // Every decision the collapse questionnaire asked is in the panel.
    const questions = panel.answers.map((answer) => answer.question)
    for (const question of [
      "redundant",
      "role",
      "relationship",
      "verdict",
      "consequence",
      "canonical",
      "difference",
      "prescription",
      "operation",
    ]) {
      expect(questions).toContain(question)
    }
    // Each answer says what it answered and how strongly.
    for (const answer of panel.answers) {
      expect(answer.label !== undefined || answer.probability !== undefined).toBe(true)
    }
    const redundant = panel.answers.find((answer) => answer.question === "redundant")
    expect(redundant?.probability).toBe(0.9)
    const verdict = panel.answers.find((answer) => answer.question === "verdict")
    expect(verdict?.label).toBe("collapse")
    expect(verdict?.probability).toBe(0.9)

    // The two estimators, and whether they agreed.
    expect(panel.operation).toBe("merge")
    expect(panel.derived).toBe("merge")
    expect(panel.agreement).toBe("act")
  }),
)

it.effect("the panel travels through the JSON output", () =>
  Effect.gen(function* () {
    const result = yield* run()
    const parsed = JSON.parse(render(reportOf(result.diagnostics), "json")) as {
      diagnostics: ReadonlyArray<{ panel?: { answers: ReadonlyArray<{ question: string }> } }>
    }
    const withPanel = parsed.diagnostics.find((entry) => entry.panel !== undefined)
    expect(withPanel).toBeDefined()
    expect(withPanel?.panel?.answers.map((answer) => answer.question)).toContain("canonical")
  }),
)

it.effect("the panel is printed under the finding in the text output", () =>
  Effect.gen(function* () {
    const result = yield* run()
    const text = render(reportOf(result.diagnostics), "text")
    expect(text).toContain("judged:")
    expect(text).toContain("redundant 0.90")
    expect(text).toContain("verdict collapse 0.90")
    expect(text).toContain("table merge")
  }),
)
