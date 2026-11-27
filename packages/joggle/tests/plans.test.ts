import { expect, test } from "vitest"
import { Effect, Layer, Option, Ref, Result, Schema, SchemaParser } from "effect"
import { AiError, Decision, DecisionModel } from "effect/ai"
import { Atoms, layer as atomsLayer } from "../src/atoms.ts"
import {
  answerOf,
  answerPlans,
  answerPlansResilient,
  chunkPlans,
  isRequestTooLarge,
  memoize,
  PlanAnswers,
  withQuestionMeta,
  StoredAnswer,
  type JoggleDecision,
  storedOf,
  type Plan,
  type PlanAnswerStore,
} from "../src/plans.ts"
import type { DecisionAnswers } from "../src/rule.ts"
import { canonical } from "../src/canonical.ts"
import { policy } from "../src/policy.ts"

/** An answer cache that lives in a Ref, for a test that is about the engine. */
const cacheLayer = (
  store: Ref.Ref<Record<string, Decision.Answer<Decision.Any>>>,
): Layer.Layer<PlanAnswers> =>
  Layer.succeed(PlanAnswers, {
    get: (key) => Effect.map(Ref.get(store), (current) => Option.fromUndefinedOr(current[key])),
    put: (key, answer) => Ref.update(store, (current) => ({ ...current, [key]: answer })),
  } satisfies PlanAnswerStore)

/** A model that counts its calls and records how many atoms it was sent. */
const countingModel = (
  calls: Ref.Ref<number>,
  atomsSeen: Ref.Ref<number>,
): Layer.Layer<DecisionModel.DecisionModel> =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ decisions, state }) =>
        Effect.gen(function* () {
          yield* Ref.update(calls, (count) => count + 1)
          const atomMap = (state as { atoms?: Record<string, unknown> }).atoms ?? {}
          yield* Ref.update(atomsSeen, (count) => count + Object.keys(atomMap).length)
          const answers: Record<string, DecisionModel.ProviderAnswer> = {}
          for (const [key, decision] of Object.entries(decisions)) {
            if (decision._tag === "Classify") {
              const labels = Object.keys(decision.criteria)
              answers[key] = {
                _tag: "Classify",
                label: labels[0] ?? "",
                probabilities: Object.fromEntries(labels.map((label) => [label, 1 / labels.length])),
                confidence: 0.9,
              }
            } else if (decision._tag === "Rate") {
              answers[key] = {
                _tag: "Rate",
                rating: 0,
                probabilities: Object.fromEntries(
                  decision.criteria.map((level) => [level.label, 1 / decision.criteria.length]),
                ),
                confidence: 0.9,
              }
            } else {
              answers[key] = { _tag: "Probability", probability: 0.5 }
            }
          }
          return { answers, usage: { inputTokens: 0, outputTokens: 0 } }
        }),
    }),
  )

type Engine = <B, F>(
  effect: Effect.Effect<B, F, Atoms | PlanAnswers | DecisionModel.DecisionModel>,
) => Effect.Effect<B, F>

/** Fresh engine state for one test: an answer cache, a call count, an atom count. */
const withEngine = <A, E>(
  use: (run: Engine, calls: Ref.Ref<number>, atomsSeen: Ref.Ref<number>) => Effect.Effect<A, E>,
): Effect.Effect<A, E> =>
  Effect.gen(function* () {
    const store = yield* Ref.make<Record<string, Decision.Answer<Decision.Any>>>({})
    const calls = yield* Ref.make(0)
    const atomsSeen = yield* Ref.make(0)
    const run: Engine = (effect) =>
      effect.pipe(
        Effect.provide(atomsLayer),
        Effect.provide(cacheLayer(store)),
        Effect.provide(countingModel(calls, atomsSeen)),
      )
    return yield* use(run, calls, atomsSeen)
  })

/** A plan whose one decision reads a label back. */
const plan = (name: string, atom: string): Plan<string> => ({
  ruleId: "test/rule",
  subject: name,
  concerns: [atom],
  atoms: [atom],
  decisions: {
    verdict: Decision.classify({
      instructions: "Is `" + name + "` one thing?",
      criteria: { yes: "One thing.", no: "Two things." },
    }),
  },
  read: (answers) => {
    const answer = answers["verdict"]
    return answer !== undefined && "label" in answer ? answer.label : undefined
  },
})

test("one request answers every plan, and a shared atom is sent once", async () => {
  const result = await Effect.runPromise(
    withEngine((run, calls, atomsSeen) =>
      Effect.gen(function* () {
        const results = yield* run(
          Effect.gen(function* () {
            const atoms = yield* Atoms
            const shared = yield* atoms.add({ file: "src/a.ts", source: "export const a = 1" })
            return yield* answerPlans([plan("p0", shared), plan("p1", shared), plan("p2", shared)])
          }),
        )
        return { results, calls: yield* Ref.get(calls), atoms: yield* Ref.get(atomsSeen) }
      }),
    ),
  )
  expect(result.results).toEqual(["yes", "yes", "yes"])
  expect(result.calls).toBe(1)
  // Three plans named the same atom, and it was sent once.
  expect(result.atoms).toBe(1)
})

test("a cached answer is not asked again", async () => {
  const result = await Effect.runPromise(
    withEngine((run, calls) =>
      Effect.gen(function* () {
        const once = () =>
          run(
            Effect.gen(function* () {
              const atoms = yield* Atoms
              const shared = yield* atoms.add({ file: "src/b.ts", source: "export const b = 1" })
              return yield* answerPlans([plan("p0", shared), plan("p1", shared)])
            }),
          )
        const first = yield* once()
        const callsAfterFirst = yield* Ref.get(calls)
        const again = yield* once()
        return { first, callsAfterFirst, again, callsAfterSecond: yield* Ref.get(calls) }
      }),
    ),
  )
  expect(result.first).toEqual(["yes", "yes"])
  expect(result.callsAfterFirst).toBe(1)
  expect(result.again).toEqual(["yes", "yes"])
  // Everything was in the per-question cache, so the wire was never reached.
  expect(result.callsAfterSecond).toBe(1)
})

test("changing one plan's atoms re-asks only that plan", async () => {
  const result = await Effect.runPromise(
    withEngine((run, calls) =>
      Effect.gen(function* () {
        yield* run(
          Effect.gen(function* () {
            const atoms = yield* Atoms
            const stable = yield* atoms.add({ file: "src/c.ts", source: "export const c = 1" })
            return yield* answerPlans([plan("p0", stable), plan("p1", stable)])
          }),
        )
        const before = yield* Ref.get(calls)
        const after = yield* run(
          Effect.gen(function* () {
            const atoms = yield* Atoms
            const stable = yield* atoms.add({ file: "src/c.ts", source: "export const c = 1" })
            const moved = yield* atoms.add({ file: "src/d.ts", source: "export const d = 2" })
            return yield* answerPlans([plan("p0", stable), plan("p1", moved)])
          }),
        )
        return { before, after, calls: yield* Ref.get(calls) }
      }),
    ),
  )
  expect(result.before).toBe(1)
  expect(result.after).toEqual(["yes", "yes"])
  // p0's answer was cached; only p1's changed decision was sent.
  expect(result.calls).toBe(2)
})

test("the same decision over the same atoms is asked once", async () => {
  const result = await Effect.runPromise(
    withEngine((run, calls, atomsSeen) =>
      Effect.gen(function* () {
        yield* run(
          Effect.gen(function* () {
            const atoms = yield* Atoms
            const shared = yield* atoms.add({ file: "src/e.ts", source: "export const e = 1" })
            return yield* answerPlans([plan("same", shared), plan("same", shared)])
          }),
        )
        return { calls: yield* Ref.get(calls), atoms: yield* Ref.get(atomsSeen) }
      }),
    ),
  )
  expect(result.calls).toBe(1)
  expect(result.atoms).toBe(1)
})

test("an answer round-trips through its stored form", () => {
  // The three shapes a cache file can hold, through JSON and back, because the
  // decoder is what stands between a cached answer and a rule.
  const answers: ReadonlyArray<Decision.Answer<JoggleDecision>> = [
    { label: "yes", probabilities: { yes: 1, no: 0 }, confidence: 0.9 },
    { rating: 2, label: "b", probabilities: { a: 0, b: 1, c: 0 }, confidence: 0.8 },
    { probability: 0.42 },
  ]
  for (const answer of answers) {
    const decoded = SchemaParser.decodeUnknownResult(StoredAnswer)(
      JSON.parse(JSON.stringify(storedOf(answer))) as unknown,
    )
    expect(Result.isSuccess(decoded)).toBe(true)
    if (Result.isSuccess(decoded)) expect(answerOf(decoded.success)).toEqual(answer)
  }
})

test("no plans is no request", async () => {
  const result = await Effect.runPromise(
    withEngine((run, calls) =>
      Effect.gen(function* () {
        const results = yield* run(answerPlans([]))
        return { results, calls: yield* Ref.get(calls) }
      }),
    ),
  )
  expect(result.results).toEqual([])
  expect(result.calls).toBe(0)
})

/** The provider's size rejection, in the shape the TypeSafe client produces. */
const tooLarge = (): AiError.AiError =>
  AiError.make({
    module: "test",
    method: "systemOne",
    reason: new AiError.InvalidRequestError({
      description: 'HTTP 400 {"detail":{"error_type":"max_tokens_exceeded"}}',
    }),
  })

test("a max_tokens_exceeded batch is halved until every piece answers", async () => {
  const calls: Array<number> = []
  const plans = Array.from({ length: 8 }, (_, index) => plan("p" + String(index), "a"))
  const answer = (
    batch: ReadonlyArray<Plan<unknown>>,
  ): Effect.Effect<ReadonlyArray<DecisionAnswers>, AiError.AiError> => {
    calls.push(batch.length)
    if (batch.length > 2) return Effect.fail(tooLarge())
    return Effect.succeed(batch.map(() => ({}) as DecisionAnswers))
  }
  const result = await Effect.runPromise(answerPlansResilient({ plans, answer }))
  expect(isRequestTooLarge(tooLarge())).toBe(true)
  expect(calls.length).toBeGreaterThan(1)
  expect(result.answers).toHaveLength(8)
  expect(result.answers.every((answer) => answer !== undefined)).toBe(true)
  expect(result.failures).toEqual([])
})

test("a single oversized question is a named failure, not a retry loop", async () => {
  const calls: Array<number> = []
  const plans = [plan("p0", "a")]
  const answer = (
    batch: ReadonlyArray<Plan<unknown>>,
  ): Effect.Effect<ReadonlyArray<DecisionAnswers>, AiError.AiError> => {
    calls.push(batch.length)
    return Effect.fail(tooLarge())
  }
  const result = await Effect.runPromise(answerPlansResilient({ plans, answer }))
  expect(calls).toEqual([1])
  expect(result.answers).toEqual([undefined])
  expect(result.failures).toHaveLength(1)
  expect(isRequestTooLarge(result.failures[0]?.error ?? tooLarge())).toBe(true)
})

test("the chunk budget counts the encoded questions, not only the state", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const atoms = yield* Atoms
      const id = yield* atoms.add({ x: 1 })
      const long = {
        ...plan("p0", id),
        decisions: {
          verdict: Decision.classify({
            instructions: "A question with a deliberately long instruction that dominates the atom.",
            criteria: {
              yes:
                "A deliberately long criterion that makes the encoded question larger than the " +
                "state, so a state-only budget would put both plans in one request.",
              no: "The other answer.",
            },
          }),
        },
      }
      const state = yield* atoms.values([id])
      const budget = canonical(state).length + canonical(long.decisions).length + 1
      return yield* chunkPlans([long, { ...long, subject: "p1" }], budget)
    }).pipe(Effect.provide(atomsLayer)),
  )
  expect(result).toHaveLength(2)
})

test("a Noul is asked repeats times, not repeats squared, through the memoizer", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const atoms = yield* Atoms
      const id = yield* atoms.add({ x: 1 })
      const store = yield* Ref.make<Record<string, Decision.Answer<Decision.Any>>>({})
      const asked: Array<string> = []
      const provider = yield* DecisionModel.make({
        decide: ({ decisions }) =>
          Effect.sync(() => {
            asked.push(...Object.keys(decisions))
            const answers: Record<string, DecisionModel.ProviderAnswer> = {}
            for (const [key, decision] of Object.entries(decisions)) {
              if (decision._tag === "Probability") {
                answers[key] = { _tag: "Probability", probability: 0.8 }
              }
            }
            return { answers, usage: { inputTokens: 0, outputTokens: 0 } }
          }),
      })
      const model = memoize(provider, {
        get: (key) => Effect.map(Ref.get(store), (current) => Option.fromUndefinedOr(current[key])),
        put: (key, answer) => Ref.update(store, (current) => ({ ...current, [key]: answer })),
      })
      const records = yield* answerPlansRaw([
        {
          ruleId: "test/consistency",
          subject: "x",
          concerns: [],
          atoms: [id],
          decisions: {
            same: Decision.probability({ instructions: "Is `x` one?" }),
          },
          read: (answers) => answers,
        },
      ]).pipe(
        Effect.provide(cacheLayer(store)),
        Effect.provideService(DecisionModel.DecisionModel, model),
      )
      const answer = records[0]?.["same"]
      return {
        asked: asked.length,
        consistency:
          answer === undefined ? undefined : (answer as { consistency?: number }).consistency,
        probability: answer !== undefined && "probability" in answer ? answer.probability : undefined,
      }
    }).pipe(Effect.provide(atomsLayer)),
  )
  // Three asks carry the agreement; nine was the double expansion that made a
  // remedies request far larger than the budget counted.
  expect(result.asked).toBe(policy.decision.consistency.repeats)
  expect(result.probability).toBeCloseTo(0.8)
  expect(result.consistency).toBe(1)
})

test("a question's cache key is its own state, not the batch it travelled in", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const calls = yield* Ref.make(0)
      const provider = yield* DecisionModel.make({
        decide: ({ decisions }) =>
          Effect.gen(function* () {
            yield* Ref.update(calls, (count) => count + 1)
            const answers: Record<string, DecisionModel.ProviderAnswer> = {}
            for (const [key, decision] of Object.entries(decisions)) {
              if (decision._tag === "Classify") {
                const labels = Object.keys(decision.criteria)
                answers[key] = {
                  _tag: "Classify",
                  label: labels[0] ?? "",
                  probabilities: Object.fromEntries(
                    labels.map((label) => [label, 1 / labels.length]),
                  ),
                }
              }
            }
            return { answers, usage: { inputTokens: 0, outputTokens: 0 } }
          }),
      })
      const store = yield* Ref.make<Record<string, Decision.Answer<Decision.Any>>>({})
      const model = memoize(provider, {
        get: (key) => Effect.map(Ref.get(store), (current) => Option.fromUndefinedOr(current[key])),
        put: (key, answer) => Ref.update(store, (current) => ({ ...current, [key]: answer })),
      })
      const decision = withQuestionMeta(
        Decision.classify({
          instructions: "Is `a1` one thing?",
          criteria: { yes: "One thing.", no: "Two things." },
        }),
        { material: { atoms: { a1: { x: 1 } } } },
      )
      const ask = (input: Schema.Json) =>
        model.decide(Decision.make({ input: Schema.Json, decisions: { verdict: decision } }), {
          input,
        })
      yield* ask({ atoms: { a1: { x: 1 } } })
      // A second chunk with a different neighbour: the question's own state is
      // unchanged, so its answer must replay.
      yield* ask({ atoms: { a1: { x: 1 }, a2: { y: 2 } } })
      return { calls: yield* Ref.get(calls) }
    }),
  )
  expect(result.calls).toBe(1)
})
