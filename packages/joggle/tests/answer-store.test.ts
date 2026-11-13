import { expect, test } from "vitest"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Option, Path, Result } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
  census,
  make,
  mergeEntries,
  mergeShardText,
  parseLines,
  prune,
  renderEntry,
  renderShard,
  shardOf,
  type Entry,
} from "../src/answer-store.ts"
import type { StoredAnswer } from "../src/plans.ts"
import { nodeLayer } from "./support.ts"

const probability = (value: number): StoredAnswer => ({ kind: "Probability", probability: value })

const entry = (key: string, at: number, value: number): Entry => ({ key, writtenAt: at, answer: probability(value) })

const fresh = (name: string): string => mkdtempSync(join(tmpdir(), name))

test("a shard is sorted by key and newline-terminated", () => {
  const text = renderShard([entry("cd", 2, 0.2), entry("ab", 1, 0.1)])
  expect(text).toBe(renderEntry(entry("ab", 1, 0.1)) + "\n" + renderEntry(entry("cd", 2, 0.2)) + "\n")
})

test("a shard round-trips through its lines", () => {
  const entries = [entry("ab", 1, 0.1), entry("cd", 2, 0.2)]
  expect(parseLines(renderShard(entries)).entries).toEqual(entries)
})

test("a malformed line is skipped, not fatal", () => {
  expect(parseLines("garbage\n\nab\t1\tnot json\n")).toEqual({ entries: [], skippedLines: 2 })
})

test("the shard is the first two characters of the key", () => {
  expect(shardOf("ab0123")).toBe("ab")
  expect(shardOf("AB0123")).toBe("ab")
})

test("a merge takes the union, and the newer answer wins a shared key", () => {
  const merged = mergeEntries({
    ours: [entry("ab", 5, 0.1)],
    theirs: [entry("cd", 1, 0.2), entry("ab", 9, 0.9)],
  })
  expect(merged).toEqual([entry("ab", 9, 0.9), entry("cd", 1, 0.2)])
})

test("the driver declines rather than dropping a side it cannot read", async () => {
  const declined = await Effect.runPromise(Effect.result(mergeShardText({ ours: "not a shard\n", theirs: "" })))
  expect(Result.isFailure(declined)).toBe(true)
  const ours = renderShard([entry("ab", 1, 0.1)])
  expect(await Effect.runPromise(mergeShardText({ ours, theirs: "" }))).toBe(ours)
})

it.effect("writes one sorted file by default, and a fresh store replays it", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-store-")
    const first = "ab0123456789abcd"
    const second = "cd0123456789abcd"

    const store = yield* make(fs, path, dir)
    expect(store.layout).toBe("single")
    yield* store.put(first, probability(0.42))
    yield* store.put(second, probability(0.24))

    const text = yield* fs.readFileString(join(dir, "answers.jsonl"))
    expect(parseLines(text).entries.map((line) => line.key)).toEqual([first, second])
    expect(yield* fs.exists(join(dir, "answers"))).toBe(false)

    const reopened = yield* make(fs, path, dir)
    expect(reopened.layout).toBe("single")
    expect(Option.getOrUndefined(yield* reopened.get(first))).toEqual(probability(0.42))
    expect(Option.getOrUndefined(yield* reopened.get(second))).toEqual(probability(0.24))

    // The cache owns the treatment of its own files: text-diffable (it is the
    // reviewed ledger) and merged by git's built-in union, which needs no
    // per-machine driver registration.
    const attributes = yield* fs.readFileString(join(dir, ".gitattributes"))
    expect(attributes).toContain("answers.jsonl merge=union")
    expect(attributes).toContain("answers/*.jsonl merge=union")
    expect(attributes).not.toContain("-diff")
    expect(attributes).not.toContain("linguist-generated")
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("writes shards when asked, and consolidates back with migrate", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-layout-")
    const first = "ab0123456789abcd"
    const second = "cd0123456789abcd"

    const store = yield* make(fs, path, dir)
    yield* store.put(first, probability(0.42))
    yield* store.put(second, probability(0.24))
    expect(yield* store.migrate("sharded")).toBe(2)
    expect(parseLines(yield* fs.readFileString(join(dir, "answers", "ab.jsonl"))).entries.length).toBe(1)
    expect(yield* fs.exists(join(dir, "answers.jsonl"))).toBe(false)

    const sharded = yield* make(fs, path, dir)
    expect(sharded.layout).toBe("sharded")
    expect(yield* sharded.migrate("single")).toBe(2)
    expect(yield* fs.exists(join(dir, "answers.jsonl"))).toBe(true)
    expect(parseLines(yield* fs.readFileString(join(dir, "answers.jsonl"))).entries.length).toBe(2)
    expect(yield* fs.exists(join(dir, "answers", "ab.jsonl"))).toBe(false)
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("concurrent writes all reach disk", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-concurrent-")
    const keys = Array.from({ length: 64 }, (_, index) => index.toString(16).padStart(2, "0") + "0123456789abcd")

    const store = yield* make(fs, path, dir)
    yield* Effect.forEach(keys, (key) => store.put(key, probability(0.5)), { concurrency: "unbounded", discard: true })

    const reopened = yield* make(fs, path, dir)
    expect(yield* reopened.size).toBe(keys.length)
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("migrates the legacy single file on the first write", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-migrate-")
    const first = "ab0123456789abcd"
    const second = "cd0123456789abcd"
    const third = "ef0123456789abcd"
    yield* fs.writeFileString(
      join(dir, "answers.json"),
      JSON.stringify({
        version: "0.1.0",
        entries: { [first]: probability(0.1), [second]: probability(0.2) },
      }),
    )

    const store = yield* make(fs, path, dir)
    expect(Option.getOrUndefined(yield* store.get(second))).toEqual(probability(0.2))

    // The first write consolidates everything into the single ledger, then
    // removes the legacy object.
    yield* store.put(third, probability(0.3))
    expect(yield* fs.exists(join(dir, "answers.json"))).toBe(false)
    expect(parseLines(yield* fs.readFileString(join(dir, "answers.jsonl"))).entries.length).toBe(3)

    const reopened = yield* make(fs, path, dir)
    expect(Option.getOrUndefined(yield* reopened.get(first))).toEqual(probability(0.1))
    expect(Option.getOrUndefined(yield* reopened.get(second))).toEqual(probability(0.2))
    expect(Option.getOrUndefined(yield* reopened.get(third))).toEqual(probability(0.3))
    expect(yield* reopened.size).toBe(3)
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("counts a single-file ledger and reports its layout", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-census-")
    yield* fs.writeFileString(
      join(dir, "answers.jsonl"),
      renderShard([entry("ab1", 1_000, 0.1), entry("cd2", 2_000, 0.9)]),
    )

    const found = yield* census(fs, path, dir)
    expect(found.layout).toBe("single")
    expect(found.files).toBe(1)
    expect(found.entries).toBe(2)
    expect(found.verdicts).toEqual({ yes: 1, no: 1 })
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("prunes by age, rewriting only the shard that changed", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-prune-age-")
    const old = "ab0123456789abcd"
    const recent = "abfedcba98765432"
    yield* fs.makeDirectory(join(dir, "answers"), { recursive: true })
    yield* fs.writeFileString(join(dir, "answers", "ab.jsonl"), renderShard([entry(old, 1_000, 0.1), entry(recent, 9_000, 0.2)]))

    const result = yield* prune(fs, path, dir, { olderThanSeconds: 5_000, now: 10_000 })

    expect(result.removed).toBe(1)
    expect(result.kept).toBe(1)
    expect(parseLines(yield* fs.readFileString(join(dir, "answers", "ab.jsonl"))).entries.map((line) => line.key)).toEqual([
      recent,
    ])
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("prunes oldest-first until the store fits", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = fresh("joggle-prune-size-")
    const oldest = "ab00000000000000"
    const middle = "ab11111111111111"
    const newest = "ab22222222222222"
    const one = renderEntry(entry(middle, 2_000, 0.2)).length + 1
    yield* fs.makeDirectory(join(dir, "answers"), { recursive: true })
    yield* fs.writeFileString(
      join(dir, "answers", "ab.jsonl"),
      renderShard([entry(oldest, 1_000, 0.1), entry(middle, 2_000, 0.2), entry(newest, 3_000, 0.3)]),
    )

    // Room for exactly two entries: the two newest survive.
    const result = yield* prune(fs, path, dir, { maxBytes: one * 2, now: 10_000 })

    expect(result.removed).toBe(1)
    expect(parseLines(yield* fs.readFileString(join(dir, "answers", "ab.jsonl"))).entries.map((line) => line.key)).toEqual([
      middle,
      newest,
    ])
  }).pipe(Effect.provide(nodeLayer)),
)
