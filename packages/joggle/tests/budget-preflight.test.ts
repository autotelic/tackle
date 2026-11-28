import { expect, test } from "vitest"
import { Effect, Option, Ref } from "effect"
import { Decision } from "effect/ai"
import { Atoms, layer as atomsLayer } from "../src/atoms.ts"
import {
  answerKeyFor,
  budgetChunks,
  chunkPlans,
  partitionAnswered,
  PlanAnswers,
  type Plan,
  type PlanAnswerStore,
} from "../src/plans.ts"

// The fixture this file exists for: a plan set whose CACHE HITS alone exceed the run's token
// ceiling while its misses fit comfortably. Before the preflight moved in front of the chunking,
// that set was budget-blocked -- a warm ledger was refused questions it already had answers to --
// and every subject in the blocked chunks was relabelled a "budget" drop. The first test is the
// behaviour that was wrong; the second is the old computation, kept as the control so a future
// reader can see the defect without reverting the fix.

/** A plan whose one Noul reads a probability back. */
const plan = (subject: string, atom: string): Plan<number | undefined> => ({
  ruleId: "test/preflight",
  subject,
  concerns: [atom],
  atoms: [atom],
  decisions: {
    verdict: Decision.probability({
      instructions: "Is `atoms[0].source` a violation?",
      criteria: { false: "It is not.", true: "It is." },
    }),
  },
  read: (answers) => {
    const answer = answers["verdict"]
    return answer !== undefined && "probability" in answer ? answer.probability : undefined
  },
})

type Answers = Record<string, Decision.Answer<Decision.Any>>

interface EngineInput {
  readonly plans: ReadonlyArray<Plan<number | undefined>>
  readonly cache: PlanAnswerStore
  readonly warm: (plans: ReadonlyArray<Plan<number | undefined>>) => Effect.Effect<void>
}

/** Run `use` with the atoms layer and an answer cache it fills from `warm`. */
const withEngine = <A>(
  use: (input: EngineInput) => Effect.Effect<A, never, Atoms | PlanAnswers>,
): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const atoms = yield* Atoms
      const store = yield* Ref.make<Answers>({})
      const cache: PlanAnswerStore = {
        get: (key) => Effect.map(Ref.get(store), (current) => Option.fromUndefinedOr(current[key])),
        put: (key, answer) => Ref.update(store, (current) => ({ ...current, [key]: answer })),
      }
      const plans: Array<Plan<number | undefined>> = []
      for (let index = 0; index < 20; index += 1) {
        const id = yield* atoms.add({ file: `src/${index}.ts`, source: "x".repeat(2_000) })
        plans.push(plan(`subject-${index}`, id))
      }
      const warm = (subset: ReadonlyArray<Plan<number | undefined>>) =>
        Effect.gen(function* () {
          for (const entry of subset) {
            for (const decision of Object.values(entry.decisions)) {
              yield* Ref.update(store, (current) => ({
                ...current,
                [answerKeyFor(decision, entry.atoms)]: { probability: 0.9 },
              }))
            }
          }
        })
      const provided = use({ plans, cache, warm }).pipe(Effect.provideService(PlanAnswers, cache))
      return yield* provided
    }).pipe(Effect.provide(atomsLayer)) as Effect.Effect<A, never, never>,
  )

test("a warm ledger is answered before the ceiling is charged, so it is never budget-blocked", async () => {
  const result = await withEngine(({ plans, warm }) =>
    Effect.gen(function* () {
      yield* warm(plans)
      const partition = yield* partitionAnswered(plans)
      const pending = partition.pending
        .map((index) => plans[index])
        .filter((entry): entry is Plan<number | undefined> => entry !== undefined)
      const chunks = yield* chunkPlans(pending, 1_000_000)
      const split = budgetChunks(chunks, 100)
      return { answered: partition.records.size, pending: pending.length, split }
    }),
  )

  expect(result.answered).toBe(20)
  expect(result.pending).toBe(0)
  expect(result.split.overBudget).toEqual([])
  expect(result.split.estimated).toBe(0)
  expect(result.split.allowed).toEqual([])
})

test("the control: costing every plan, hits included, blocks the same set -- the defect", async () => {
  const result = await withEngine(({ plans }) =>
    Effect.gen(function* () {
      const chunks = yield* chunkPlans(plans, 1_000_000)
      return budgetChunks(chunks, 100)
    }),
  )

  expect(result.overBudget.length).toBe(20)
  expect(result.allowed).toEqual([])
})

test("only the pending plans are charged, so a small miss still fits a tight ceiling", async () => {
  const result = await withEngine(({ plans, warm }) =>
    Effect.gen(function* () {
      yield* warm(plans.slice(0, 19))
      const partition = yield* partitionAnswered(plans)
      const pending = partition.pending
        .map((index) => plans[index])
        .filter((entry): entry is Plan<number | undefined> => entry !== undefined)
      const chunks = yield* chunkPlans(pending, 1_000_000)
      const split = budgetChunks(chunks, 700)
      return {
        answered: partition.records.size,
        pending: pending.length,
        allowed: split.allowed.length,
        overBudget: split.overBudget.length,
      }
    }),
  )

  expect(result.answered).toBe(19)
  expect(result.pending).toBe(1)
  expect(result.allowed).toBe(1)
  expect(result.overBudget).toBe(0)
})
