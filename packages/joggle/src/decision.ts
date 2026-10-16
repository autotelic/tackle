import {
  Config,
  Context,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Redacted,
  Ref,
  Result,
  Schedule,
  Schema,
  SchemaParser,
  Semaphore,
} from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import { DecisionModel } from "effect/unstable/ai"
import type * as HttpClient from "effect/unstable/http/HttpClient"
import { TypeSafeClient, TypeSafeDecisionModel, TypeSafeSchema } from "@effect/ai-typesafe"
import { canonical } from "./canonical.ts"
import { policy } from "./policy.ts"
import { make as makeAnswerStore } from "./answer-store.ts"
import { answerOf, memoize, PlanAnswers, storedOf, type PlanAnswerStore } from "./plans.ts"
import type { DecisionTotals } from "./schema.ts"

// The judged half of joggle, as Effect's own DecisionModel.
//
// Built from scratch, this is the shape the AI surface wants: a rule declares a
// Decision.Definition with a typed input and named decisions; the rule calls
// DecisionModel.decide once per candidate; Effect builds the System One
// questions, calls the provider, validates the answers and returns them typed.
//
// joggle adds exactly three things, and nothing about the questions: a persisted
// cache, so CI replays reviewed verdicts with no API key; offline mode, so a run
// can be answered from the cache alone; and token accounting, so a run can say
// what it spent.
//
// The cache sits on the WIRE, not above the answers. A caching TypeSafeClient is
// provided to TypeSafeDecisionModel, so every decide -- a fresh call and a replay
// alike -- runs through Effect's validation. A cached answer cannot become a
// malformed answer just because it took the short path.
//
// The cache key is derived from the encoded state and the questions, which is the
// thing the provider is asked. An input that is part of the request is therefore
// part of the key by construction: the old judge carried the repository in the
// state and forgot it in the key, and the fix is to have only one of them.

/** The run's judgement accounting, read once at the end of a run. */
export class DecisionStats extends Context.Service<DecisionStats, { readonly read: Effect.Effect<DecisionTotals> }>()(
  "@joggle/DecisionStats",
) {}

export interface Options {
  /** Directory the committed per-decision answer cache lives in. */
  readonly cacheDir: string
  /**
   * Directory the wire cache lives in: the whole-response cache.
   *
   * Machine-local on purpose. It is keyed on a whole request, so it changes when
   * any question in the request changes, and on one repository it reached 11.5
   * megabytes -- far too large to commit, and no longer the replay path. The
   * per-decision cache in `cacheDir` is what CI replays.
   */
  readonly wireCacheDir?: string | undefined
  /** Never call the API; answer only from the persisted cache. */
  readonly offline: boolean
  /** Absent means judged rules fail with a clear reason and deterministic rules still run. */
  readonly apiKey: Option.Option<string>
}

const emptyStats: DecisionTotals = {
  requests: 0,
  replayed: 0,
  calls: 0,
  unavailable: 0,
  inputTokens: 0,
  outputTokens: 0,
}

const storePath = (path: Path.Path, cacheDir: string): string => path.join(cacheDir, "wire.json")

const CacheFile = Schema.Struct({
  version: Schema.String,
  entries: Schema.Record(Schema.String, TypeSafeSchema.SystemOneResponse),
})

/**
 * The key of one wire request: the model, the state and the questions, plus the
 * decision version. Exported because the replay file is a contract.
 */
export const cacheKeyFor = (payload: typeof TypeSafeSchema.SystemOneRequest.Encoded): string =>
  canonical({
    decisionVersion: policy.decisionVersion,
    model: payload.model,
    state: payload.state,
    questions: payload.questions,
  })

/**
 * True when the model was never reached: no key, or offline with no cached
 * judgement. A rule treats that as "step aside", not as "every candidate is
 * unreadable", and the predicate lives here so the rules that ask agree.
 */
export const isUnreachable: Predicate.Predicate<AiError.AiError> = (error) =>
  error.reason._tag === "AuthenticationError" || error.reason._tag === "UnknownError"

/**
 * One place that builds joggle's AI errors.
 *
 * The module and method are how a failure is attributed, and two call sites that
 * write them by hand are two chances to disagree. The parameters are positional
 * so that the call does not recreate the shape the object-shape rule reports.
 *
 * @param at - The joggle module and the operation within it, as one value so a
 *   transposed call cannot compile.
 * @param reason - The provider's reason.
 * @returns The wrapped error.
 */
export const decisionError = (
  at: readonly [module: string, method: string],
  reason: AiError.AiErrorReason,
): AiError.AiError => AiError.make({ module: at[0], method: at[1], reason })

/**
 * A judgement that cannot be made, in the provider's own error vocabulary.
 *
 * A missing key is an authentication failure, because that is what it is. An
 * offline miss is unknown, because the cache is the only thing that could have
 * answered. A rule treats both as "the model was not reached" and steps aside,
 * rather than reporting every candidate as unreadable.
 */
const missingKey = (): AiError.AiError =>
  decisionError(
    ["joggle/Decision", "systemOne"],
    AiError.AuthenticationError.make({
      kind: "MissingKey",
      description: "TYPESAFE_API_KEY is not set",
    }),
  )

const offlineMiss = (): AiError.AiError =>
  decisionError(
    ["joggle/Decision", "systemOne"],
    AiError.UnknownError.make({ description: "offline mode and no cached judgement" }),
  )

/**
 * Provides a caching DecisionModel and the run's judgement stats.
 *
 * The caching client wraps the provider client. The decision model is the
 * provider's own, so the only joggle code between a rule and the wire is the
 * cache.
 */
export const layer = (
  options: Options,
): Layer.Layer<
  DecisionModel.DecisionModel | DecisionStats | PlanAnswers,
  never,
  FileSystem.FileSystem | Path.Path | HttpClient.HttpClient
> =>
  Layer.effectContext(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const apiKey = Option.getOrUndefined(options.apiKey)
      // Overridable so a self-hosted or enterprise deployment can be used when
      // the evidence panels must not leave the organisation's boundary.
      const baseUrl = yield* Config.String("TYPESAFE_BASE_URL").pipe(
        Effect.orElseSucceed(() => policy.decision.baseUrl),
      )
      const inner = yield* TypeSafeClient.make({
        apiKey: apiKey === undefined ? undefined : Redacted.make(apiKey),
        apiUrl: `${baseUrl}/v1`,
      })
      const file = storePath(path, options.wireCacheDir ?? options.cacheDir)

      const load = Effect.gen(function* () {
        const empty: Record<string, typeof TypeSafeSchema.SystemOneResponse.Type> = {}
        const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
        if (!exists) return empty
        const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
        if (text.trim() === "") return empty
        const decoded = Result.getOrUndefined(
          SchemaParser.decodeResult(Schema.fromJsonString(CacheFile))(text),
        )
        return decoded === undefined ? empty : decoded.entries
      })

      const entries = yield* Ref.make(yield* load)
      const stats = yield* Ref.make(emptyStats)
      // Decisions run concurrently, so several calls can finish at once and each
      // one writes the whole cache. The permit keeps one writer in the file at a
      // time, so a full write cannot interleave with another.
      const writer = yield* Semaphore.make(1)

      const flush = writer.withPermits(1)(
        Effect.gen(function* () {
          const current = yield* Ref.get(entries)
          const body = JSON.stringify({ version: policy.version, entries: current }, null, 2)
          yield* Effect.orElseSucceed(fs.makeDirectory(options.cacheDir, { recursive: true }), () => undefined)
          yield* Effect.orElseSucceed(fs.writeFileString(file, body), () => undefined)
        }),
      )

      const client: TypeSafeClient.Service = TypeSafeClient.TypeSafeClient.of({
        client: inner.client,
        listModels: inner.listModels,
        systemOne: (payload) =>
          Effect.gen(function* () {
            const key = cacheKeyFor(payload)
            const before = yield* Ref.get(entries)
            const cached = before[key]
            if (cached !== undefined) {
              yield* Ref.update(stats, (current) => ({
                ...current,
                requests: current.requests + 1,
                replayed: current.replayed + 1,
              }))
              return cached
            }
            yield* Ref.update(stats, (current) => ({ ...current, requests: current.requests + 1 }))
            if (apiKey === undefined) {
              yield* Ref.update(stats, (current) => ({ ...current, unavailable: current.unavailable + 1 }))
              return yield* missingKey()
            }
            if (options.offline) {
              yield* Ref.update(stats, (current) => ({ ...current, unavailable: current.unavailable + 1 }))
              return yield* offlineMiss()
            }
            const response = yield* inner.systemOne(payload).pipe(
              // Backpressure is the provider's own classification, so
              // `isRetryable` decides instead of a hand-written status list.
              Effect.retry({
                while: (error: AiError.AiError) => error.isRetryable,
                schedule: Schedule.exponential("400 millis").pipe(
                  Schedule.jittered,
                  Schedule.upTo({ times: 6 }),
                ),
              }),
            )
            yield* Ref.update(stats, (current) => ({
              ...current,
              calls: current.calls + 1,
              inputTokens: current.inputTokens + (response.usage?.input_tokens ?? 0),
              outputTokens: current.outputTokens + (response.usage?.output_tokens ?? 0),
            }))
            yield* Ref.update(entries, (current) => ({ ...current, [key]: response }))
            yield* flush
            return response
          }),
      })

      const providerModel = yield* TypeSafeDecisionModel.make({ model: policy.model }).pipe(
        Effect.provideService(TypeSafeClient.TypeSafeClient, client),
      )

      // The per-question cache, above the wire.
      //
      // The wire cache is keyed on a whole request, so a batched request would
      // lose every question's answer when one of them changed. This one is keyed
      // on the question and the atoms it read, which is what makes a batched
      // request keep the independence a per-candidate request had.
      //
      // The store is sharded and content-addressed: one file per shard, one
      // entry per line, sorted, with the key naming the shard. Two branches that
      // judge different candidates never touch the same line, and the shipped
      // merge driver resolves the residual case by key. A legacy single
      // `answers.json` is read and migrated on the first write. See
      // `docs/artifacts.md`.
      const answers = yield* makeAnswerStore(fs, path, options.cacheDir)
      const planAnswers: PlanAnswerStore = {
        get: (key) => Effect.map(answers.get(key), (stored) => Option.map(stored, answerOf)),
        put: (key, answer) => answers.put(key, storedOf(answer)),
      }

      // Every answer is remembered per decision, so the committed cache is the
      // replay path and the wire cache is only a performance artifact.
      const decisionModel = memoize(providerModel, planAnswers)

      return Context.make(DecisionModel.DecisionModel, decisionModel).pipe(
        Context.add(DecisionStats, { read: Ref.get(stats) }),
        Context.add(PlanAnswers, planAnswers),
      )
    }),
  )
