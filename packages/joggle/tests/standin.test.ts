import { expect, it } from "@effect/vitest"
import { Effect, Layer, Option, Ref } from "effect"
import { DecisionModel } from "effect/ai"
import { HttpClient } from "effect/http"
import { TypeSafeClient } from "@effect/ai-typesafe"
import { MissLedger, Registry, model as standinModel } from "@autotelic/standin"
import { checkRepository } from "../src/check.ts"
import { DecisionStats } from "../src/decision.ts"
import { PlanAnswers } from "../src/plans.ts"
import { builtIn } from "../src/rules/index.ts"
import { corpus, nodeLayer, tsgoStub } from "./support.ts"

const totals = {
  requests: 0,
  replayed: 0,
  judged: 0,
  calls: 0,
  unavailable: 0,
  inputTokens: 0,
  outputTokens: 0,
}

/**
 * The provider the production layer would have reached, made loud.
 *
 * The stand-in is wired where the decision layer normally goes, so this service should
 * never be in the graph. Providing it anyway is the negative control: if a later change
 * routes the run back through `decision.layer`, this fake makes the network call visible
 * instead of silently speeding up a test.
 */
const fakeClient = (calls: Ref.Ref<number>): TypeSafeClient.Service =>
  TypeSafeClient.TypeSafeClient.of({
    client: HttpClient.make(() => Effect.die("the stand-in run reached an HTTP client")),
    systemOne: () =>
      Effect.gen(function* () {
        yield* Ref.update(calls, (count) => count + 1)
        return yield* Effect.die("the stand-in run called systemOne")
      }),
    listModels: () => Effect.die("the stand-in run listed models"),
  })

it.effect("a stand-in run completes with zero systemOne calls and a miss per asked question", () =>
  Effect.gen(function* () {
    const systemOneCalls = yield* Ref.make(0)
    const ledger = new MissLedger()
    const registry = new Registry()
    const provider = standinModel({ registry, ledger })

    const report = yield* checkRepository({
      cwd: corpus,
      paths: ["src"],
      // The planned rules only: their questions go through the batched seam, which is
      // the seam under test. Rules that ask one question at a time would still be misses,
      // but this keeps the ledger's accounting equal to one request.
      rules: [
        "joggle/duplicate-implementation",
        "joggle/duplicate-meaning",
        "joggle/naming-drift",
      ],
      typecheck: false,
      types: "off",
      useTsgo: false,
      cacheDirExplicit: true,
      cacheDir: "/tmp/joggle-standin-test",
      replayUnchanged: false,
      changed: false,
      baselinePath: undefined,
      updateBaselinePath: undefined,
      config: {},
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DecisionModel.DecisionModel, provider),
          Layer.succeed(PlanAnswers, {
            get: () => Effect.succeed(Option.none()),
            put: () => Effect.void,
          }),
          Layer.succeed(DecisionStats, {
            read: Effect.succeed(totals),
            setTotal: () => Effect.void,
          }),
          Layer.succeed(TypeSafeClient.TypeSafeClient, fakeClient(systemOneCalls)),
        ),
      ),
      Effect.provide(tsgoStub),
      Effect.provide(builtIn),
      Effect.provide(nodeLayer),
    )

    // No provider, no call: the miss path is local from the first question to the report.
    expect(yield* Ref.get(systemOneCalls)).toBe(0)

    // Every decision the seam saw became a named miss. The ledger's counts are the
    // questions asked, not the rows: one hash can be asked by several candidates.
    const rows = ledger.snapshot()
    const recorded = rows.reduce((sum, row) => sum + row.count, 0)
    expect(registry.asked).toBeGreaterThan(0)
    expect(recorded).toBe(registry.asked)
    expect(rows.every((row) => row.reason === "no-head")).toBe(true)
    expect(rows.every((row) => row.labelSet.length > 0)).toBe(true)

    // The reason reaches the report's own vocabulary, and the run still completes.
    expect(report.skipped.length).toBeGreaterThan(0)
    expect(report.skipped.every((skip) => skip.reason.includes("no-head"))).toBe(true)
  }),
)
