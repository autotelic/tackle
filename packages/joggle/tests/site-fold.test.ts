import { expect, test } from "vitest"
import { foldSiteDuplicates } from "../src/report.ts"
import { finding } from "../src/rule.ts"
import type { Diagnostic, Repair } from "../src/schema.ts"

const at = (line: number) => ({ file: "src/a.ts", line, column: 1 })
const location = at(3)
const repair: Repair = {
  operation: "merge",
  keep: location,
  remove: [],
  cascade: [],
  complete: true,
  settled: "the table and the model agree",
}

const fact = (line = 3): Diagnostic =>
  finding({
    ruleId: "joggle/reversal",
    severity: "warn",
    message: "bare, normalize are one declaration written 2 times.",
    location: at(line),
    judged: false,
    move: "contract",
  })

const judged = (line = 3, withRepair = true): Diagnostic =>
  finding({
    ruleId: "joggle/duplicate-implementation",
    severity: "warn",
    message: "2 declarations share one shape.",
    location: at(line),
    judged: true,
    move: "contract",
    panel: {
      answers: [{ question: "redundant", probability: 0.9 }],
      operation: "merge",
      derived: "merge",
      agreement: "act",
    },
    ...(withRepair ? { repair } : {}),
  })

test("a fact and a judged finding at one site and move become the richer one", () => {
  const folded = foldSiteDuplicates([fact(), judged()])
  expect(folded.folded).toBe(1)
  expect(folded.diagnostics).toHaveLength(1)
  expect(folded.diagnostics[0]?.ruleId).toBe("joggle/duplicate-implementation")
})

test("different moves at one site are different findings", () => {
  const convert = finding({
    ruleId: "joggle/compose-types",
    severity: "info",
    message: "lists every field",
    location,
    judged: true,
    move: "combine",
  })
  expect(foldSiteDuplicates([fact(), convert]).folded).toBe(0)
})

test("the same move at different lines is not a duplicate", () => {
  expect(foldSiteDuplicates([fact(3), judged(9)]).folded).toBe(0)
})

test("a judged finding without a repair still beats a bare fact", () => {
  const folded = foldSiteDuplicates([fact(), judged(3, false)])
  expect(folded.diagnostics[0]?.ruleId).toBe("joggle/duplicate-implementation")
})

test("survivors keep their original order", () => {
  const folded = foldSiteDuplicates([fact(3), fact(9), judged(3)])
  expect(folded.diagnostics.map((entry) => entry.location.line)).toEqual([3, 9])
})
