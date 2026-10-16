import { expect, it, test } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Schema } from "effect"
import { NodeServices } from "@effect/platform-node"
import { Decision, DecisionModel } from "effect/unstable/ai"
import * as HttpClient from "effect/unstable/http/HttpClient"
import type * as HttpClientError from "effect/unstable/http/HttpClientError"
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse"
import type * as HttpClientRequest from "effect/unstable/http/HttpClientRequest"
import { cacheKeyFor, DecisionStats, layer as decisionLayer } from "../src/decision.ts"
import { policy } from "../src/policy.ts"
import { nodeLayer } from "./support.ts"

const definition = Decision.make({
  input: Schema.Struct({ a: Schema.Number }),
  decisions: {
    answer: Decision.classify({ instructions: "Is a?", criteria: { yes: "yes", no: "no" } }),
  },
})

const response = {
  model: "jev-latest",
  answers: { answer: { type: "choice", choice: "yes", probabilities: { yes: 1, no: 0 }, confidence: 0.9 } },
  usage: { input_tokens: 7, output_tokens: 3 },
}

const mockClient = (
  handler: (
    request: HttpClientRequest.HttpClientRequest,
  ) => Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError>,
): Layer.Layer<HttpClient.HttpClient> =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.makeWith(
      Effect.fnUntraced(function* (requestEffect) {
        const request = yield* requestEffect
        return yield* handler(request)
      }),
      Effect.succeed as HttpClient.HttpClient.Preprocess<HttpClientError.HttpClientError, never>,
    ),
  )

const jsonResponse = (
  request: HttpClientRequest.HttpClientRequest,
  body: unknown,
): HttpClientResponse.HttpClientResponse =>
  HttpClientResponse.fromWeb(
    request,
    new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } }),
  )

test("the cache key carries the question version and the model", () => {
  const key = cacheKeyFor({ model: "jev-latest", state: { a: 1 }, questions: {} })
  expect(key).toContain(policy.decisionVersion)
  expect(key).toContain("jev-latest")
})

it.effect("answers through the provider and counts what it spent", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const cacheDir = "/tmp/joggle-decision-test"
    yield* fs.remove(cacheDir, { recursive: true, force: true })

    const outcome = yield* Effect.gen(function* () {
      const model = yield* DecisionModel.DecisionModel
      const result = yield* model.decide(definition, { input: { a: 1 } })
      const stats = yield* (yield* DecisionStats).read
      return { result, stats }
    }).pipe(
      Effect.provide(decisionLayer({ cacheDir, offline: false, apiKey: Option.some("test-key") })),
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          mockClient((request) => Effect.succeed(jsonResponse(request, response))),
        ),
      ),
    )

    expect(outcome.result.answers.answer.label).toBe("yes")
    expect(outcome.stats.calls).toBe(1)
    expect(outcome.stats.inputTokens).toBe(7)
    expect(outcome.stats.outputTokens).toBe(3)
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("replays a cached judgement with no call and no key", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const cacheDir = "/tmp/joggle-decision-replay"
    yield* fs.remove(cacheDir, { recursive: true, force: true })

    yield* Effect.gen(function* () {
      const model = yield* DecisionModel.DecisionModel
      return yield* model.decide(definition, { input: { a: 1 } })
    }).pipe(
      Effect.provide(decisionLayer({ cacheDir, offline: false, apiKey: Option.some("test-key") })),
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          mockClient((request) => Effect.succeed(jsonResponse(request, response))),
        ),
      ),
    )

    const second = yield* Effect.gen(function* () {
      const model = yield* DecisionModel.DecisionModel
      const result = yield* model.decide(definition, { input: { a: 1 } })
      const stats = yield* (yield* DecisionStats).read
      return { result, stats }
    }).pipe(
      Effect.provide(decisionLayer({ cacheDir, offline: true, apiKey: Option.none() })),
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          mockClient(() => Effect.die(new Error("the cache should have answered"))),
        ),
      ),
    )

    expect(second.result.answers.answer.label).toBe("yes")
    // The per-decision cache answered before the wire was reached, so there is no
    // request to count at all. The mock client dies if it is called, which is the
    // proof that the cache answered.
    expect(second.stats.requests).toBe(0)
    expect(second.stats.calls).toBe(0)
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("offline without a cached judgement fails with a typed error", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const cacheDir = "/tmp/joggle-decision-empty"
    yield* fs.remove(cacheDir, { recursive: true, force: true })

    const error = yield* Effect.gen(function* () {
      const model = yield* DecisionModel.DecisionModel
      return yield* model.decide(definition, { input: { a: 1 } })
    }).pipe(
      Effect.provide(decisionLayer({ cacheDir, offline: true, apiKey: Option.none() })),
      Effect.provide(
        Layer.mergeAll(
          NodeServices.layer,
          mockClient(() => Effect.die(new Error("the cache should not have answered"))),
        ),
      ),
      Effect.flip,
    )

    expect(error._tag).toBe("AiError")
  }).pipe(Effect.provide(nodeLayer)),
)
