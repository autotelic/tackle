import { createHash } from "node:crypto"

/*
 * The baseline, the evaluation, and the numbers the promotion gate reads.
 *
 * A corpus emitted for `joggle/single-path` is balanced on purpose: equal support
 * is what makes a near-miss visible. It is also what makes a naive majority
 * baseline look like 50%. The ledger says the same shape is 85% majority, so
 * every number here is reported twice -- once balanced, once prior-weighted --
 * under different names. Borrowing one for the other is the mistake this file
 * exists to make impossible: a balanced corpus flatters a head by construction,
 * and a promotion gate that read the balanced accuracy would promote the
 * constant-majority predictor.
 *
 * Three buckets, always: judged-correct, judged-wrong, and unlooked. A head that
 * abstains has not said "no"; it has not looked, and the denominator of every
 * rate says which of the three it used.
 */

/** The label a conformance head is supposed to catch. */
export const VIOLATION_LABEL = "reimplements"

/** The ledger's observed majority share for the single-path shape. */
export const OBSERVED_PRIOR = 0.85

/** The ledger's majority label for the single-path shape. */
export const OBSERVED_MAJORITY_LABEL = "legitimate_local"

/**
 * Where `OBSERVED_PRIOR` comes from.
 *
 * The corpus is balanced 50/50; the ledger is not. This sentence travels with
 * every artifact so a reader can tell a prior-weighted number from a balanced
 * one without opening the ledger.
 */
export const OBSERVED_PRIOR_SOURCE =
  "ledger shape legitimate_local/not_a_derivation/reimplements, n=1,753, 85% majority"

/** The prior used to weight a report, and the labels it splits the remainder across. */
export interface PriorStatement {
  readonly majority: number
  readonly majorityLabel: string
  readonly source: string
  readonly weights: Readonly<Record<string, number>>
}

/**
 * One observation, as a corpus line offers it.
 *
 * `hash` identifies the observation a head answers: the question and its state,
 * not the label or the generator's provenance. A label in the hash would let a
 * head look up the answer by changing the question.
 */
export interface CorpusItem {
  readonly hash: string
  readonly label: string
  readonly question: unknown
  readonly state: unknown
}

/** A parsed corpus and the hash its manifest would carry. */
export interface Corpus {
  readonly items: ReadonlyArray<CorpusItem>
  readonly corpusHash: string
}

/** One answer a head can give: a label, and the probability it stands behind it with. */
export interface HeadAnswer {
  readonly label: string
  readonly probability?: number
}

/** A head over one observation. `undefined` is an abstention, never a zero. */
export type CorpusHead = (item: CorpusItem) => HeadAnswer | undefined

/** The persisted form of a head: item hash to label, or to label and probability. */
export type AnswerMap = Readonly<
  Record<string, string | { readonly label: string; readonly probability?: number }>
>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** Twelve places, so a prior split does not persist 0.15000000000000002. */
const round = (value: number): number => Math.round(value * 1e12) / 1e12

/**
 * Stable JSON, byte-compatible with joggle's `canonical`.
 *
 * The corpus hash is shared with the generating tool, so this is not free to be
 * merely equivalent: key order and separators have to match or the gate refuses
 * a corpus that is actually current.
 */
export const canonical = (value: unknown): string => {
  const encode = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map((entry) => encode(entry))
    if (isRecord(input)) {
      const out: Record<string, unknown> = {}
      for (const key of Object.keys(input).sort((left, right) => left.localeCompare(right))) {
        out[key] = encode(input[key])
      }
      return out
    }
    return input
  }
  return JSON.stringify(encode(value))
}

/** A short content hash, the same width joggle uses for corpus and item identity. */
export const shortHash = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 16)

/** The identity of one observation: its question and its state. */
export const itemHashOf = (item: { readonly question: unknown; readonly state: unknown }): string =>
  shortHash(canonical({ question: item.question, state: item.state }))

/**
 * The hash of a corpus, over the sorted canonical items.
 *
 * Sorting is what lets a reordered file keep its identity, and canonical JSON is
 * what lets a reformatted one keep it too. A changed byte still changes the hash.
 */
export const corpusHashOf = (items: ReadonlyArray<unknown>): string =>
  shortHash(
    items
      .map((item) => canonical(item))
      .sort((left, right) => left.localeCompare(right))
      .join("\n"),
  )

/**
 * Read a corpus defensively.
 *
 * A malformed line is skipped rather than made a finding: the hash then covers
 * what was read, and the gate refuses a corpus that no longer matches the head's
 * manifest. Silence about the skipped line would be worse than either.
 */
export const loadCorpus = (text: string): Corpus => {
  const raw: Array<unknown> = []
  const items: Array<CorpusItem> = []
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    raw.push(parsed)
    if (!isRecord(parsed)) continue
    const label = parsed["label"]
    if (typeof label !== "string") continue
    items.push({
      hash: itemHashOf({ question: parsed["question"], state: parsed["state"] }),
      label,
      question: parsed["question"],
      state: parsed["state"],
    })
  }
  return { items, corpusHash: corpusHashOf(raw) }
}

const labelCounts = (items: ReadonlyArray<CorpusItem>): ReadonlyMap<string, number> => {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.label, (counts.get(item.label) ?? 0) + 1)
  return counts
}

/** Labels in descending support, ties broken by name so two runs order the same. */
const orderedLabels = (counts: ReadonlyMap<string, number>): ReadonlyArray<string> =>
  [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([label]) => label)

/** The label the prior calls the majority. A balanced corpus cannot answer this. */
const resolveMajority = (
  labels: ReadonlyArray<string>,
  counts: ReadonlyMap<string, number>,
  requested: string | undefined,
): string => {
  if (requested !== undefined) return requested
  return labels[0] ?? OBSERVED_MAJORITY_LABEL
}

/**
 * Split the prior across the labels: the majority takes its observed share and
 * the rest divide the remainder evenly.
 *
 * The corpus does not carry the ledger's minority split, and inventing one would
 * make a precision look more measured than it is. An even split is the one
 * assumption that changes no recall on any single label.
 */
const priorWeightsOf = (
  labels: ReadonlyArray<string>,
  majorityLabel: string,
  majorityShare: number,
): Readonly<Record<string, number>> => {
  const rest = labels.filter((label) => label !== majorityLabel)
  const each = rest.length === 0 ? 0 : round((1 - majorityShare) / rest.length)
  const weights: Record<string, number> = {}
  for (const label of labels) weights[label] = label === majorityLabel ? majorityShare : each
  return weights
}

const priorStatementOf = (
  labels: ReadonlyArray<string>,
  counts: ReadonlyMap<string, number>,
  prior: number,
  majorityLabel: string | undefined,
  source: string,
): PriorStatement => {
  const majority = resolveMajority(labels, counts, majorityLabel)
  return {
    majority: prior,
    majorityLabel: majority,
    source,
    weights: priorWeightsOf(labels, majority, prior),
  }
}

/** One label's baseline: what the constant-majority predictor does to it. */
export interface BaselineLabel {
  readonly label: string
  readonly support: number
  readonly majority: boolean
  readonly prior: number
  /** Accuracy on this label's own items: 1 for the majority, 0 for every other. */
  readonly constantAccuracy: number
  /** The same number as a recall, which is what the gate compares a head against. */
  readonly recall: number
  /** Recall is unchanged by reweighting within a class, and is stated so on purpose. */
  readonly priorWeightedRecall: number
  /** The prior-weighted contribution to the overall accuracy. */
  readonly priorWeightedAccuracy: number
  /** A constant predictor on a balanced L-label split is right 1/L of the time. */
  readonly balancedAccuracy: number
}

/** The constant-majority baseline, with balanced and prior-weighted numbers named apart. */
export interface BaselineReport {
  readonly kind: "standin/baseline"
  readonly corpus: string | null
  readonly corpusHash: string
  readonly support: number
  readonly labels: ReadonlyArray<BaselineLabel>
  readonly prior: PriorStatement
  readonly priorWeightedAccuracy: number
  readonly balancedAccuracy: number
}

/**
 * The baseline, both ways.
 *
 * `priorWeightedAccuracy` is the number to compare a candidate against: it is
 * what the constant-majority predictor scores once the balanced corpus is
 * reweighted to the ledger's shape. `balancedAccuracy` is the number that makes
 * a balanced corpus look harmless (1/labels). They are both returned, under
 * names that say which is which.
 */
export const baseline = ({
  corpus,
  prior = OBSERVED_PRIOR,
  majorityLabel,
  source = OBSERVED_PRIOR_SOURCE,
  corpusPath,
}: {
  readonly corpus: Corpus | ReadonlyArray<CorpusItem>
  readonly prior?: number
  readonly majorityLabel?: string | undefined
  readonly source?: string | undefined
  readonly corpusPath?: string | undefined
}): BaselineReport => {
  const loaded: Corpus = Array.isArray(corpus)
    ? { items: corpus, corpusHash: "" }
    : (corpus as Corpus)
  const items = loaded.items
  const corpusHash = loaded.corpusHash
  const counts = labelCounts(items)
  const labels = orderedLabels(counts)
  const statement = priorStatementOf(labels, counts, prior, majorityLabel, source)
  const rows: Array<BaselineLabel> = []
  let priorWeightedAccuracy = 0
  let balancedAccuracy = 0
  for (const label of labels) {
    const support = counts.get(label) ?? 0
    const constantAccuracy = label === statement.majorityLabel ? 1 : 0
    const weighted = (statement.weights[label] ?? 0) * constantAccuracy
    const balanced = labels.length === 0 ? 0 : 1 / labels.length
    rows.push({
      label,
      support,
      majority: label === statement.majorityLabel,
      prior: statement.weights[label] ?? 0,
      constantAccuracy,
      recall: constantAccuracy,
      priorWeightedRecall: constantAccuracy,
      priorWeightedAccuracy: weighted,
      balancedAccuracy: balanced,
    })
    priorWeightedAccuracy += weighted
    balancedAccuracy += balanced * constantAccuracy
  }
  return {
    kind: "standin/baseline",
    corpus: corpusPath ?? null,
    corpusHash,
    support: items.length,
    labels: rows,
    prior: statement,
    priorWeightedAccuracy: round(priorWeightedAccuracy),
    balancedAccuracy: round(balancedAccuracy),
  }
}

/** One label's result under a head, with both the count and the weighted rate. */
export interface LabelEvaluation {
  readonly label: string
  readonly support: number
  readonly predicted: number
  readonly correct: number
  readonly precision: number
  readonly recall: number
  readonly priorWeightedPrecision: number
  readonly priorWeightedRecall: number
}

/** The three buckets, plus the judged subset that is right or wrong. */
export interface Confusion {
  readonly total: number
  readonly judged: number
  readonly correct: number
  readonly wrong: number
  readonly abstained: number
}

/** What one head did over one corpus at one threshold. */
export interface EvaluationReport {
  readonly kind: "standin/evaluate"
  readonly corpusHash: string
  readonly head: {
    readonly present: boolean
    readonly name: string | null
  }
  readonly threshold: number
  readonly prior: PriorStatement
  readonly violationLabel: string
  readonly confusion: Confusion
  readonly abstained: number
  readonly abstentionRate: number
  /** The subset of `abstained` the threshold withheld, rather than the head declining. */
  readonly withheld: number
  readonly labels: ReadonlyArray<LabelEvaluation>
  readonly baseline: BaselineReport
  readonly note: string | null
}

/** Build a head from a persisted answer map. No model, and no fallback. */
export const headFromAnswers =
  (answers: AnswerMap): CorpusHead =>
  (item) => {
    const entry = answers[item.hash]
    if (entry === undefined) return undefined
    if (typeof entry === "string") return { label: entry }
    if (!isRecord(entry) || typeof entry["label"] !== "string") return undefined
    const probability = entry["probability"]
    if (typeof probability !== "number" || !Number.isFinite(probability)) {
      return { label: entry["label"] }
    }
    return { label: entry["label"], probability }
  }

const finiteOr = (value: number | undefined, fallback: number): number =>
  value !== undefined && Number.isFinite(value) ? value : fallback

/**
 * Score a head over a corpus.
 *
 * `threshold` is the probability below which an answer is withheld. That is not
 * an answer of "no" and it is not wrong: it joins the unlooked bucket, because a
 * head that was not confident enough to act has not made a claim to check. An
 * answer without a probability is never withheld -- a map head states a label,
 * not a confidence.
 *
 * No head means every item is unlooked, and the report says so. There is no
 * default head and no neutral answer: silence is the honest result.
 */
export const evaluate = ({
  items,
  head,
  threshold = 0.5,
  prior = OBSERVED_PRIOR,
  majorityLabel,
  source = OBSERVED_PRIOR_SOURCE,
  corpusHash = "",
  corpusPath,
  violationLabel = VIOLATION_LABEL,
  headName,
}: {
  readonly items: ReadonlyArray<CorpusItem>
  readonly head?: CorpusHead | undefined
  readonly threshold?: number
  readonly prior?: number
  readonly majorityLabel?: string | undefined
  readonly source?: string | undefined
  readonly corpusHash?: string | undefined
  readonly corpusPath?: string | undefined
  readonly violationLabel?: string
  readonly headName?: string | undefined
}): EvaluationReport => {
  const bar = finiteOr(threshold, 0.5)
  const counts = labelCounts(items)
  const labels = orderedLabels(counts)
  const statement = priorStatementOf(labels, counts, prior, majorityLabel, source)

  // Prior-over-empirical weights: one item of a rare label counts as much as the
  // ledger says that label is rare relative to this balanced corpus.
  const weightOf = (label: string): number => {
    const support = counts.get(label) ?? 0
    if (support === 0 || items.length === 0) return 0
    const empirical = support / items.length
    return empirical === 0 ? 0 : (statement.weights[label] ?? 0) / empirical
  }

  interface Accumulator {
    support: number
    predicted: number
    correct: number
    weightedTruth: number
    weightedPredicted: number
    weightedCorrect: number
  }
  const accumulators = new Map<string, Accumulator>()
  const accumulatorFor = (label: string): Accumulator => {
    const existing = accumulators.get(label)
    if (existing !== undefined) return existing
    const created: Accumulator = {
      support: 0,
      predicted: 0,
      correct: 0,
      weightedTruth: 0,
      weightedPredicted: 0,
      weightedCorrect: 0,
    }
    accumulators.set(label, created)
    return created
  }
  for (const label of labels) accumulatorFor(label)

  let correct = 0
  let wrong = 0
  let abstained = 0
  let withheld = 0

  for (const item of items) {
    const accumulator = accumulatorFor(item.label)
    accumulator.support += 1
    const weight = weightOf(item.label)
    accumulator.weightedTruth += weight

    const answer = head?.(item)
    if (answer === undefined) {
      abstained += 1
      continue
    }
    if (answer.probability !== undefined && Number.isFinite(answer.probability)) {
      if (answer.probability < bar) {
        withheld += 1
        abstained += 1
        continue
      }
    }
    const predicted = accumulatorFor(answer.label)
    predicted.predicted += 1
    predicted.weightedPredicted += weight
    if (answer.label === item.label) {
      correct += 1
      accumulator.correct += 1
      accumulator.weightedCorrect += weight
    } else {
      wrong += 1
    }
  }

  const rows: Array<LabelEvaluation> = []
  for (const [label, accumulator] of accumulators) {
    rows.push({
      label,
      support: accumulator.support,
      predicted: accumulator.predicted,
      correct: accumulator.correct,
      precision:
        accumulator.predicted === 0 ? 0 : round(accumulator.correct / accumulator.predicted),
      recall: accumulator.support === 0 ? 0 : round(accumulator.correct / accumulator.support),
      priorWeightedPrecision:
        accumulator.weightedPredicted === 0
          ? 0
          : round(accumulator.weightedCorrect / accumulator.weightedPredicted),
      // Class reweighting cancels within a class, so this equals `recall` for a
      // label the corpus has support for. It is still the gate's number: the
      // balanced alternative would be a different metric wearing this name.
      priorWeightedRecall:
        accumulator.weightedTruth === 0
          ? 0
          : round(accumulator.weightedCorrect / accumulator.weightedTruth),
    })
  }

  const total = items.length
  return {
    kind: "standin/evaluate",
    corpusHash,
    head: { present: head !== undefined, name: head !== undefined ? (headName ?? null) : null },
    threshold: bar,
    prior: statement,
    violationLabel,
    confusion: {
      total,
      judged: total - abstained,
      correct,
      wrong,
      abstained,
    },
    abstained,
    abstentionRate: total === 0 ? 0 : abstained / total,
    withheld,
    labels: rows,
    baseline: baseline({ corpus: { items, corpusHash }, prior, majorityLabel, source, corpusPath }),
    note: head === undefined ? "no head: every item is unlooked" : null,
  }
}
