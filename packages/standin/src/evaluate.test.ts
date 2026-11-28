import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import {
  baseline,
  evaluate,
  headFromAnswers,
  loadCorpus,
  type CorpusHead,
  type EvaluationReport,
} from "./evaluate.ts"

const corpusText = readFileSync(
  fileURLToPath(new URL("../../joggle/testdata/single-path-corpus.jsonl", import.meta.url)),
  "utf8",
)
const corpus = loadCorpus(corpusText)
const promote = fileURLToPath(new URL("../scripts/promote.mjs", import.meta.url))
const items = corpus.items

const labelRow = <Row extends { readonly label: string }>(
  report: { readonly labels: ReadonlyArray<Row> },
  label: string,
): Row | undefined => report.labels.find((row) => row.label === label)

/** Run the gate over two temp artifacts and hand back what a terminal would show. */
const gate = (verification: unknown, head: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), "standin-promote-"))
  const verificationPath = join(dir, "verification.json")
  const headPath = join(dir, "head.json")
  writeFileSync(verificationPath, JSON.stringify(verification))
  writeFileSync(headPath, JSON.stringify(head))
  return spawnSync(
    process.execPath,
    [promote, "--verification", verificationPath, "--head", headPath],
    { encoding: "utf8" },
  )
}

const runWith = (verification: unknown, headPath?: string) => {
  const dir = mkdtempSync(join(tmpdir(), "standin-gate-"))
  const verificationPath = join(dir, "verification.json")
  writeFileSync(verificationPath, JSON.stringify(verification))
  const args =
    headPath === undefined
      ? [promote, "--verification", verificationPath]
      : [promote, "--verification", verificationPath, "--head", headPath]
  return spawnSync(process.execPath, args, { encoding: "utf8" })
}

const manifest = (hash: string) => ({
  kind: "standin/head-manifest",
  name: "fixture",
  corpusHash: hash,
})

const reportFor = (head: CorpusHead | undefined): EvaluationReport =>
  evaluate({
    items,
    corpusHash: corpus.corpusHash,
    head,
    threshold: 0.5,
    prior: 0.85,
    majorityLabel: "legitimate_local",
  })

describe("the balanced corpus, weighted the way the ledger is", () => {
  test("the constant-majority predictor is 0.85 prior-weighted and 0.50 balanced", () => {
    const report = baseline({ corpus, prior: 0.85 })

    // The corpus is 50/50, so the hash is the committed split's, not a subset.
    expect(report.corpusHash).toBe("17492e76253d4ce0")
    expect(report.support).toBe(100)

    // Two numbers, two names. A balanced corpus says 0.50; the ledger says 0.85.
    expect(report.priorWeightedAccuracy).toBeCloseTo(0.85)
    expect(report.balancedAccuracy).toBeCloseTo(0.5)

    const majority = report.labels.find((row) => row.majority)
    expect(majority?.label).toBe("legitimate_local")
    expect(majority?.support).toBe(50)
    expect(majority?.priorWeightedAccuracy).toBeCloseTo(0.85)

    const violation = report.labels.find((row) => row.label === "reimplements")
    expect(violation?.support).toBe(50)
    expect(violation?.constantAccuracy).toBe(0)
    expect(violation?.priorWeightedAccuracy).toBe(0)
    // Every label's balanced share is 1/labels, the other number by name.
    expect(violation?.balancedAccuracy).toBeCloseTo(0.5)
  })
})

describe("the head that only learned the majority", () => {
  test("has no recall on the violation label and the gate refuses it", () => {
    const head: CorpusHead = () => ({ label: "legitimate_local" })
    const report = reportFor(head)

    expect(labelRow(report, "reimplements")?.priorWeightedRecall).toBe(0)
    expect(report.confusion.correct).toBe(50)
    expect(report.confusion.wrong).toBe(50)
    expect(report.confusion.abstained).toBe(0)

    const result = gate(report, manifest(report.corpusHash))
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("recall-at-or-below-baseline")
    expect(result.stdout).toContain("recall 0.00 <= baseline 0.00")
  })
})

describe("a fixture head with no model at all", () => {
  test("answers 60 of 100 correctly, clears the violation baseline, and is promoted", () => {
    // The map is the head: every violation item, ten legitimate items, and a wrong
    // answer for the rest of the legitimate ones. Sixty labels are right; no model
    // and no probability are involved.
    const answers: Record<string, string> = {}
    let legitimate = 0
    for (const item of items) {
      if (item.label === "reimplements") {
        answers[item.hash] = "reimplements"
        continue
      }
      legitimate += 1
      answers[item.hash] = legitimate <= 10 ? "legitimate_local" : "reimplements"
    }
    const report = reportFor(headFromAnswers(answers))

    expect(report.confusion.correct).toBe(60)
    expect(report.confusion.abstained).toBe(0)
    const recall = labelRow(report, "reimplements")?.priorWeightedRecall ?? 0
    const baselineRecall = labelRow(report.baseline, "reimplements")?.priorWeightedRecall ?? 0
    expect(recall).toBe(1)
    expect(recall).toBeGreaterThan(baselineRecall)

    const result = gate(report, manifest(report.corpusHash))
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("promote: accepted")
    expect(result.stdout).toContain("recall 1.00 > baseline 0.00")
  })
})

describe("abstention is unlooked, not wrong", () => {
  test("every item is in the abstained bucket and the gate refuses on the budget", () => {
    const head: CorpusHead = () => undefined
    const report = reportFor(head)

    expect(report.confusion.total).toBe(100)
    expect(report.confusion.correct).toBe(0)
    expect(report.confusion.wrong).toBe(0)
    expect(report.confusion.abstained).toBe(100)
    expect(report.confusion.judged).toBe(0)
    expect(report.confusion.correct + report.confusion.wrong + report.confusion.abstained).toBe(
      report.confusion.total,
    )

    const result = gate(report, manifest(report.corpusHash))
    expect(result.status).not.toBe(0)
    // The budget fires before recall: an unlooked item is not a wrong answer, and
    // the gate must not report it as one.
    expect(result.stdout).toContain("abstention-exceeds-budget")
    expect(result.stdout).not.toContain("recall-at-or-below-baseline")
  })

  test("no head at all says every item is unlooked", () => {
    const report = reportFor(undefined)
    expect(report.head.present).toBe(false)
    expect(report.note).toBe("no head: every item is unlooked")
    expect(report.confusion.abstained).toBe(100)
  })
})

describe("the gate is the exit code", () => {
  test("with no --head it refuses and names the reason", () => {
    const result = runWith(reportFor(undefined), undefined)
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("no-head-manifest")
    expect(result.stdout).toContain("no head manifest")
  })

  test("a verification from another corpus is refused before either number is read", () => {
    const report = { ...reportFor(undefined), corpusHash: "0000000000000000" }
    const result = gate(report, manifest(corpus.corpusHash))
    expect(result.status).not.toBe(0)
    expect(result.stdout).toContain("corpus-hash-mismatch")
    expect(result.stdout).toContain("0000000000000000")
  })
})
