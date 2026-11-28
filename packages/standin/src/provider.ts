import { createHash } from "node:crypto"
import { Effect, Layer, Result, Schema } from "effect"
import * as AiError from "effect/ai/AiError"
import { Decision, DecisionModel } from "effect/ai"
import type { Miss, MissLedger, MissReason, Question } from "./misses.ts"

/**
 * A local provider behind joggle's judgement seam.
 *
 * It has no model, no encoder and no network. It has a registry of heads, and for any
 * question without one it returns a named miss. That is deliberately the smaller half
 * of a local judge: the interface is the expensive thing to get right, and a stand-in
 * proves the seam admits a provider that abstains instead of guessing.
 */

/** One answer, as a head returns it. */
export type Answer = Decision.Answer<Decision.Any>

/**
 * A head for one question.
 *
 * The input is the encoded state the wire would carry, so a head is not given the
 * repository object and cannot read anything the question did not declare.
 */
export type Head = (input: Schema.Json) => Answer

/** The question definition a head is registered against, plus the name a rule gave it. */
export interface HeadLookup {
  readonly name: string
  readonly question: Question
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const canonical = (value: unknown): string => {
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

const shortHash = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 8)

/** The labels a decision offers, in the order the definition declared them. */
const labelSetOf = (decision: Decision.Any): ReadonlyArray<string> => {
  switch (decision._tag) {
    case "Classify":
      return Object.keys(decision.criteria)
    case "Rate":
      return decision.criteria.map((level) => level.label)
    case "Probability":
      return ["false", "true"]
    case "Locate":
      return []
  }
}

/**
 * The question's identity: its kind and a hash of its encoded definition.
 *
 * The input is not in the hash. A question is the same question whether it is asked
 * about this candidate or the next, and a head trained on it must not be orphaned by
 * the state changing underneath it.
 */
export const questionOf = (decision: Decision.Any): Question => ({
  tag: decision._tag,
  hash: shortHash(decision._tag + "\u0000" + canonical(decision)),
})

/**
 * The registry of heads.
 *
 * A head is registered by the name the rule gave its decision (`verdict@3`), and may
 * also be registered by question hash for a caller that wants one head to answer the
 * same question wherever it appears. The lookup is deliberately narrow: no fuzzy
 * match, no fallback head. A near-miss is a guess with extra steps.
 */
export class Registry {
  private readonly heads = new Map<string, Head>()
  private lookups = 0

  /** Register a head under a decision name, question hash, or `Tag:hash`. */
  register(name: string, head: Head): this {
    this.heads.set(name, head)
    return this
  }

  /** How many decisions asked this registry for a head. */
  get asked(): number {
    return this.lookups
  }

  /** The head for this decision, if one was registered. */
  headFor(name: string, question: Question): Head | undefined {
    this.lookups += 1
    return (
      this.heads.get(name) ??
      this.heads.get(question.hash) ??
      this.heads.get(question.tag + ":" + question.hash)
    )
  }
}

/** What the stand-in is built from. */
export interface Options {
  readonly registry: Registry
  readonly ledger: MissLedger
}

/** One validated question, kept for the outcome pass and the miss it produced. */
interface Observed {
  readonly question: Question
  readonly kind: string
  readonly labelSet: ReadonlyArray<string>
  readonly hadHead: boolean
}

/** A settled response that also carries the misses it recorded. */
export interface SettledResponse<
  Decisions extends Record<string, Decision.Any>,
> extends DecisionModel.DecideSettledResponse<Decisions> {
  readonly misses: ReadonlyArray<Miss>
}

interface SettledInternal<Decisions extends Record<string, Decision.Any>> {
  readonly response: SettledResponse<Decisions>
  readonly misses: ReadonlyArray<Miss>
  readonly byKey: ReadonlyMap<string, Miss>
}

const numberOf = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined

const probabilitiesOf = (value: unknown): Record<string, number> | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<string, number> = {}
  for (const [key, entry] of Object.entries(value)) {
    const number = numberOf(entry)
    if (number === undefined) return undefined
    out[key] = number
  }
  return out
}

const confidenceOf = (value: unknown): number | undefined => numberOf(value)

/**
 * Convert a head's `Answer` to the provider answer shape Effect validates.
 *
 * Structural conversion only. Validation (labels, distributions, ranges) is left to
 * Effect's `DecisionModel`, so a head that returns an invalid answer is rejected by
 * exactly the same rules a remote provider's answer would be. Returning undefined
 * here means the value is not even the right shape, which is also a failed head.
 */
const providerAnswerOf = (
  decision: Decision.Any,
  answer: Answer,
): DecisionModel.ProviderAnswer | undefined => {
  if (!isRecord(answer)) return undefined
  const confidence = confidenceOf(answer["confidence"])
  const confidenceField = confidence === undefined ? {} : { confidence }
  switch (decision._tag) {
    case "Classify": {
      const label = answer["label"]
      if (typeof label !== "string") return undefined
      const probabilities = probabilitiesOf(answer["probabilities"])
      return {
        _tag: "Classify",
        label,
        ...(probabilities === undefined ? {} : { probabilities }),
        ...confidenceField,
      }
    }
    case "Rate": {
      const rating = numberOf(answer["rating"])
      if (rating === undefined) return undefined
      const probabilities = probabilitiesOf(answer["probabilities"])
      return {
        _tag: "Rate",
        rating,
        ...(probabilities === undefined ? {} : { probabilities }),
        ...confidenceField,
      }
    }
    case "Probability": {
      const probability = numberOf(answer["probability"])
      return probability === undefined ? undefined : { _tag: "Probability", probability }
    }
    case "Locate": {
      const box = answer["box"]
      if (!isRecord(box)) return undefined
      const left = numberOf(box["left"])
      const top = numberOf(box["top"])
      const right = numberOf(box["right"])
      const bottom = numberOf(box["bottom"])
      if (left === undefined || top === undefined || right === undefined || bottom === undefined) {
        return undefined
      }
      return { _tag: "Locate", box: { left, top, right, bottom }, ...confidenceField }
    }
  }
}

const isQuestion = (value: unknown): value is Question =>
  isRecord(value) && typeof value["tag"] === "string" && typeof value["hash"] === "string"

const isMiss = (value: unknown): value is Miss =>
  isRecord(value) &&
  isQuestion(value["question"]) &&
  typeof value["kind"] === "string" &&
  Array.isArray(value["labelSet"]) &&
  value["labelSet"].every((entry) => typeof entry === "string") &&
  (value["reason"] === "no-head" || value["reason"] === "head-failed")

/** A typed miss attached to the `AiError` the seam already requires. */
export interface MissError extends AiError.AiError {
  readonly miss: Miss
}

/**
 * Build the seam's failure from a miss.
 *
 * `UnknownError` is the right semantic reason: the model was never reached, so a rule
 * should step aside rather than believe the provider answered. The description keeps
 * the miss as JSON, and the `miss` property keeps it typed for a caller that handles
 * the error directly.
 */
export const aiErrorFor = (miss: Miss): MissError => {
  const error = AiError.make({
    module: "@autotelic/standin",
    method: "decide",
    reason: AiError.UnknownError.make({
      description: JSON.stringify({ reason: miss.reason, question: miss.question }),
    }),
  })
  return Object.assign(error, { miss })
}

/** Recover the typed miss from an `AiError` this provider produced. */
export const missOf = (error: AiError.AiError): Miss | undefined => {
  const candidate: unknown = Reflect.get(error, "miss")
  return isMiss(candidate) ? candidate : undefined
}

const recordMiss = (
  options: Options,
  byKey: Map<string, Miss>,
  misses: Array<Miss>,
  key: string,
  observed: Observed,
  reason: MissReason,
): Miss => {
  const existing = byKey.get(key)
  if (existing !== undefined) return existing
  const miss: Miss = {
    question: observed.question,
    kind: observed.kind,
    labelSet: observed.labelSet,
    reason,
  }
  byKey.set(key, miss)
  misses.push(miss)
  options.ledger.record(miss)
  return miss
}

/**
 * Ask every head, then let Effect validate the answers it received.
 *
 * Running the provider through `DecisionModel.make` is deliberate: the stand-in should
 * not get a looser answer contract than a remote provider. If a head returns a label
 * that is not in the definition or a distribution that does not sum to one, the
 * failure is `head-failed`, never a zero-probability answer.
 */
const settle = <Input extends Schema.Constraint, Decisions extends Record<string, Decision.Any>>(
  options: Options,
  definition: Decision.Definition<Input, Decisions>,
  decideOptions: DecisionModel.DecideOptions<Input>,
): Effect.Effect<SettledInternal<Decisions>, AiError.AiError, Input["EncodingServices"]> =>
  Effect.gen(function* () {
    const byKey = new Map<string, Miss>()
    const misses: Array<Miss> = []
    const observedByKey = new Map<string, Observed>()

    const inner = yield* DecisionModel.make({
      decide: ({ state, decisions }) =>
        Effect.sync(() => {
          const answers: Record<string, DecisionModel.ProviderAnswer> = {}
          for (const [key, decision] of Object.entries(decisions)) {
            const question = questionOf(decision)
            const observed: Observed = {
              question,
              kind: decision._tag,
              labelSet: labelSetOf(decision),
              hadHead: false,
            }
            const head = options.registry.headFor(key, question)
            const withHead: Observed = { ...observed, hadHead: head !== undefined }
            observedByKey.set(key, withHead)
            if (head === undefined) {
              recordMiss(options, byKey, misses, key, withHead, "no-head")
              continue
            }
            let answer: Answer
            try {
              answer = head(state)
            } catch {
              recordMiss(options, byKey, misses, key, withHead, "head-failed")
              continue
            }
            const converted = providerAnswerOf(decision, answer)
            if (converted === undefined) {
              recordMiss(options, byKey, misses, key, withHead, "head-failed")
              continue
            }
            answers[key] = converted
          }
          return { answers, usage: { inputTokens: 0, outputTokens: 0 } }
        }),
    })

    const response = yield* inner.decideSettled(definition, decideOptions)

    for (const [key, outcome] of Object.entries(response.outcomes)) {
      if (outcome === undefined || Result.isSuccess(outcome)) continue
      const observed = observedByKey.get(key)
      if (observed === undefined) continue
      recordMiss(
        options,
        byKey,
        misses,
        key,
        observed,
        observed.hadHead ? "head-failed" : "no-head",
      )
    }

    const outcomes: Record<string, Decision.Outcome<Decision.Any>> = {}
    const entries = Object.entries(response.outcomes) as ReadonlyArray<
      readonly [string, Decision.Outcome<Decision.Any>]
    >
    for (const [key, outcome] of entries) {
      if (outcome === undefined) continue
      const miss = byKey.get(key)
      outcomes[key] =
        miss !== undefined && Result.isFailure(outcome)
          ? (Result.fail({ ...outcome.failure, miss }) as Decision.Outcome<Decision.Any>)
          : (outcome as Decision.Outcome<Decision.Any>)
    }

    const settled: SettledResponse<Decisions> = {
      outcomes: outcomes as Decision.Outcomes<Decisions>,
      usage: response.usage,
      metadata: response.metadata,
      ...(response.id === undefined ? {} : { id: response.id }),
      ...(response.modelId === undefined ? {} : { modelId: response.modelId }),
      misses,
    }
    return { response: settled, misses, byKey }
  })

const decideWith = <
  Input extends Schema.Constraint,
  Decisions extends Record<string, Decision.Any>,
>(
  options: Options,
  definition: Decision.Definition<Input, Decisions>,
  decideOptions: DecisionModel.DecideOptions<Input>,
): Effect.Effect<
  DecisionModel.DecideResponse<Decisions>,
  AiError.AiError,
  Input["EncodingServices"]
> =>
  settle(options, definition, decideOptions).pipe(
    Effect.flatMap(({ response, misses }) => {
      const first = misses[0]
      if (first !== undefined) return Effect.fail(aiErrorFor(first))
      const answers: Record<string, Decision.Answer<Decision.Any>> = {}
      const entries = Object.entries(response.outcomes) as ReadonlyArray<
        readonly [string, Decision.Outcome<Decision.Any>]
      >
      for (const [key, outcome] of entries) {
        if (outcome !== undefined && Result.isSuccess(outcome)) answers[key] = outcome.success
      }
      return Effect.succeed({
        answers: answers as Decision.Answers<Decisions>,
        usage: response.usage,
        metadata: response.metadata,
        ...(response.id === undefined ? {} : { id: response.id }),
        ...(response.modelId === undefined ? {} : { modelId: response.modelId }),
      })
    }),
  )

/** Build the provider as Effect's `DecisionModel`. */
export const model = (options: Options): DecisionModel.DecisionModel =>
  DecisionModel.DecisionModel.of({
    [DecisionModel.TypeId]: DecisionModel.TypeId,
    decide: <Input extends Schema.Constraint, Decisions extends Record<string, Decision.Any>>(
      definition: Decision.Definition<Input, Decisions>,
      decideOptions: DecisionModel.DecideOptions<Input>,
    ) => decideWith(options, definition, decideOptions),
    decideSettled: <
      Input extends Schema.Constraint,
      Decisions extends Record<string, Decision.Any>,
    >(
      definition: Decision.Definition<Input, Decisions>,
      decideOptions: DecisionModel.DecideOptions<Input>,
    ) => settle(options, definition, decideOptions).pipe(Effect.map((settled) => settled.response)),
  })

/** A layer, for a caller wiring the stand-in where the decision layer normally goes. */
export const layer = (options: Options): Layer.Layer<DecisionModel.DecisionModel> =>
  Layer.succeed(DecisionModel.DecisionModel, model(options))
