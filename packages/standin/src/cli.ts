import { readFileSync, writeFileSync } from "node:fs"
import { parseArgs } from "node:util"
import {
  OBSERVED_PRIOR,
  OBSERVED_PRIOR_SOURCE,
  VIOLATION_LABEL,
  baseline,
  evaluate,
  headFromAnswers,
  loadCorpus,
  type AnswerMap,
  type CorpusHead,
} from "./evaluate.ts"
import { MissLedger } from "./misses.ts"

const usage =
  "usage: standin misses --ledger <path> [--format text|json]\n" +
  "       text: one line per miss, sorted by count then hash\n" +
  '       json: { "misses": [...] } with the ledger rows\n' +
  "       standin baseline --corpus <jsonl> --prior <share> --out <json>\n" +
  "       standin evaluate --corpus <jsonl> --head <manifest|none> --threshold <n> --out <json>\n" +
  "       baseline: the constant-majority predictor, prior-weighted and balanced\n" +
  "       evaluate: precision/recall at a threshold, with unlooked counted as neither"

const fail = (message: string): number => {
  process.stderr.write(message + "\n" + usage + "\n")
  return 1
}

const write = (text: string): void => {
  process.stdout.write(text.endsWith("\n") ? text : text + "\n")
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readFile = (path: string, what: string): string | number => {
  try {
    return readFileSync(path, "utf8")
  } catch (error) {
    return fail(
      "could not read the " +
        what +
        " at " +
        path +
        ": " +
        (error instanceof Error ? error.message : String(error)),
    )
  }
}

const writeJson = (path: string, value: unknown): number => {
  try {
    writeFileSync(path, JSON.stringify(value, null, 2) + "\n")
    return 0
  } catch (error) {
    return fail(
      "could not write " + path + ": " + (error instanceof Error ? error.message : String(error)),
    )
  }
}

const parseShare = (text: string | undefined): number | undefined => {
  if (text === undefined || text === "") return undefined
  const share = Number(text)
  if (!Number.isFinite(share) || share < 0 || share > 1) return undefined
  return share
}

const stringOption = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined

const numberOption = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

/**
 * `standin misses` — read a ledger and print it.
 *
 * This is the thin boundary: parse the arguments, load the artifact, hand the ledger to
 * the renderer. No judging lives here, and no ledger is written, because a report is not
 * allowed to edit the thing it reports on.
 */
const misses = (argv: ReadonlyArray<string>): number => {
  let values: { readonly ledger?: string | undefined; readonly format?: string | undefined }
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        ledger: { type: "string" },
        format: { type: "string", default: "text" },
      },
    })
    values = parsed.values
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  const ledgerPath = values.ledger
  if (ledgerPath === undefined || ledgerPath === "") {
    return fail("expected --ledger <path>")
  }
  const format = values.format ?? "text"
  if (format !== "text" && format !== "json") {
    return fail("expected --format text or --format json")
  }

  const text = readFile(ledgerPath, "ledger")
  if (typeof text === "number") return text

  const ledger = MissLedger.decode(text)
  if (format === "json") {
    write(JSON.stringify({ misses: ledger.snapshot() }, null, 2))
    return 0
  }
  const rendered = ledger.render()
  if (rendered !== "") write(rendered)
  return 0
}

/**
 * `standin baseline` — the constant-majority predictor, both numbers named.
 *
 * The prior is not optional here. A balanced corpus cannot say what the majority
 * share is in the ledger, and a baseline computed from the corpus would be the
 * flattering 50% this command exists to keep out of the gate.
 */
const baselineCommand = (argv: ReadonlyArray<string>): number => {
  let values: Record<string, unknown>
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        corpus: { type: "string" },
        prior: { type: "string" },
        majority: { type: "string" },
        source: { type: "string" },
        out: { type: "string" },
      },
    })
    values = parsed.values
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  const corpusPath = stringOption(values["corpus"])
  if (corpusPath === undefined) return fail("expected --corpus <jsonl>")
  const prior = parseShare(stringOption(values["prior"]))
  if (prior === undefined) return fail("expected --prior <share between 0 and 1>")
  const out = stringOption(values["out"])
  if (out === undefined) return fail("expected --out <json>")

  const text = readFile(corpusPath, "corpus")
  if (typeof text === "number") return text
  const corpus = loadCorpus(text)
  const report = baseline({
    corpus,
    corpusPath,
    prior,
    majorityLabel: stringOption(values["majority"]),
    source: stringOption(values["source"]) ?? OBSERVED_PRIOR_SOURCE,
  })
  return writeJson(out, report)
}

/**
 * `standin evaluate` — score a head, or say that there was none.
 *
 * `--head none` is a real input, not a missing argument: every item is unlooked
 * and the report says so. A manifest's answer map is the head; the protocol is a
 * map from item hash to label, so no model is imported and none is implied.
 */
const evaluateCommand = (argv: ReadonlyArray<string>): number => {
  let values: Record<string, unknown>
  try {
    const parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        corpus: { type: "string" },
        head: { type: "string" },
        threshold: { type: "string", default: "0.5" },
        prior: { type: "string" },
        majority: { type: "string" },
        violation: { type: "string" },
        source: { type: "string" },
        name: { type: "string" },
        out: { type: "string" },
      },
    })
    values = parsed.values
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error))
  }

  const corpusPath = stringOption(values["corpus"])
  if (corpusPath === undefined) return fail("expected --corpus <jsonl>")
  const headPath = stringOption(values["head"])
  if (headPath === undefined) return fail("expected --head <manifest|none>")
  const threshold = parseShare(stringOption(values["threshold"]) ?? "0.5")
  if (threshold === undefined) return fail("expected --threshold between 0 and 1")
  const out = stringOption(values["out"])
  if (out === undefined) return fail("expected --out <json>")

  const text = readFile(corpusPath, "corpus")
  if (typeof text === "number") return text
  const corpus = loadCorpus(text)

  let head: CorpusHead | undefined
  let headName: string | undefined
  let prior = parseShare(stringOption(values["prior"])) ?? OBSERVED_PRIOR
  let majorityLabel = stringOption(values["majority"])
  if (headPath !== "none") {
    const headText = readFile(headPath, "head manifest")
    if (typeof headText === "number") return headText
    let manifest: unknown
    try {
      manifest = JSON.parse(headText)
    } catch (error) {
      return fail(
        "could not parse the head manifest at " +
          headPath +
          ": " +
          (error instanceof Error ? error.message : String(error)),
      )
    }
    if (!isRecord(manifest)) return fail("the head manifest at " + headPath + " is not an object")
    const answers = manifest["answers"]
    head = headFromAnswers(isRecord(answers) ? (answers as AnswerMap) : {})
    headName = stringOption(values["name"]) ?? stringOption(manifest["name"]) ?? headPath
    const manifestPrior = numberOption(manifest["prior"])
    if (manifestPrior !== undefined) prior = manifestPrior
    majorityLabel = majorityLabel ?? stringOption(manifest["majorityLabel"])
  }

  const report = evaluate({
    items: corpus.items,
    corpusHash: corpus.corpusHash,
    corpusPath,
    head,
    headName,
    threshold,
    prior,
    majorityLabel,
    source: stringOption(values["source"]) ?? OBSERVED_PRIOR_SOURCE,
    violationLabel: stringOption(values["violation"]) ?? VIOLATION_LABEL,
  })
  return writeJson(out, report)
}

/** Dispatch one command. The `misses` contract does not move. */
export const main = (argv: ReadonlyArray<string>): number => {
  const command = argv[0]
  if (command === "misses") return misses(argv)
  if (command === "baseline") return baselineCommand(argv.slice(1))
  if (command === "evaluate") return evaluateCommand(argv.slice(1))
  return fail("expected one of `misses`, `baseline`, or `evaluate`")
}

process.exitCode = main(process.argv.slice(2))
