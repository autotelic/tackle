import { expect, test } from "vitest"
import { Effect, Layer, Option, Ref } from "effect"
import { Decision, DecisionModel } from "effect/unstable/ai"
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Atoms } from "../src/atoms.ts"
import { checkRepository } from "../src/check.ts"
import { DecisionStats } from "../src/decision.ts"
import { PlanAnswers, type Plan } from "../src/plans.ts"
import { policy } from "../src/policy.ts"
import { everyFile, finding, outcome, type DecisionAnswers, type PlannedRule } from "../src/rule.ts"
import { Rules } from "../src/rules/index.ts"
import type { Diagnostic, Drop } from "../src/schema.ts"
import { shortHash } from "../src/state.ts"
import { planAnswersLayer } from "../src/testing.ts"
import { corpus, nodeLayer, tsgoStub } from "./support.ts"

const totals = { requests: 0, replayed: 0, calls: 0, unavailable: 0, inputTokens: 0, outputTokens: 0 }

/**
 * A rule that does NOT filter by scope. It emits one candidate inside the run's
 * scope and one outside it, and reads both. If the engine does not enforce the
 * scope, the out-of-scope candidate is judged and reported.
 */
const probe: PlannedRule = {
  id: "test/scope-probe",
  severity: "warn",
  description: "Emits one in-scope and one out-of-scope candidate.",
  judged: true,
  onUnavailable: "report",
  plan: Effect.fn("test/scope-probe")(function* () {
    const atoms = yield* Atoms
    const plans: Array<Plan<DecisionAnswers>> = []
    for (const file of ["src/users.ts", "src/orders.ts"]) {
      const id = yield* atoms.add({ probe: file })
      plans.push({
        ruleId: "test/scope-probe",
        subject: file,
        concerns: [file],
        atoms: [id],
        decisions: {
          verdict: Decision.classify({ instructions: "probe " + file, criteria: { a: "a", b: "b" } }),
        },
        read: (answers) => answers,
      })
    }
    return {
      plans,
      read: (answers) => {
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        plans.forEach((plan, index) => {
          const answer = answers[index]
          if (answer === undefined) {
            drops.push({
              ruleId: "test/scope-probe",
              subject: plan.subject,
              stage: "unreadable" as const,
              reason: "no answer",
            })
            return
          }
          diagnostics.push(
            finding({
              ruleId: "test/scope-probe",
              severity: "warn",
              message: "probe " + plan.subject,
              location: { file: plan.subject, line: 1, column: 1 },
              judged: true,
            }),
          )
        })
        return outcome(diagnostics, [], drops)
      },
    }
  }),
}

const recordingModel = (seen: Ref.Ref<ReadonlyArray<string>>): Layer.Layer<DecisionModel.DecisionModel> =>
  Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: ({ decisions }) =>
        Effect.gen(function* () {
          yield* Ref.update(seen, (current) => [...current, ...Object.values(decisions).map((d) => d.instructions)])
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
                probabilities: Object.fromEntries(decision.criteria.map((level) => [level, 1 / decision.criteria.length])),
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

test("a candidate outside the run's scope is never judged and never reported", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
    const seen = yield* Ref.make<ReadonlyArray<string>>([])
    const dir = mkdtempSync(join(tmpdir(), "joggle-scope-"))
    // A stored run that says orders.ts is UNCHANGED, so the scope is users.ts.
    writeFileSync(
      join(dir, "last-run.json"),
      JSON.stringify({
        version: policy.version,
        manifest: "stale-manifest-so-the-run-proceeds",
        sources: [
          { path: "src/orders.ts", hash: shortHash(readFileSync(join(corpus, "src/orders.ts"), "utf8")), exports: [] },
        ],
        diagnostics: [],
        files: 2,
        rules: 1,
        skipped: [],
        notes: [],
        decision: totals,
        elapsedMs: 0,
      }),
    )
    const report = yield* checkRepository({
      cwd: corpus,
      paths: ["src"],
      rules: undefined,
      typecheck: false,
      types: "off",
      useTsgo: false,
      cacheDirExplicit: true,
      cacheDir: dir,
      runCacheDir: dir,
      replayUnchanged: false,
      changed: true,
      baselinePath: undefined,
      updateBaselinePath: undefined,
      config: {},
    }).pipe(
      Effect.provide(Layer.mergeAll(
        recordingModel(seen),
        planAnswersLayer,
        Layer.succeed(DecisionStats, { read: Effect.succeed(totals) }),
        tsgoStub,
        Layer.succeed(Rules, [probe]),
      )),
      Effect.provide(nodeLayer),
    )
    const asked = yield* Ref.get(seen)
    return { asked, files: report.diagnostics.map((entry) => entry.location.file) }
    }).pipe(Effect.provide(nodeLayer)) as Effect.Effect<
      { asked: ReadonlyArray<string>; files: ReadonlyArray<string> },
      unknown,
      never
    >,
  )
  // Only the in-scope candidate was sent.
  expect(result.asked).toEqual(["probe src/users.ts"])
  // And only the in-scope candidate was reported.
  expect(result.files).toEqual(["src/users.ts"])
})

test("a git-changed scope judges only the files that moved", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<string>>([])
      const report = yield* checkRepository({
        cwd: corpus,
        paths: ["src"],
        rules: undefined,
        typecheck: false,
        types: "off",
        useTsgo: false,
        cacheDirExplicit: true,
        cacheDir: mkdtempSync(join(tmpdir(), "joggle-git-scope-")),
        // Replay is on, and a git scope must ignore it: the stored report is the
        // whole repository, not the slice the caller asked about.
        replayUnchanged: true,
        changed: false,
        changedPaths: ["src/users.ts"],
        baselinePath: undefined,
        updateBaselinePath: undefined,
        config: {},
      }).pipe(
        Effect.provide(recordingModel(seen)),
        Effect.provide(planAnswersLayer),
        Effect.provide(Layer.succeed(DecisionStats, { read: Effect.succeed(totals) })),
        Effect.provide(tsgoStub),
        Effect.provide(Layer.succeed(Rules, [probe])),
      )
      return {
        asked: yield* Ref.get(seen),
        files: report.diagnostics.map((entry) => entry.location.file),
        replayed: report.replayed,
      }
    }).pipe(Effect.provide(nodeLayer)) as Effect.Effect<
      { asked: ReadonlyArray<string>; files: ReadonlyArray<string>; replayed: boolean },
      unknown,
      never
    >,
  )
  expect(result.asked).toEqual(["probe src/users.ts"])
  expect(result.files).toEqual(["src/users.ts"])
  expect(result.replayed).toBe(false)
})

test("an empty git scope says so instead of looking like a clean repository", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<string>>([])
      const report = yield* checkRepository({
        cwd: corpus,
        paths: ["src"],
        rules: undefined,
        typecheck: false,
        types: "off",
        useTsgo: false,
        cacheDirExplicit: true,
        cacheDir: mkdtempSync(join(tmpdir(), "joggle-empty-scope-")),
        replayUnchanged: true,
        changed: false,
        changedPaths: [],
        changedBase: "origin/develop",
        baselinePath: undefined,
        updateBaselinePath: undefined,
        config: {},
      }).pipe(
        Effect.provide(recordingModel(seen)),
        Effect.provide(planAnswersLayer),
        Effect.provide(Layer.succeed(DecisionStats, { read: Effect.succeed(totals) })),
        Effect.provide(tsgoStub),
        Effect.provide(Layer.succeed(Rules, [probe])),
      )
      return { asked: yield* Ref.get(seen), notes: report.notes.map((note) => note.reason) }
    }).pipe(Effect.provide(nodeLayer)) as Effect.Effect<
      { asked: ReadonlyArray<string>; notes: ReadonlyArray<string> },
      unknown,
      never
    >,
  )
  // Nothing was judged, and the report explains why rather than reporting zero.
  expect(result.asked).toEqual([])
  expect(result.notes.some((note) => note.includes("origin/develop"))).toBe(true)
  expect(result.notes.some((note) => note.includes("empty"))).toBe(true)
})

test("a candidate past the run's token budget is reported, not judged", async () => {
  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const seen = yield* Ref.make<ReadonlyArray<string>>([])
      const report = yield* checkRepository({
        cwd: corpus,
        paths: ["src"],
        rules: undefined,
        typecheck: false,
        types: "off",
        useTsgo: false,
        cacheDirExplicit: true,
        cacheDir: mkdtempSync(join(tmpdir(), "joggle-budget-")),
        replayUnchanged: false,
        changed: false,
        baselinePath: undefined,
        updateBaselinePath: undefined,
        maxInputTokens: 1,
        config: {},
      }).pipe(
        Effect.provide(recordingModel(seen)),
        Effect.provide(planAnswersLayer),
        Effect.provide(Layer.succeed(DecisionStats, { read: Effect.succeed(totals) })),
        Effect.provide(tsgoStub),
        Effect.provide(Layer.succeed(Rules, [probe])),
      )
      return {
        asked: yield* Ref.get(seen),
        stages: report.drops.map((drop) => drop.stage),
        files: report.diagnostics.map((entry) => entry.location.file),
      }
    }).pipe(Effect.provide(nodeLayer)) as Effect.Effect<
      { asked: ReadonlyArray<string>; stages: ReadonlyArray<string>; files: ReadonlyArray<string> },
      unknown,
      never
    >,
  )
  // The budget stopped the run before the model was reached.
  expect(result.asked).toEqual([])
  // And what it did not judge is reported as a budget drop, never in silence.
  expect(result.stages).toEqual(["budget", "budget"])
  expect(result.files).toEqual([])
})
