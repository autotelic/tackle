#!/usr/bin/env node
// The promotion gate. A gate that only prints is not a gate, so this file's
// contract is the exit code: 0 means a head beat the baseline it was measured
// against, anything else means the head is not promoted.
//
// It reads two artifacts, and never writes one:
//
//   --verification <file>   `standin evaluate --out ...`, or any JSON carrying
//                           corpusHash, abstained, total, and per-label recall
//   --head <manifest>       the head's manifest, whose `corpusHash` names the
//                           corpus the head was trained on
//
// Plain ESM on purpose: the gate has no build step. A gate that needs compiling
// before it can refuse is a gate that can be skipped.
import { readFileSync } from "node:fs"
import { parseArgs } from "node:util"

const BUDGET = 0.2
const VIOLATION = "reimplements"

const REASONS = {
  noHead: "no-head-manifest",
  hash: "corpus-hash-mismatch",
  abstention: "abstention-exceeds-budget",
  recall: "recall-at-or-below-baseline",
  unreadable: "verification-unreadable",
}

const fixed = (value) => value.toFixed(2)

/** One line, on stdout, whether it promotes or refuses. */
const refuse = (reason, detail) => {
  process.stdout.write(`promote: refused — ${detail} (reason: ${reason})\n`)
  process.exitCode = 1
}

const accept = (detail) => {
  process.stdout.write(`promote: accepted — ${detail}\n`)
  process.exitCode = 0
}

const readJson = (path) => {
  if (typeof path !== "string" || path === "") return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"))
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

const number = (value) => (typeof value === "number" && Number.isFinite(value) ? value : undefined)

const string = (value) => (typeof value === "string" && value !== "" ? value : undefined)

/** Find a label row in `labels`, whether it is persisted as an array or a map. */
const labelRow = (report, label) => {
  if (typeof report !== "object" || report === null) return undefined
  const labels = report.labels
  if (Array.isArray(labels)) {
    const found = labels.find((row) => row && row.label === label)
    return found && typeof found === "object" ? found : undefined
  }
  if (typeof labels === "object" && labels !== null) {
    const found = labels[label]
    return found && typeof found === "object" ? found : undefined
  }
  return undefined
}

const main = () => {
  let values
  try {
    const parsed = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: false,
      options: {
        verification: { type: "string" },
        head: { type: "string" },
      },
    })
    values = parsed.values
  } catch (error) {
    refuse(
      REASONS.noHead,
      `could not read the arguments — ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  // No head first: a verification report cannot be promoted on its own, and the
  // hash check below has nothing to compare it to. The reason names that fact.
  const headPath = string(values.head)
  if (headPath === undefined) {
    refuse(REASONS.noHead, "no head manifest (--head was not given)")
    return
  }
  const head = readJson(headPath)
  const headHash = head === undefined ? undefined : string(head.corpusHash)
  if (head === undefined || headHash === undefined) {
    refuse(REASONS.noHead, `no head manifest at ${headPath} (unreadable or missing corpusHash)`)
    return
  }

  const verificationPath = string(values.verification)
  const verification = readJson(verificationPath)
  if (verification === undefined) {
    refuse(REASONS.unreadable, `no verification report at ${verificationPath ?? "(not given)"}`)
    return
  }

  const verificationHash = string(verification.corpusHash)
  if (verificationHash === undefined || verificationHash !== headHash) {
    refuse(REASONS.hash, `corpus hash ${verificationHash ?? "(none)"} != manifest ${headHash}`)
    return
  }

  const total = number(verification.total ?? verification.confusion?.total)
  const abstained = number(verification.abstained ?? verification.confusion?.abstained)
  if (total === undefined || abstained === undefined || total <= 0) {
    refuse(REASONS.unreadable, "the verification report has no total/abstained counts")
    return
  }
  const abstention = abstained / total
  if (abstention > BUDGET) {
    refuse(
      REASONS.abstention,
      `abstained ${abstained} of ${total} (${(abstention * 100).toFixed(1)}%) > ${BUDGET * 100}%`,
    )
    return
  }

  const label = string(verification.violationLabel) ?? VIOLATION
  const recall = number(
    labelRow(verification, label)?.priorWeightedRecall ?? labelRow(verification, label)?.recall,
  )
  const baselineRow = labelRow(verification.baseline, label) ?? labelRow(head.baseline, label)
  const baselineRecall = number(baselineRow?.priorWeightedRecall ?? baselineRow?.recall)
  if (recall === undefined || baselineRecall === undefined) {
    refuse(REASONS.unreadable, `the verification report has no recall for ${label}`)
    return
  }
  if (recall <= baselineRecall) {
    refuse(REASONS.recall, `recall ${fixed(recall)} <= baseline ${fixed(baselineRecall)}`)
    return
  }

  accept(
    `recall ${fixed(recall)} > baseline ${fixed(baselineRecall)}; abstained ${abstained} of ${total} (${(abstention * 100).toFixed(1)}%)`,
  )
}

main()
