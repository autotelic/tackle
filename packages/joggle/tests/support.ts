import { Effect, Layer, Option } from "effect"
import { NodeServices } from "@effect/platform-node"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { decisionStub, refusingModel, type StubAnswer } from "../src/testing.ts"
import type { WorkspaceError } from "../src/schema.ts"
import { Service as TsgoService } from "../src/tsgo.ts"
import { loadWorkspace, type Workspace } from "../src/workspace.ts"
import type { RunContext } from "../src/rule.ts"

export const corpus = "tests/fixtures/corpus"

/** Everything a test needs to run the real workspace and decision layers. */
export const nodeLayer = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)

export const tsgoStub = Layer.succeed(
  TsgoService,
  TsgoService.of({
    listFiles: () => Effect.succeed([]),
    typecheck: () => Effect.succeed([]),
    generateTrace: () => Effect.void,
  }),
)

/** A model that answers from a table, for a rule that asks. */
export const modelStub = (answers: Readonly<Record<string, StubAnswer>>) => decisionStub(answers)

/** A model that refuses, for a rule that must degrade without one. */
export const modelFailing = (reason: string) => refusingModel(reason)

/**
 * Load the fixture workspace once per test and hand it to the body. The body's
 * remaining requirements are the test's business (usually a decision stub).
 */
export const withWorkspace = <A, E, R>(
  use: (workspace: Workspace) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E | WorkspaceError, Exclude<R, NodeServices.NodeServices>> =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(corpus, ["src"])
    return yield* use(workspace)
  }).pipe(Effect.provide(NodeServices.layer))

export const noul = (value: number): StubAnswer => ({ type: "noul", noul: value })

/** A Score answer: a position on the question's levels, lowest to highest. */
export const rate = (rating: number, confidence = 0.9): StubAnswer => ({
  type: "rate",
  rating,
  confidence,
})

export const choice = (value: string, confidence: number): StubAnswer => ({
  type: "choice",
  choice: value,
  probabilities: { [value]: confidence },
  confidence,
})

export const noApiKey = Option.none<string>()

/**
 * The run context for a rule that needs no configuration.
 *
 * The architecture rules read the declared layering, so every rule now takes a
 * context; most rules ignore it, and a test that is not about layering should
 * not have to invent one.
 */
export const noConfig: RunContext = { config: {} }
