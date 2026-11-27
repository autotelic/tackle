import { expect, test } from "vitest"
import {
  clusterRemedies,
  findingsOf,
  messageKeyOf,
  pairKeyOf,
  witnessClause,
  type RemedyFinding,
  type RepairOpinion,
} from "../src/remedies.ts"

const finding = (
  rule: string,
  message: string,
  line: number,
  file = "src/example.ts",
): RemedyFinding => ({
  site: file + ":" + String(line),
  file,
  line,
  rule,
  message,
})

const opinionOf = (
  repairs: ReadonlyArray<readonly [RemedyFinding, string]>,
  same: ReadonlyArray<readonly [RemedyFinding, RemedyFinding, number]>,
): RepairOpinion => ({
  repairs: new Map(repairs.map(([item, label]) => [messageKeyOf(item), label])),
  same: new Map(
    same.map(([left, right, probability]) => [
      pairKeyOf(messageKeyOf(left), messageKeyOf(right)),
      probability,
    ]),
  ),
  questions: repairs.length,
  pairs: same.length,
})

test("both engines' JSON arrive unchanged", () => {
  const joggle = findingsOf({
    diagnostics: [
      {
        ruleId: "joggle/example",
        message: "A thing. Do the thing.",
        location: { file: "src/a.ts", line: 4, column: 2 },
      },
    ],
  })
  expect(joggle).toEqual([
    {
      site: "src/a.ts:4",
      file: "src/a.ts",
      line: 4,
      rule: "joggle/example",
      message: "A thing. Do the thing.",
    },
  ])

  const oxlint = findingsOf({
    diagnostics: [
      {
        code: "plumb/example",
        message: "A thing. Do the thing.",
        filename: "src/b.ts",
        labels: [{ span: { line: 9 } }],
      },
    ],
  })
  expect(oxlint[0]?.site).toBe("src/b.ts:9")
  expect(oxlint[0]?.rule).toBe("plumb/example")
})

test("the witness keeps the imperative clause and drops the diagnosis", () => {
  expect(
    witnessClause(
      "Type assertion discards type evidence. Narrow with discriminants/`in` checks or a type" +
        " predicate instead.",
    ),
  ).toBe("Narrow with discriminants/in checks or a type predicate instead")
  expect(
    witnessClause("A typeof check narrows a representation. Parse input at its I/O boundary."),
  ).toBe("Parse input at its I/O boundary")
})

test("two vocabularies for one repair cluster; a different repair does not", () => {
  const parse = finding(
    "a",
    "A typeof check narrows a representation. Parse input at its I/O boundary, then branch on" +
      " the domain value.",
    1,
    "src/kernel.ts",
  )
  const accept = finding(
    "b",
    "Parameter `value` leaves input unparsed. Accept a named domain type; run the expected" +
      " schema at the I/O boundary.",
    2,
    "src/kernel.ts",
  )
  const narrow = finding(
    "c",
    "Type assertion discards type evidence. Narrow with discriminants or a type predicate instead.",
    3,
    "src/telemetry.ts",
  )
  const opinion = opinionOf(
    [
      [parse, "Parse input at the I/O boundary"],
      [accept, "Parse input at the I/O boundary"],
      [narrow, "Narrow with a type predicate"],
    ],
    [
      [parse, accept, 0.91],
      [parse, narrow, 0.08],
      [accept, narrow, 0.12],
    ],
  )
  const report = clusterRemedies([parse, accept, narrow], opinion)
  expect(report.witness.clusters).toBe(3)
  expect(report.judgement.clusters).toBe(2)
  expect(report.clusters).toHaveLength(2)
  const repaired = report.clusters.find((cluster) =>
    cluster.rules.some((rule) => rule.rule === "a"),
  )
  expect(repaired?.rules.map((rule) => rule.rule)).toEqual(["a", "b"])
  expect(repaired?.sites).toBe(2)
  expect(repaired?.counterexamples).toHaveLength(1)
  expect(repaired?.counterexamples[0]?.onlyA).toEqual(["src/kernel.ts:1"])
  expect(repaired?.counterexamples[0]?.onlyB).toEqual(["src/kernel.ts:2"])
})

test("a threshold keeps a pair the judgement calls different apart", () => {
  const left = finding("a", "Diagnosis. Parse input at its boundary.", 1)
  const right = finding("b", "Diagnosis. Accept a named domain type.", 2)
  const opinion = opinionOf(
    [
      [left, "parse"],
      [right, "accept"],
    ],
    [[left, right, 0.49]],
  )
  const report = clusterRemedies([left, right], opinion)
  expect(report.clusters).toHaveLength(2)
})
