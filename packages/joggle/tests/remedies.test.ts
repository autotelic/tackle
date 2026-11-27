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

test("the five plumb boundary rules normalise to one 99-site cluster", () => {
  // The target in docs/remedy-hill.md, held as a fixture rather than a comment:
  // five vocabularies for one repair, 99 sites, kernel.ts and telemetry.ts each
  // carrying 28. The labels are deliberately distinct so only the pairwise Noul
  // can join them; a Choice that agreed by label alone would not prove the
  // normalisation.
  const boundary = [
    {
      rule: "plumb/no-reinterpret-cast",
      message:
        "Type assertion discards type evidence. Narrow with discriminants/`in` checks or a type" +
        " predicate instead.",
      count: 29,
      label: "Narrow with a type predicate",
    },
    {
      rule: "plumb/require-safety-comment-for-type-assertion",
      message:
        "This type assertion has no `SAFETY:` justification. State the checked invariant" +
        " immediately before the assertion or its containing statement.",
      count: 25,
      label: "State the checked invariant",
    },
    {
      rule: "plumb/no-runtime-typeof",
      message:
        "A `typeof` check narrows a representation without establishing its contract. Parse" +
        " input at its I/O boundary, then branch on the domain value.",
      count: 23,
      label: "Parse input at the I/O boundary",
    },
    {
      rule: "plumb/no-unknown-parameters",
      message:
        "Parameter `value` leaves input unparsed. Accept a named domain type; run the expected" +
        " schema or parser at the I/O boundary before calling this function.",
      count: 11,
      label: "Accept a named domain type",
    },
    {
      rule: "plumb/no-unsafe-dictionary-type",
      message:
        "This dictionary's `string` value type gives callers no concrete value contract. Use an" +
        " owner/schema-derived value type; parse external payloads before insertion.",
      count: 11,
      label: "Use an owner/schema-derived value type",
    },
  ] as const

  const slots = [
    ...Array.from(
      { length: 28 },
      (_, index) => "packages/board/src/factory/kernel.ts:" + String(index + 1),
    ),
    ...Array.from(
      { length: 28 },
      (_, index) => "packages/board/src/factory/telemetry.ts:" + String(index + 1),
    ),
    ...Array.from(
      { length: 43 },
      (_, index) => "packages/board/src/factory/other.ts:" + String(index + 1),
    ),
  ]
  const findings: Array<RemedyFinding> = []
  const repairs: Array<readonly [RemedyFinding, string]> = []
  let cursor = 0
  for (const entry of boundary) {
    for (let index = 0; index < entry.count; index += 1) {
      const site = slots[cursor]
      cursor += 1
      if (site === undefined) throw new Error("fixture ran out of sites")
      const separator = site.lastIndexOf(":")
      const item = finding(
        entry.rule,
        entry.message,
        Number(site.slice(separator + 1)),
        site.slice(0, separator),
      )
      findings.push(item)
      repairs.push([item, entry.label])
    }
  }
  expect(findings).toHaveLength(99)
  const same = boundary.flatMap((left, leftIndex) =>
    boundary.slice(leftIndex + 1).map((right) => {
      const leftItem = repairs.find(([item]) => item.rule === left.rule)?.[0]
      const rightItem = repairs.find(([item]) => item.rule === right.rule)?.[0]
      if (leftItem === undefined || rightItem === undefined) throw new Error("missing fixture")
      return [leftItem, rightItem, 0.92] as const
    }),
  )
  const opinion = opinionOf(repairs, same)
  const report = clusterRemedies(findings, opinion)

  expect(report.witness.clusters).toBe(5)
  expect(report.clusters).toHaveLength(1)
  const cluster = report.clusters[0]
  expect(cluster?.sites).toBe(99)
  expect(cluster?.rules).toHaveLength(5)
  expect(cluster?.files.find((file) => file.file.endsWith("kernel.ts"))?.sites).toBe(28)
  expect(cluster?.files.find((file) => file.file.endsWith("telemetry.ts"))?.sites).toBe(28)
  const pair = cluster?.counterexamples.find(
    (counterexample) =>
      counterexample.a === "plumb/no-reinterpret-cast" &&
      counterexample.b === "plumb/require-safety-comment-for-type-assertion",
  )
  expect(pair?.onlyA).toHaveLength(29)
  expect(pair?.onlyB).toHaveLength(25)
  expect(pair?.reason).toContain("trigger")
})
