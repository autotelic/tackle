import { expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cacheDirFor, runCacheDirFor } from "../src/state.ts"
import { nodeLayer } from "./support.ts"

const fresh = (): string => mkdtempSync(join(tmpdir(), "joggle-state-"))

it.effect("an explicit cache dir always wins", () =>
  Effect.gen(function* () {
    const dir = fresh()
    mkdirSync(join(dir, ".joggle"))
    expect(yield* cacheDirFor(dir, "/explicit")).toBe("/explicit")
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("a repository that already has a .joggle keeps its committed cache", () =>
  Effect.gen(function* () {
    const dir = fresh()
    mkdirSync(join(dir, ".joggle"))
    expect(yield* cacheDirFor(dir, undefined)).toBe(join(dir, ".joggle"))
  }).pipe(Effect.provide(nodeLayer)),
)

it.effect("a visited checkout gets the machine cache, and no .joggle is created", () =>
  Effect.gen(function* () {
    const dir = fresh()
    const expected = yield* runCacheDirFor(dir)
    expect(yield* cacheDirFor(dir, undefined)).toBe(expected)
    // Nothing was written into the checkout it was pointed at.
    expect(yield* cacheDirFor(dir, undefined)).not.toContain(dir)
  }).pipe(Effect.provide(nodeLayer)),
)
