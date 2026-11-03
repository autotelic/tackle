import { expect, it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { make as makeAnswerStore } from "../src/answer-store.ts"
import { checkRepository } from "../src/check.ts"
import { layer as decisionLayer } from "../src/decision.ts"
import { answerKeyFor } from "../src/plans.ts"
import { everyFile } from "../src/rule.ts"
import { builtIn } from "../src/rules/index.ts"
import { unaccountedDrop } from "../src/rules/unaccounted-drop.ts"
import { decisionStub } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { nodeLayer, tsgoStub } from "./support.ts"

const fixture = "tests/fixtures/replay"

/**
 * A committed verdict replays even when the run cannot reach the model.
 *
 * With no key, a request that carries one unanswered question fails as a whole,
 * and the engine used to drop the cached answers in the same chunk with it: one
 * new candidate silenced every committed verdict beside it, and CI -- which runs
 * with no key -- replayed nothing.
 */
it.effect("a cached verdict survives a chunk the model could not answer", () =>
  Effect.gen(function* () {
    const workspace = yield* loadWorkspace(fixture, ["src"])
    const planned = yield* unaccountedDrop
      .plan(workspace, everyFile, { config: {} })
      .pipe(Effect.provide(decisionStub()))
    expect(planned.plans.length).toBe(2)
    const [cachedPlan, uncachedPlan] = planned.plans
    if (cachedPlan === undefined || uncachedPlan === undefined) throw new Error("two candidates")

    // Remember a verdict for one candidate only, so the chunk still has a miss.
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const cacheDir = mkdtempSync(join(tmpdir(), "joggle-replay-"))
    const store = yield* makeAnswerStore(fs, path, cacheDir)
    for (const decision of Object.values(cachedPlan.decisions)) {
      yield* store.put(answerKeyFor(decision, cachedPlan.atoms), {
        kind: "Classify",
        label: "unaccounted",
        probabilities: { unaccounted: 0.75, accounted_elsewhere: 0.125, internal_only: 0.125 },
        confidence: 0.9,
      })
    }

    const report = yield* checkRepository({
      cwd: fixture,
      paths: ["src"],
      rules: ["joggle/unaccounted-drop"],
      typecheck: false,
      types: "off",
      useTsgo: false,
      cacheDirExplicit: true,
      cacheDir,
      replayUnchanged: false,
      changed: false,
      baselinePath: undefined,
      updateBaselinePath: undefined,
      config: { unavailable: "count" },
    }).pipe(
      Effect.provide(decisionLayer({ cacheDir, offline: true, apiKey: Option.none() })),
      Effect.provide(tsgoStub),
      Effect.provide(builtIn),
    )

    // The remembered candidate is a judged finding; the other is counted, as the
    // repository's `unavailable: count` asks, rather than reported as answered.
    expect(report.diagnostics.map((entry) => [entry.location.file, entry.judged])).toEqual([
      [cachedPlan.concerns[0], true],
    ])
    expect(report.notes.some((note) => note.reason.includes("1 candidate(s) were not judged"))).toBe(
      true,
    )
    expect(report.decision.cached).toBe(1)
  }).pipe(Effect.provide(nodeLayer)),
)
