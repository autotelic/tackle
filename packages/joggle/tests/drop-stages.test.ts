import { expect, test } from "vitest"
import { DropStage } from "../src/schema.ts"
import { UNJUDGED_STAGES } from "../src/check.ts"

// A stage is a fact about a candidate, and the census is only worth reading if every stage is
// classified once. `declined` and `gated` are answers -- the model looked and said no, or the
// judgement fell below the rule's threshold. Everything else is a candidate nobody looked at, and
// folding one of those into "0 findings" is the lie the invariant forbids.
const ANSWERS: ReadonlySet<string> = new Set(["declined", "gated"])

test("every drop stage is either an answer or an unjudged candidate", () => {
  const stages = DropStage.literals.map((literal) => literal)
  for (const stage of stages) {
    const classified = ANSWERS.has(stage) || UNJUDGED_STAGES.has(stage)
    expect(classified, `stage ${stage} is in neither set`).toBe(true)
    expect(ANSWERS.has(stage) && UNJUDGED_STAGES.has(stage), `stage ${stage} is in both sets`).toBe(false)
  }
})

test("a rule's ceiling and the run's token budget are different stages", () => {
  // The defect the split fixes: one word meant both facts, so a reader could not tell a rule's
  // own cap from a run that ran out of tokens -- and the run's cap relabelled a rule's drops.
  expect(DropStage.literals).toContain("ceiling")
  expect(DropStage.literals).toContain("token")
  expect(DropStage.literals).toContain("budget")
  expect(UNJUDGED_STAGES.has("ceiling")).toBe(true)
  expect(UNJUDGED_STAGES.has("token")).toBe(true)
  // The legacy spelling still totals, so an artifact written before the split reads.
  expect(UNJUDGED_STAGES.has("budget")).toBe(true)
})
