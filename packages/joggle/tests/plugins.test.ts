import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { loadPlugins } from "../src/plugins.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

const cwd = process.cwd()

test("a rule can arrive from the repository instead of the tool", async () => {
  const loaded = await run(loadPlugins(["./tests/fixtures/plugin/rule.ts"], cwd))
  expect(loaded.rules.map((rule) => rule.id)).toEqual(["example/one-thing"])
  expect(loaded.failures).toEqual([])
  // Fingerprinted, so editing a plugin invalidates the run cache the same way
  // editing this package does. A plugin outside the hashed directory would
  // otherwise replay a stale report, which is the analysisVersion bug again.
  expect(loaded.fingerprints.length).toBe(1)
})

test("a plugin that cannot load is reported, not swallowed", async () => {
  const loaded = await run(loadPlugins(["./tests/fixtures/plugin/missing.ts"], cwd))
  expect(loaded.rules).toEqual([])
  expect(loaded.failures.length).toBe(1)
  expect(loaded.failures[0]?.specifier).toContain("missing.ts")
  // A rule that is silently absent makes the report look clean, which is the one
  // failure mode this program keeps having to design against.
  expect((loaded.failures[0]?.reason ?? "").length).toBeGreaterThan(0)
})

test("a module that exports no rules says so", async () => {
  const loaded = await run(loadPlugins(["./tests/fixtures/plugin/empty.ts"], cwd))
  expect(loaded.failures[0]?.reason).toContain("rules")
})

test("no plugins is not a failure", async () => {
  const loaded = await run(loadPlugins([], cwd))
  expect(loaded).toEqual({ rules: [], failures: [], fingerprints: [], config: {} })
})
