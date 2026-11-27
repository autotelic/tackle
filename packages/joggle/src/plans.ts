import { Context, Effect, Option, Predicate, Result, Schema } from "effect"
import * as AiError from "effect/ai/AiError"
import { Decision, DecisionModel } from "effect/ai"
import { Atoms } from "./atoms.ts"
import { canonical } from "./canonical.ts"
import { policy } from "./policy.ts"
import { shortHash } from "./state.ts"
import type { Consistency, DecisionAnswers } from "./rule.ts"

/** Joggle declares classify, rate and probability decisions; Effect 4.1 also added Locate. */
export type JoggleDecision =
  | Decision.Classify<string>
  | Decision.Rate<string>
  | Decision.Probability

/** Narrow a decision to the kinds joggle declares. */
export const isJoggleDecision = (decision: Decision.Any): decision is JoggleDecision =>
  decision._tag !== "Locate"

/** Narrow an answer to the kinds joggle can store. */
export const isJoggleAnswer = (
  answer: Decision.Answer<Decision.Any>,
): answer is Decision.Answer<JoggleDecision> => !("box" in answer)

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One candidate's questions, and how to read the answers.
 *
 * A questionnaire carries atoms and decisions, not state and questions, and that
 * is what makes it mergeable. The decisions reference the atoms by id, as
 * `atoms[a1b2].source` -- the TypeSafe docs' "reference specific fields" rule with
 * a content-addressed path -- so any set of questionnaires can be answered
 * against the union of their atoms without rewriting an instruction.
 *
 * The engine batches this half. `Plan` adds the fields a rule names a
 * candidate with, and those are the same shape in every rule that builds one.
 */
export interface Questionnaire<A> {
  /** The atoms every decision here references. */
  readonly atoms: ReadonlyArray<string>
  readonly decisions: Record<string, Decision.Any>
  /**
   * Per decision, the labels that mean "this rule is violated".
   *
   * The same declaration the read uses via `verdictOf`, made data so calibration
   * can reduce an answer without re-deriving the rule's intent. A Noul needs no
   * entry: its probability is already the violation.
   */
  readonly violations?: Readonly<Record<string, ReadonlyArray<string>>> | undefined
  readonly read: (answers: DecisionAnswers) => A | undefined
}

/**
 * A questionnaire plus what names the candidate it is about.
 *
 * The plan is the seam between deciding what to ask and asking it. A rule builds
 * plans from the shared atoms; the engine answers them, batched, and hands each
 * plan its own answers back.
 */
export interface Plan<A> extends Questionnaire<A> {
  readonly ruleId: string
  /** How the rule names this candidate, for a drop. */
  readonly subject: string
  /**
   * The files this candidate is about.
   *
   * The engine judges a candidate only when one of its files is in the run's
   * scope. A rule that filters nothing therefore cannot spend a token on a
   * candidate the run is not about, and cannot act on one either: an out-of-scope
   * plan is never sent and its answer is never read.
   */
  readonly concerns: ReadonlyArray<string>
}

/* -------------------------------------------------------------------------- */
/* The answer cache                                                            */
/* -------------------------------------------------------------------------- */

/** The answer to one question, keyed by the question and the atoms it read. */
export interface PlanAnswerStore {
  readonly get: (key: string) => Effect.Effect<Option.Option<Decision.Answer<Decision.Any>>>
  readonly put: (key: string, answer: Decision.Answer<Decision.Any>) => Effect.Effect<void>
}

export class PlanAnswers extends Context.Service<PlanAnswers, PlanAnswerStore>()("@joggle/PlanAnswers") {}

/**
 * One cached answer, on disk.
 *
 * The `kind` field is added so the decoder can tell the three answer shapes
 * apart. Without it, a Rate answer would satisfy the Classify schema -- it has a
 * `label` and a `probabilities` -- and its `rating` would be dropped silently on
 * the way back in.
 */
export const StoredAnswer = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("Rate"),
    rating: Schema.Number,
    label: Schema.String,
    probabilities: Schema.Record(Schema.String, Schema.Number),
    confidence: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("Classify"),
    label: Schema.String,
    probabilities: Schema.Record(Schema.String, Schema.Number),
    confidence: Schema.optionalKey(Schema.Number),
  }),
  Schema.Struct({
    kind: Schema.Literal("Probability"),
    probability: Schema.Number,
    consistency: Schema.optionalKey(Schema.Number),
  }),
])

export type StoredAnswer = typeof StoredAnswer.Type

/**
 * The agreement carried alongside an answer, when a Noul was asked more than
 * once.
 *
 * `Decision.Answer` does not model it because it is OUR reduction, not the
 * provider's answer: `answerPlansRaw` attaches it, `storedOf` persists it, and
 * `verdictOf` reads it as a Noul's margin.
 */
export const consistencyOf = (answer: Decision.Answer<Decision.Any> & Consistency): number | undefined =>
  answer.consistency

/** An answer with its consistency attached, when it has one. */
export const withConsistency = <A extends Decision.Answer<Decision.Any>>(
  answer: A,
  consistency: number | undefined,
): A => {
  if (consistency === undefined) return answer
  // SAFETY: the extra field is our own reduction over the repeats, read back only
  // through `consistencyOf` and persisted by `storedOf`; every caller that treats
  // the value as a `Decision.Answer` ignores it.
  return { ...answer, consistency } as A
}

/**
 * Reduce a Noul's repeated asks to one answer and its agreement.
 *
 * The mean is the answer; the agreement is the share that sided with the
 * majority, 1 when every ask agreed and 0.5 at a coin flip. A separate function
 * so the arithmetic is testable without a model.
 *
 * @param values - one probability per ask, in request order.
 * @returns the mean and the agreement, or undefined when there are none.
 */
export const reduceRepeats = (
  values: ReadonlyArray<number>,
): { readonly probability: number; readonly consistency: number } | undefined => {
  if (values.length === 0) return undefined
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length
  const yes = values.filter((value) => value >= 0.5).length / values.length
  return { probability: mean, consistency: Math.max(yes, 1 - yes) }
}

/** The stored form of an answer, for the cache file. */
export const storedOf = (answer: Decision.Answer<JoggleDecision>): StoredAnswer => {
  if ("probability" in answer) {
    const consistency = consistencyOf(answer)
    return consistency === undefined
      ? { kind: "Probability", probability: answer.probability }
      : { kind: "Probability", probability: answer.probability, consistency }
  }
  if ("rating" in answer) {
    const rate = {
      kind: "Rate" as const,
      rating: answer.rating,
      label: answer.label,
      probabilities: answer.probabilities,
    }
    return answer.confidence === undefined ? rate : { ...rate, confidence: answer.confidence }
  }
  const classify = {
    kind: "Classify" as const,
    label: answer.label,
    probabilities: answer.probabilities,
  }
  return answer.confidence === undefined ? classify : { ...classify, confidence: answer.confidence }
}

/** The answer back from its stored form. */
export const answerOf = (stored: StoredAnswer): Decision.Answer<Decision.Any> => {
  if (stored.kind === "Probability") {
    return withConsistency({ probability: stored.probability }, stored.consistency)
  }
  if (stored.kind === "Rate") {
    const rate = {
      rating: stored.rating,
      label: stored.label,
      probabilities: stored.probabilities,
    }
    return stored.confidence === undefined ? rate : { ...rate, confidence: stored.confidence }
  }
  const classify = { label: stored.label, probabilities: stored.probabilities }
  return stored.confidence === undefined ? classify : { ...classify, confidence: stored.confidence }
}

/**
 * The state ONE question read, attached to a decision that travels in a batch.
 *
 * A request's input is the union of every question's state, so hashing it would
 * make a question's identity move whenever its neighbours change -- and a
 * re-chunked run would replay nothing. The plan engine knows each plan's own
 * atoms, so it attaches them here; the memoizer keys the answer on that material
 * instead of the batch.
 *
 * The annotation is a non-enumerable symbol on a copy of the decision, not a
 * module-level map. It is transport for one request: JSON, Schema and the wire
 * never see a symbol key, and a copy keeps the annotation out of shared module
 * state, where two runs in one process would overwrite each other's material.
 */
interface QuestionMeta {
  /** The state this one question read: its plan's atom ids. */
  readonly material?: unknown
  /** The plan engine has already asked a Noul `repeats` times in this request. */
  readonly repeatsHandled?: boolean
}

const QUESTION_META: unique symbol = Symbol("joggle/plans/QuestionMeta")

/** The decision as the memoizer sees it: the provider's answer plus our annotation. */
type AnnotatedDecision = { readonly [QUESTION_META]?: QuestionMeta }

/** Attach the state a question read, for the cache key. Returns a copy carrying it. */
export const withQuestionMeta = <D extends Decision.Any>(decision: D, meta: QuestionMeta): D => {
  const annotated = { ...decision } as D
  Object.defineProperty(annotated, QUESTION_META, { value: meta, enumerable: false })
  return annotated
}

const metaOf = (decision: Decision.Any): QuestionMeta | undefined =>
  (decision as AnnotatedDecision)[QUESTION_META]

/**
 * The key of one question's answer: the question, its OWN state, and the model.
 *
 * Per question rather than per request, which is the whole reason a batched call
 * does not lose cache granularity: adding a question to a request leaves every
 * other question's key unchanged, and so does changing a declaration the other
 * questions do not name. A batch is a transport detail; it is not part of the
 * identity.
 */
export const answerKeyFor = (decision: Decision.Any, material: unknown): string =>
  shortHash(
    canonical({
      model: policy.model,
      decisionVersion: policy.decisionVersion,
      decision,
      material,
    }),
  )

/** The provider's shape for one answer, so a cached answer can be re-validated. */
const asProviderAnswer = (
  decision: Decision.Any,
  answer: Decision.Answer<Decision.Any>,
): Option.Option<DecisionModel.ProviderAnswer> => {
  if (decision._tag === "Probability") {
    return "probability" in answer
      ? Option.some({ _tag: "Probability", probability: answer.probability })
      : Option.none()
  }
  if (!("label" in answer) || !("probabilities" in answer)) return Option.none()
  if (decision._tag === "Classify") {
    const base = { _tag: "Classify" as const, label: answer.label, probabilities: answer.probabilities }
    return Option.some(answer.confidence === undefined ? base : { ...base, confidence: answer.confidence })
  }
  if (!("rating" in answer)) return Option.none()
  const base = { _tag: "Rate" as const, rating: answer.rating, probabilities: answer.probabilities }
  return Option.some(answer.confidence === undefined ? base : { ...base, confidence: answer.confidence })
}

/**
 * Validate a cached answer through the same model that validated it when it was
 * first received.
 *
 * The cache is a file on disk, so a cached answer is not automatically a valid
 * one. Re-building a `DecisionModel` whose provider is the cache and asking it to
 * answer the question again runs Effect's own checks -- labels inside the
 * criteria, distributions summing to one, ratings in range -- without a second
 * implementation of them here. An answer that fails is a miss, not a wrong one.
 */
const revalidate = (
  decision: Decision.Any,
  answer: Decision.Answer<Decision.Any>,
): Effect.Effect<Option.Option<Decision.Answer<JoggleDecision>>> =>
  Effect.gen(function* () {
    const provider = asProviderAnswer(decision, answer)
    if (Option.isNone(provider)) return Option.none()
    const model = yield* DecisionModel.make({
      decide: () =>
        Effect.succeed({
          answers: { q: provider.value },
          usage: { inputTokens: undefined, outputTokens: undefined },
          metadata: {},
        }),
    })
    if (!isJoggleDecision(decision)) return Option.none()
    const definition = Decision.make({
      input: Schema.Json,
      decisions: { q: decision },
    })
    const decided = yield* model.decide(definition, { input: null }).pipe(Effect.orElseSucceed(() => undefined))
    if (decided === undefined) return Option.none()
    const validated = decided.answers["q"]
    return validated === undefined ? Option.none() : Option.some(validated)
  })

/**
 * A DecisionModel that stores every answer, one decision at a time.
 *
 * The wire cache stores a whole REQUEST, and that cannot be the replay path:
 * its key changes when any question in the request changes, and the file it
 * writes is far too large to commit. This stores one answer at a time, keyed
 * by the decision and the state it was answered against, so a reviewed verdict
 * replays with no key and no tokens, and a request whose questions are all
 * remembered never reaches the model at all.
 *
 * A cached answer is validated through the same checks the provider's answer
 * passed, so the cache is not a path around them. An answer that fails is a miss.
 */
export const memoize = (
  inner: DecisionModel.DecisionModel,
  cache: PlanAnswerStore,
): DecisionModel.DecisionModel =>
  DecisionModel.DecisionModel.of({
    [DecisionModel.TypeId]: DecisionModel.TypeId,
    decideSettled: inner.decideSettled,
    decide: (definition, options) =>
      Effect.gen(function* () {
        const entries = Object.entries(definition.decisions)
        const answers: Record<string, Decision.Answer<JoggleDecision>> = {}
        const missing: Record<string, JoggleDecision> = {}
        const keys = new Map<string, string>()
        for (const [name, decision] of entries) {
          if (!isJoggleDecision(decision)) continue
          // A question keyed by the batch's whole state would be unreachable as
          // soon as its neighbours change; the plan engine names the state each
          // question actually read.
          const key = answerKeyFor(decision, metaOf(decision)?.material ?? options.input)
          keys.set(name, key)
          const stored = yield* cache.get(key)
          if (Option.isSome(stored)) {
            const valid = yield* revalidate(decision, stored.value)
            if (Option.isSome(valid)) {
              answers[name] = withConsistency(valid.value, consistencyOf(stored.value))
              continue
            }
          }
          missing[name] = decision
        }
        let usage = DecisionModel.DecisionUsage.make({})
        if (Object.keys(missing).length > 0) {
          // A Noul asked `repeats` times, in the same request and for the same
          // reason as `answerPlansRaw`: one yes/no has no margin. A rule that
          // answers its own questions directly (`DecisionModel.decide`) passes
          // through here, so the reduction cannot live only in the plan engine.
          const repeats = policy.decision.consistency.repeats
          const requested: Record<string, JoggleDecision> = {}
          const asked = new Map<string, ReadonlyArray<string>>()
          for (const [name, decision] of Object.entries(missing)) {
            // The plan engine already expanded this Noul into its repeats, each
            // under its own request name. Repeating again here asked every pair
            // three times as many times as the budget counted -- 9 asks for a
            // Noul, which is what pushed a remedies request over the ceiling.
            const names =
              decision._tag === "Probability" && metaOf(decision)?.repeatsHandled !== true
                ? Array.from({ length: repeats }, (_, index) => name + "~" + String(index))
                : [name]
            for (const one of names) requested[one] = decision
            asked.set(name, names)
          }
          const response = yield* inner.decide(
            Decision.make({ input: definition.input, decisions: requested }),
            options,
          )
          usage = response.usage
          for (const name of Object.keys(missing)) {
            const names = asked.get(name) ?? [name]
            const gathered = names
              .map((one) => response.answers[one])
              .filter((answer) => answer !== undefined)
            const first = gathered[0]
            if (first === undefined) continue
            let answer: Decision.Answer<Decision.Any> = first
            if (
              missing[name]?._tag === "Probability" &&
              metaOf(missing[name])?.repeatsHandled !== true
            ) {
              const values = gathered.flatMap((one) => ("probability" in one ? [one.probability] : []))
              const reduced = reduceRepeats(values)
              if (reduced === undefined) continue
              answer = withConsistency({ probability: reduced.probability }, reduced.consistency)
            }
            answers[name] = answer
            const key = keys.get(name)
            if (key !== undefined) yield* cache.put(key, answer)
          }
        }
        const ordered: Record<string, Decision.Answer<Decision.Any>> = {}
        for (const [name] of entries) {
          const answer = answers[name]
          if (answer !== undefined) ordered[name] = answer
        }
        // SAFETY: every name in the definition has an answer here -- the provider
        // validated the missing ones and the cache validated the rest -- and the
        // record was built in the definition's own order.
        const complete = ordered as Decision.Answers<typeof definition.decisions>
        return { answers: complete, usage, metadata: {} }
      }),
  })

/**
 * A plan's answers, in the rule's own type.
 *
 * The engine erases the verdict type so plans from different rules can travel in
 * one request; this puts it back at the boundary, where every answer came from the
 * rule's own decisions, in the order it asked them.
 */
export const verdictsOf = <A>(answers: ReadonlyArray<unknown>): ReadonlyArray<A | undefined> =>
  // SAFETY: the caller built these plans, so each answer is the type its own
  // decisions produced; the engine erased it only to batch rules together.
  answers as ReadonlyArray<A | undefined>

/**
 * One candidate's plan, with the candidate it was built from.
 *
 * A `plan` phase builds these so its `read` can name the finding it is about;
 * every rule that does spells the shape the same way, so it is declared once.
 */
export interface PlannedCandidate<C> {
  readonly candidate: C
  /** The atom the plan's decisions reference, when the rule added one. */
  readonly id: string
  readonly plan: Plan<unknown>
}

/**
 * Plans cut to fit one request, with the characters of state and questions they
 * carry.
 *
 * The characters are what the caller estimates tokens from. State alone was the
 * wrong estimate: a remedies run stayed under a state-only budget while its
 * encoded pairwise questions pushed the request past the provider's ceiling.
 */
export interface PlanChunk<A> {
  readonly plans: ReadonlyArray<Plan<A>>
  /** The encoded state plus the encoded questions this chunk carries. */
  readonly chars: number
}

/**
 * The characters one plan's questions add to a request.
 *
 * A Probability is asked `policy.decision.consistency.repeats` times in the
 * same request, under distinct names, so its question is paid for once per ask.
 * A Choice is asked once. The encoding is the same canonical JSON the request
 * uses, so a long criteria list costs what it will actually cost.
 */
const questionCharsOf = (plan: Plan<unknown>): number => {
  let chars = 0
  for (const decision of Object.values(plan.decisions)) {
    const encoded = canonical(decision).length
    chars +=
      decision._tag === "Probability"
        ? encoded * policy.decision.consistency.repeats
        : encoded
  }
  return chars
}

/**
 * Cut plans into requests that fit the provider's ceiling.
 *
 * The engine's goal is one request, and the provider's token limit is the reason
 * it cannot always be one. A plan's cost is the state it names PLUS the
 * questions it asks, so the cut is by that encoded size, not by plan count: one
 * cluster of twelve large declarations costs more than forty small ones, and a
 * batch of small pairwise Nouls still costs three questions each.
 */
export const chunkPlans = <A>(
  plans: ReadonlyArray<Plan<A>>,
  maxChars: number,
): Effect.Effect<ReadonlyArray<PlanChunk<A>>, never, Atoms> =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    const chunks: Array<PlanChunk<A>> = []
    let current: Array<Plan<A>> = []
    let size = 0
    for (const plan of plans) {
      const state = yield* atoms.values([...new Set(plan.atoms)])
      const cost = canonical(state).length + questionCharsOf(plan)
      if (current.length > 0 && size + cost > maxChars) {
        chunks.push({ plans: current, chars: size })
        current = []
        size = 0
      }
      current.push(plan)
      size += cost
    }
    if (current.length > 0) chunks.push({ plans: current, chars: size })
    return chunks
  })

/* -------------------------------------------------------------------------- */
/* The engine                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Answer many plans in one request, from the cache where it can.
 *
 * Three things happen here that a per-candidate call cannot do:
 *
 * - Two plans that ask the same decision against the same atoms ask it once.
 * - Every decision's atoms go into ONE state, so a declaration two rules both
 *   judge is sent once.
 * - A decision already answered from cache is not sent, so a request carries only
 *   what is new. That keeps a batched call from losing the per-candidate cache
 *   granularity a per-candidate call had.
 *
 * The state is `{ atoms: { id: value } }` and the decisions reference it by id.
 * A plan-local state (`declarations`, `files`) could not be merged into one
 * request without rewriting every instruction; atoms can.
 */
export const answerPlansRaw = (
  plans: ReadonlyArray<Plan<unknown>>,
): Effect.Effect<
  ReadonlyArray<DecisionAnswers>,
  AiError.AiError,
  Atoms | PlanAnswers | DecisionModel.DecisionModel
> =>
  Effect.gen(function* () {
    if (plans.length === 0) return []
    const atoms = yield* Atoms
    const cache = yield* PlanAnswers

    // One entry per DISTINCT decision. The map is insertion-ordered, so the
    // request is deterministic for a given set of plans.
    //
    // The request name keeps the decision's own name and adds the plan's index,
    // because two plans nearly always ask a decision with the same name (`verdict`
    // in every cluster) and the request needs distinct keys. The name is for the
    // request only; the cache is keyed on the decision and its atoms.
    const distinct = new Map<
      string,
      { readonly decision: Decision.Any; readonly atoms: ReadonlyArray<string>; readonly requestName: string }
    >()
    plans.forEach((plan, planIndex) => {
      for (const [name, decision] of Object.entries(plan.decisions)) {
        const key = answerKeyFor(decision, plan.atoms)
        if (!distinct.has(key)) {
          distinct.set(key, { decision, atoms: plan.atoms, requestName: `${name}@${planIndex}` })
        }
      }
    })

    const answers = new Map<string, Decision.Answer<Decision.Any>>()
    const pending: Array<{ readonly key: string }> = []
    for (const [key, entry] of distinct) {
      const stored = yield* cache.get(key)
      if (Option.isSome(stored)) {
        const valid = yield* revalidate(entry.decision, stored.value)
        if (Option.isSome(valid)) {
          answers.set(key, withConsistency(valid.value, consistencyOf(stored.value)))
          continue
        }
      }
      pending.push({ key })
    }

    if (pending.length > 0) {
      const ids = [...new Set(pending.flatMap((entry) => distinct.get(entry.key)?.atoms ?? []))]
      const state = yield* atoms.values(ids)
      const decisions: Record<string, JoggleDecision> = {}
      const names = new Map<string, ReadonlyArray<string>>()
      // A Noul is asked `repeats` times, in the SAME request: one yes/no carries
      // no margin, so the agreement across asks is the second signal a Choice
      // gets from its own distribution. A Choice is asked once.
      const repeats = policy.decision.consistency.repeats
      for (const entry of pending) {
        const found = distinct.get(entry.key)
        if (found === undefined) continue
        if (!isJoggleDecision(found.decision)) continue
        const requestNames =
          found.decision._tag === "Probability"
            ? Array.from({ length: repeats }, (_, index) => found.requestName + "~" + String(index))
            : [found.requestName]
        // Key each answer by its own plan's atoms, not the union this batch
        // assembled. The name is still per-request; the identity is not.
        for (const name of requestNames) {
          decisions[name] = withQuestionMeta(found.decision, {
            material: found.atoms,
            repeatsHandled: true,
          })
        }
        names.set(entry.key, requestNames)
      }
      const definition = Decision.make({ input: Schema.Json, decisions })
      const decided = yield* DecisionModel.decide(definition, { input: { atoms: state } })
      for (const entry of pending) {
        const requestNames = names.get(entry.key)
        if (requestNames === undefined) continue
        const decision = distinct.get(entry.key)?.decision
        const gathered = requestNames
          .map((name) => decided.answers[name])
          .filter((answer) => answer !== undefined)
        if (decision?._tag === "Probability") {
          const values = gathered.flatMap((answer) => ("probability" in answer ? [answer.probability] : []))
          const reduced = reduceRepeats(values)
          if (reduced === undefined) continue
          answers.set(entry.key, withConsistency({ probability: reduced.probability }, reduced.consistency))
          continue
        }
        const first = gathered[0]
        if (first !== undefined) answers.set(entry.key, first)
      }
      for (const entry of pending) {
        const answer = answers.get(entry.key)
        if (answer !== undefined) yield* cache.put(entry.key, answer)
      }
    }

    return plans.map((plan) => {
      const collected: Record<string, Decision.Answer<Decision.Any>> = {}
      for (const [name, decision] of Object.entries(plan.decisions)) {
        const answer = answers.get(answerKeyFor(decision, plan.atoms))
        if (answer !== undefined) collected[name] = answer
      }
      return collected
    })
  })

/** One request the provider rejected, and the plans it was carrying. */
export interface RejectedPlanBatch {
  readonly plans: ReadonlyArray<Plan<unknown>>
  readonly error: AiError.AiError
}

/** Answers aligned with the input plans; an undefined slot is a rejected plan. */
export interface ResilientAnswers {
  readonly answers: ReadonlyArray<DecisionAnswers | undefined>
  readonly failures: ReadonlyArray<RejectedPlanBatch>
}

/**
 * True when the provider rejected a request because it carried too much.
 *
 * The TypeSafe client folds an HTTP error into an `InvalidRequestError`; its
 * description and `http.body` keep the raw provider body, where this run's
 * ceiling arrives as `{"detail":{"error_type":"max_tokens_exceeded"}}`. The
 * check is deliberately narrow: an authentication or malformed-response error
 * must not be retried as if shrinking the batch could fix it.
 *
 * @param error - the failure a request produced.
 * @returns true when the batch was too large for the provider.
 */
export const isRequestTooLarge: Predicate.Predicate<AiError.AiError> = (error) => {
  if (error.reason._tag !== "InvalidRequestError") return false
  const text = (error.reason.description ?? "") + "\n" + (error.reason.http?.body ?? "")
  return text.includes("max_tokens_exceeded") || text.includes("max_tokens")
}

/**
 * Answer plans, halving a request the provider rejected for size.
 *
 * A batch is the only place the ceiling can be hit, and the cache is
 * per-question, so splitting on a size rejection costs nothing already answered.
 * The split recurses until the halves answer or one plan is left; a lone plan
 * that is still too large is reported as a named failure, never as a silent
 * witness fallback. Other errors are returned with the batch intact: shrinking
 * cannot fix an authentication failure, and pretending it might would hide it.
 *
 * @param input.plans - the plans to answer, in order.
 * @param input.answer - the batch answerer, injected so the split is testable.
 * @returns one answer slot per plan and every rejected batch.
 */
export const answerPlansResilient = <R>(input: {
  readonly plans: ReadonlyArray<Plan<unknown>>
  readonly answer: (
    plans: ReadonlyArray<Plan<unknown>>,
  ) => Effect.Effect<ReadonlyArray<DecisionAnswers>, AiError.AiError, R>
}): Effect.Effect<ResilientAnswers, never, R> => {
  const split = (
    plans: ReadonlyArray<Plan<unknown>>,
  ): Effect.Effect<ResilientAnswers, never, R> =>
    Effect.gen(function* () {
      if (plans.length === 0) return { answers: [], failures: [] }
      const attempted = yield* Effect.result(input.answer(plans))
      if (Result.isSuccess(attempted)) {
        return { answers: attempted.success, failures: [] }
      }
      if (plans.length > 1 && isRequestTooLarge(attempted.failure)) {
        const middle = Math.ceil(plans.length / 2)
        const left = yield* split(plans.slice(0, middle))
        const right = yield* split(plans.slice(middle))
        return {
          answers: [...left.answers, ...right.answers],
          failures: [...left.failures, ...right.failures],
        }
      }
      return {
        answers: plans.map(() => undefined),
        failures: [{ plans, error: attempted.failure }],
      }
    })
  return split(input.plans)
}

/**
 * Answer the plans and READ them, which is what the engine consumes.
 *
 * The raw records are a separate function so a caller that needs the answers
 * themselves -- the calibrator, which reduces each decision -- can have them
 * without a rule's `read` already having consumed them.
 *
 * @param plans - the plans to answer.
 * @returns one `read` output per plan, in order.
 */
export const answerPlans = <A>(
  plans: ReadonlyArray<Plan<A>>,
): Effect.Effect<
  ReadonlyArray<A | undefined>,
  AiError.AiError,
  Atoms | PlanAnswers | DecisionModel.DecisionModel
> =>
  answerPlansRaw(plans).pipe(
    Effect.map((records) =>
      records.map(
        (record, index) =>
          // SAFETY: the caller built these plans, so each record is the answer
          // shape its own plan's decisions produced and `read` returns the A that
          // plan declared. The record was erased only so the plans could be
          // answered together.
          plans[index]?.read(record) as A | undefined,
      ),
    ),
  )
