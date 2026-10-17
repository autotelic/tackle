import { expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { checkRepository } from "../src/check.ts"
import type { JoggleConfig } from "../src/config.ts"
import { layer as decisionLayer } from "../src/decision.ts"
import { builtIn } from "../src/rules/index.ts"
import { corpus, nodeLayer, tsgoStub } from "./support.ts"

/*
 * `joggle.config.json` is part of the run.
 *
 * The run manifest hashed the rule IDS and never how they were configured, so a
 * stored run survived editing the config that produced it: a severity moved, a
 * path added to `ignore`, an architecture renamed, and the next run replayed a
 * report for a configuration that no longer existed. `tests/fingerprint.test.ts`
 * pins the mechanism (`manifestOf` is a function of the settings too); this test
 * pins the behavior.
 */

it.effect("a config edit retires the stored run instead of replaying it", () =>
  Effect.gen(function* () {
    const cacheDir = mkdtempSync(join(tmpdir(), "joggle-config-key-"))
    const run = (config: JoggleConfig) =>
      checkRepository({
        cwd: corpus,
        paths: ["src"],
        rules: undefined,
        typecheck: false,
        types: "off",
        useTsgo: false,
        cacheDirExplicit: true,
        cacheDir,
        runCacheDir: cacheDir,
        replayUnchanged: true,
        changed: false,
        baselinePath: undefined,
        updateBaselinePath: undefined,
        config,
      }).pipe(
        Effect.provide(decisionLayer({ cacheDir, offline: true, apiKey: Option.none() })),
        Effect.provide(tsgoStub),
        Effect.provide(builtIn),
        Effect.provide(nodeLayer),
      )

    const first = yield* run({})
    expect(first.replayed).toBe(false)

    // The control: nothing changed, so the stored run IS the run. Without this
    // the test below would pass on a run that never replayed at all.
    const second = yield* run({})
    expect(second.replayed).toBe(true)

    const reported = first.diagnostics[0]
    if (reported === undefined) throw new Error("the fixture reported nothing to silence")

    // A config edit that silences the finding the first run reported. The rule ids
    // are identical either way, so only the settings hash can tell the two runs
    // apart -- which is exactly what the old manifest could not do.
    const third = yield* run({
      ignore: [{ rule: reported.ruleId, path: "src/**", reason: "silenced by the test" }],
    })
    expect(third.replayed).toBe(false)
    expect(third.diagnostics.some((entry) => entry.ruleId === reported.ruleId)).toBe(false)
  }),
)
