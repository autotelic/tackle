import { Result, Schema, SchemaParser } from "effect"
import { expect, test } from "vitest"
import {
  clusterRemedies,
  FindingsPayload,
  findingsOf,
  impliedRepairsOf,
  messageKeyOf,
  pairKeyOf,
  witnessClause,
  witnessOnlyOpinion,
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
      pairKeyOf({ left: messageKeyOf(left), right: messageKeyOf(right) }),
      probability,
    ]),
  ),
  failures: [],
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

test("the findings JSON is decoded at one named boundary", () => {
  const decode = SchemaParser.decodeResult(Schema.fromJsonString(FindingsPayload))
  expect(
    Result.isSuccess(
      decode(JSON.stringify([{ code: "plumb/a", message: "Do it.", filename: "a.ts" }])),
    ),
  ).toBe(true)
  expect(Result.isSuccess(decode(JSON.stringify({ diagnostics: "not an array" })))).toBe(false)
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
  expect(report.judgementStatus).toBe("complete")
  expect(report.answeredPairs).toBe(3)
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

test("a missing judgement keeps the witness count and carries the reason", () => {
  const left = finding("a", "Diagnosis. Parse input at its boundary.", 1)
  const right = finding("b", "Diagnosis. Accept a named domain type.", 2)
  const report = clusterRemedies(
    [left, right],
    witnessOnlyOpinion([left, right], "TYPESAFE_API_KEY is not set"),
  )
  expect(report.judgementUnavailable).toBe("TYPESAFE_API_KEY is not set")
  expect(report.judgementStatus).toBe("witness-only")
  expect(report.answeredPairs).toBe(0)
  expect(report.clusters).toHaveLength(report.witness.clusters)
})

test("a run that answered some pairs is partial, not witness-only", () => {
  const left = finding("a", "Diagnosis. Parse input at its boundary.", 1)
  const right = finding("b", "Diagnosis. Accept a named domain type.", 2)
  const third = finding("c", "Diagnosis. Narrow with a type predicate.", 3)
  const opinion: RepairOpinion = {
    repairs: new Map([
      [messageKeyOf(left), "parse"],
      [messageKeyOf(right), "accept"],
    ]),
    same: new Map([[pairKeyOf({ left: messageKeyOf(left), right: messageKeyOf(right) }), 0.91]]),
    failures: ["InvalidRequestError: max_tokens_exceeded"],
    questions: 3,
    pairs: 3,
  }
  const report = clusterRemedies([left, right, third], opinion)
  expect(report.judgementStatus).toBe("partial")
  expect(report.answeredPairs).toBe(1)
  expect(report.answeredRepairs).toBe(2)
  expect(report.judgementFailures).toEqual(["InvalidRequestError: max_tokens_exceeded"])
  expect(report.clusters).toHaveLength(2)
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

test("the boundary rules are three repairs the judgement finds and the witness cannot", () => {
  // The old target in docs/remedy-hill.md -- five rules, one 99-site cluster --
  // was refuted by the first full measurement. What was measured: the witness
  // cannot merge any of them, and the judgement merges only the pair no witness
  // can, leaving the other boundary rules apart. This fixture holds the measured
  // shape so the doc cannot drift back to the hypothesis.
  const at = (site: string, rule: string, message: string): RemedyFinding => {
    const separator = site.lastIndexOf(":")
    return finding(rule, message, Number(site.slice(separator + 1)), site.slice(0, separator))
  }
  const sites = (file: string, count: number, offset = 0): Array<string> =>
    Array.from({ length: count }, (_, index) => file + ":" + String(offset + index + 1))

  const parse =
    "A `typeof` check narrows a representation without establishing its contract. Parse" +
    " input at its I/O boundary, then branch on the domain value."
  const accept =
    "Parameter `value` leaves input unparsed. Accept a named domain type; run the expected" +
    " schema or parser at the I/O boundary before calling this function."
  const narrow =
    "Type assertion discards type evidence. Narrow with discriminants/`in` checks or a type" +
    " predicate instead."
  const comment =
    "This type assertion has no `SAFETY:` justification. State the checked invariant" +
    " immediately before the assertion or its containing statement."
  const dictionary =
    "This dictionary's `string` value type gives callers no concrete value contract. Use an" +
    " owner/schema-derived value type; parse external payloads before insertion."

  const kernel = sites("packages/board/src/factory/kernel.ts", 23)
  const shared = kernel.slice(0, 2)
  const unknownSites = [...shared, ...sites("packages/board/src/factory/other.ts", 10)]
  const castSites = sites("packages/board/src/factory/telemetry.ts", 29)
  const commentSites = sites("packages/board/src/factory/safety.ts", 26)
  const dictionarySites = sites("packages/board/src/factory/dictionary.ts", 11)

  const findings: Array<RemedyFinding> = [
    ...kernel.map((site) => at(site, "plumb/no-runtime-typeof", parse)),
    ...unknownSites.map((site) => at(site, "plumb/no-unknown-parameters", accept)),
    ...castSites.map((site) => at(site, "plumb/no-reinterpret-cast", narrow)),
    // 30 findings over 29 sites: one site carries the rule twice.
    at(
      castSites[0] ?? "packages/board/src/factory/telemetry.ts:1",
      "plumb/no-reinterpret-cast",
      narrow,
    ),
    ...commentSites.map((site) =>
      at(site, "plumb/require-safety-comment-for-type-assertion", comment),
    ),
    ...dictionarySites.map((site) => at(site, "plumb/no-unsafe-dictionary-type", dictionary)),
  ]

  const labelOf = new Map<string, string>([
    ["plumb/no-runtime-typeof", "Parse input at the I/O boundary"],
    ["plumb/no-unknown-parameters", "Accept a named domain type"],
    ["plumb/no-reinterpret-cast", "Narrow with a type predicate"],
    ["plumb/require-safety-comment-for-type-assertion", "State the checked invariant"],
    ["plumb/no-unsafe-dictionary-type", "Use an owner/schema-derived value type"],
  ])
  const representatives = [...labelOf.keys()].flatMap((rule) => {
    const item = findings.find((candidate) => candidate.rule === rule)
    return item === undefined ? [] : [item]
  })
  const repairs = representatives.map(
    (item) => [item, labelOf.get(item.rule) ?? "unknown"] as const,
  )
  // The judgement agrees on exactly the pair the witness cannot: the merged
  // repair is `no-runtime-typeof` + `no-unknown-parameters` (33 sites). Every
  // other pair stays independent.
  const same = representatives.flatMap((left, leftIndex) =>
    representatives.slice(leftIndex + 1).map((right) => {
      const merged =
        (left.rule === "plumb/no-runtime-typeof" &&
          right.rule === "plumb/no-unknown-parameters") ||
        (left.rule === "plumb/no-unknown-parameters" &&
          right.rule === "plumb/no-runtime-typeof")
      return [left, right, merged ? 0.92 : 0.08] as const
    }),
  )
  const report = clusterRemedies(findings, opinionOf(repairs, same))

  expect(report.witness.clusters).toBe(5)
  expect(report.clusters).toHaveLength(4)
  const merged = report.clusters.find((cluster) =>
    cluster.rules.some((rule) => rule.rule === "plumb/no-runtime-typeof"),
  )
  expect(merged?.rules.map((rule) => rule.rule).sort()).toEqual([
    "plumb/no-runtime-typeof",
    "plumb/no-unknown-parameters",
  ])
  expect(merged?.sites).toBe(33)
  expect(merged?.findings).toBe(35)
  const cast = report.clusters.find((cluster) =>
    cluster.rules.some((rule) => rule.rule === "plumb/no-reinterpret-cast"),
  )
  expect(cast?.sites).toBe(29)
  expect(cast?.findings).toBe(30)
  const safety = report.clusters.find((cluster) =>
    cluster.rules.some((rule) => rule.rule === "plumb/require-safety-comment-for-type-assertion"),
  )
  expect(safety?.sites).toBe(26)
  expect(safety?.findings).toBe(26)
  // The fifth boundary rule is below them, not inside them.
  const dictionaryCluster = report.clusters.find((cluster) =>
    cluster.rules.some((rule) => rule.rule === "plumb/no-unsafe-dictionary-type"),
  )
  expect(dictionaryCluster?.rules).toHaveLength(1)
})

test("a judgement's `none` never becomes a cluster label", () => {
  const command = finding(
    "effecttsgo/experimental-api-usage",
    "@effect/ui/Command#make is an experimental API",
    1,
  )
  const head = finding(
    "effecttsgo/experimental-api-usage",
    "@effect/ui/Head#title is an experimental API",
    2,
  )
  const anonymous = opinionOf(
    [
      [command, "none"],
      [head, "none"],
    ],
    [[command, head, 0.94]],
  )
  const report = clusterRemedies([command, head], anonymous)
  expect(report.clusters).toHaveLength(1)
  expect(report.clusters[0]?.sites).toBe(2)
  expect(report.clusters[0]?.remedy).not.toBe("none")

  const named = opinionOf(
    [
      [command, "Use the non-experimental API"],
      [head, "Use the non-experimental API"],
    ],
    [[command, head, 0.94]],
  )
  expect(clusterRemedies([command, head], named).clusters[0]?.remedy).toBe(
    "Use the non-experimental API",
  )
})

test("a diagnosis-only message offers the repair it implies", () => {
  expect(impliedRepairsOf("@effect/ui/Command#make is an experimental API")).toEqual([
    "Use the non-experimental API",
  ])
  expect(impliedRepairsOf("Narrow with a type predicate")).toEqual([])
  expect(impliedRepairsOf("none")).toEqual([])
})
