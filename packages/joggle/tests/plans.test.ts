import { expect, test } from "vitest"
import { Effect, Layer, Option, Ref, Result, SchemaParser } from "effect"
import { Decision, DecisionModel } from "effect/unstable/ai"
import { Atoms, layer as atomsLayer } from "../src/atoms.ts"
import {
  answerOf,
  answerPlans,
  PlanAnswers,
  StoredAnswer,
  storedOf,
  type Plan,
  type PlanAnswerStore,
} from "../src/plans.ts"

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
                  decision.criteria.map((level) => [level, 1 / decision.criteria.length]),
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
  const answers: ReadonlyArray<Decision.Answer<Decision.Any>> = [
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
