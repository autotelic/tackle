import { expect, test } from "vitest"
import { budgetReport, type BudgetRow } from "../src/rule.ts"

// prose-voice caps documented sentences at 120, Markdown sentences at 120 and string literals at
// 200. A single prose line naming one kind is a claim about a third of the rule; a free-text
// selection string is what let that through. So the rows carry the numbers and the renderer does
// the arithmetic -- and the arithmetic is what this file holds.

const row = (unitKind: string, judged: number, candidates: number, cap: number): BudgetRow => ({
  unitKind,
  judged,
  candidates,
  cap,
  sample: [],
})

test("the total is the sum of the rows, not a second opinion about them", () => {
  const lines = budgetReport("prose sentences", [
    row("documented sentences", 120, 3_941, 120),
    row("Markdown sentences", 120, 12_101, 120),
    row("string literals", 200, 994, 200),
  ])

  expect(lines[0]).toBe("judged 440 of 17036 prose sentences; 16596 unlooked")
  expect(lines).toHaveLength(4)
  // Every row is printed with its OWN cap: three kinds do not share one.
  expect(lines[1]).toContain("documented sentences: 120 of 3941 judged (cap 120)")
  expect(lines[3]).toContain("string literals: 200 of 994 judged (cap 200)")
})

test("a kind that was not bounded is not printed, and nothing bounded prints nothing", () => {
  expect(budgetReport("runs", [row("runs", 4, 4, 200)])).toEqual([])
  const lines = budgetReport("runs", [row("runs", 4, 4, 200), row("modules", 200, 412, 200)])
  expect(lines).toHaveLength(2)
  expect(lines[0]).toBe("judged 200 of 412 runs; 212 unlooked")
  expect(lines[1]).toContain("modules: 200 of 412 judged (cap 200)")
})
