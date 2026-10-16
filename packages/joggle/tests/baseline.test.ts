import { expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Path } from "effect"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readBaseline, writeBaseline } from "../src/run-cache.ts"
import { nodeLayer } from "./support.ts"

const fresh = (): string => mkdtempSync(join(tmpdir(), "joggle-baseline-"))

const known = (set: ReadonlySet<string> | undefined): ReadonlyArray<string> =>
  set === undefined ? [] : [...set].sort()

it.effect("writes one fragment per accepted finding and reads them back", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = join(fresh(), "baseline")

    yield* writeBaseline(fs, path, dir, ["joggle/one\u0000a", "joggle/two\u0000b"])

    // One file per finding: a new acceptance cannot conflict with another
    // branch's, which is the whole reason for fragments.
    const names = (yield* fs.readDirectory(dir)).filter((name) => name.endsWith(".json"))
    expect(names.length).toBe(2)
    expect(known(yield* readBaseline(fs, path, dir))).toEqual(["joggle/one\u0000a", "joggle/two\u0000b"])
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("drops a fragment the run no longer accepts", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const dir = join(fresh(), "baseline")

    yield* writeBaseline(fs, path, dir, ["old\u0000a"])
    yield* writeBaseline(fs, path, dir, ["new\u0000b"])

    expect(known(yield* readBaseline(fs, path, dir))).toEqual(["new\u0000b"])
    const names = (yield* fs.readDirectory(dir)).filter((name) => name.endsWith(".json"))
    expect(names.length).toBe(1)
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("reads the legacy single file, so an old baseline still works", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = join(fresh(), "baseline.json")
    yield* fs.writeFileString(file, JSON.stringify({ version: "0.1.0", identities: ["x", "y"] }))

    expect(known(yield* readBaseline(fs, path, file))).toEqual(["x", "y"])
    // And a write to a `.json` target still produces the old shape.
    yield* writeBaseline(fs, path, file, ["z"])
    const decoded = JSON.parse(yield* fs.readFileString(file)) as { identities: ReadonlyArray<string> }
    expect(decoded.identities).toEqual(["z"])
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("a missing baseline is a miss, not an empty one", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const missing = yield* readBaseline(fs, path, join(fresh(), "baseline"))
    expect(missing).toBeUndefined()
  }).pipe(Effect.provide(nodeLayer)),
)
