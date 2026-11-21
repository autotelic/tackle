import * as Domain from "@alchemy.run/domain"
import * as DateTime from "effect/DateTime"
import * as Effect from "effect/Effect"
import * as Schema from "effect/Schema"
import { BenchId } from "./Bench.id.ts"
import { BenchCreated, BenchAlreadyExists, CreateBench } from "./CreateBench.command.ts"
import { BenchNotPaused, BenchResumed, ResumeBench } from "./ResumeBench.command.ts"
import { BenchNotFound } from "./BenchNotFound.rejection.ts"
import { BenchNotRunning, BenchPaused, PauseBench } from "./PauseBench.command.ts"

/**
 * The control-plane state. It is deliberately not the lease's state and not a
 * message's state: a paused bench can hold no lease, and an acked message says
 * nothing about whether the bench is ready.
 */
export const BenchState = Schema.Union([
  Schema.TaggedStruct("Absent", {}),
  Schema.TaggedStruct("Ready", {
    repo: Schema.String,
    scope: Schema.String,
    createdAt: Schema.Int,
  }),
  Schema.TaggedStruct("Paused", {
    repo: Schema.String,
    scope: Schema.String,
    createdAt: Schema.Int,
    pausedAt: Schema.Int,
  }),
])
export type BenchState = typeof BenchState.Type

/**
 * One durable place. Create, pause and resume are the only control-plane
 * transitions in the first model; the lease and the move are separate
 * aggregates so their state machines cannot be merged into this one.
 */
export class Bench extends Domain.Aggregate("Bench", {
  id: BenchId,
  state: BenchState,
  initial: { _tag: "Absent" },
  commands: [CreateBench, PauseBench, ResumeBench],
  decide: {
    CreateBench: Effect.fn(function* (bench, command, { now }) {
      if (bench._tag !== "Absent") return yield* new BenchAlreadyExists()
      return [
        new BenchCreated({
          repo: command.repo,
          scope: command.scope,
          at: DateTime.toEpochMillis(now),
        }),
      ]
    }),
    PauseBench: Effect.fn(function* (bench, _command, { now }) {
      if (bench._tag === "Absent") return yield* new BenchNotFound()
      if (bench._tag !== "Ready") return yield* new BenchNotRunning()
      return [new BenchPaused({ at: DateTime.toEpochMillis(now) })]
    }),
    ResumeBench: Effect.fn(function* (bench, _command, { now }) {
      if (bench._tag === "Absent") return yield* new BenchNotFound()
      if (bench._tag !== "Paused") return yield* new BenchNotPaused()
      return [new BenchResumed({ at: DateTime.toEpochMillis(now) })]
    }),
  },
  evolve: {
    BenchCreated: (bench, event): BenchState =>
      bench._tag === "Absent"
        ? { _tag: "Ready", repo: event.repo, scope: event.scope, createdAt: event.at }
        : bench,
    BenchPaused: (bench, event): BenchState =>
      bench._tag === "Ready"
        ? {
            _tag: "Paused",
            repo: bench.repo,
            scope: bench.scope,
            createdAt: bench.createdAt,
            pausedAt: event.at,
          }
        : bench,
    BenchResumed: (bench, _event): BenchState =>
      bench._tag === "Paused"
        ? { _tag: "Ready", repo: bench.repo, scope: bench.scope, createdAt: bench.createdAt }
        : bench,
  },
}) {}
