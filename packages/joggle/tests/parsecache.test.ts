import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadParses } from "../src/parsecache.ts"
import { loadWorkspace, type Workspace } from "../src/workspace.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeServices.layer)) as Effect.Effect<A, E, never>)

const corpus = "tests/fixtures/corpus"

/** Everything a rule can read off a unit, so a decode that drops a field fails. */
const fingerprintOf = (workspace: Workspace): unknown =>
  workspace.units.map((unit) => ({
    name: unit.name,
    kind: unit.kind,
    start: unit.start,
    end: unit.end,
    shape: unit.shape,
    shapeHash: unit.shapeHash,
    typeSignature: unit.typeSignature,
    typeRefs: unit.typeRefs,
    typed: unit.typed,
    test: unit.test,
    text: unit.text,
    tokens: unit.tokens,
    // Sorted, because a Set's iteration order is insertion order and the whole
    // question is whether the rebuilt set holds the same members.
    shingles: [...unit.shingles].sort(),
  }))

test("a parse survives the disk and comes back the same", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-parses-"))

  const cold = await run(loadParses({ cacheDir: dir, tool: "tool-one" }))
  const first = await run(loadWorkspace(corpus, ["src"], { parses: cold.parses }))
  await run(cold.save)
  expect(cold.parses.misses()).toBeGreaterThan(0)

  const warm = await run(loadParses({ cacheDir: dir, tool: "tool-one" }))
  const second = await run(loadWorkspace(corpus, ["src"], { parses: warm.parses }))
  // Every file came from the cache, and nothing was parsed again.
  expect(warm.parses.hits()).toBe(first.files.length)
  expect(warm.parses.misses()).toBe(0)
  // And the decoded parse is the same parse: every field a rule reads, and the
  // shingle set, which is the one field that cannot survive JSON as itself.
  expect(fingerprintOf(second)).toEqual(fingerprintOf(first))
})

test("a cache from a different tool is not a cache hit", async () => {
  // The parser is part of the tool, so an entry it did not produce is a wrong
  // answer rather than a fast one. The whole cache is discarded, not repaired.
  const dir = mkdtempSync(join(tmpdir(), "joggle-parses-"))
  const cold = await run(loadParses({ cacheDir: dir, tool: "tool-one" }))
  await run(loadWorkspace(corpus, ["src"], { parses: cold.parses }))
  await run(cold.save)

  const other = await run(loadParses({ cacheDir: dir, tool: "tool-two" }))
  const workspace = await run(loadWorkspace(corpus, ["src"], { parses: other.parses }))
  expect(other.parses.hits()).toBe(0)
  expect(other.parses.misses()).toBe(workspace.files.length)
})

test("no cache is a miss, not a failure", async () => {
  const dir = mkdtempSync(join(tmpdir(), "joggle-parses-"))
  const cache = await run(loadParses({ cacheDir: dir, tool: "tool-one" }))
  expect(cache.parses.hits()).toBe(0)
  // Reading a directory with no cache file is the first run, which is not an error.
  const workspace = await run(
    loadWorkspace(corpus, ["src"], { parses: cache.parses }),
  )
  expect(workspace.files.length).toBeGreaterThan(0)
  await run(cache.save)
  expect(cache.parses.misses()).toBeGreaterThan(0)
})
