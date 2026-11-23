import { expect } from "vitest"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { mkdirSync, mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { cacheDirFor, runCacheDirFor, scopedAnswerCacheDir } from "../src/state.ts"
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

it.effect("a scoped run answers into the machine cache, not the committed ledger", () =>
  Effect.gen(function* () {
    const dir = fresh()
    mkdirSync(join(dir, ".joggle"))
    const repository = yield* cacheDirFor(dir, undefined)
    const machine = yield* runCacheDirFor(dir)
    // The branch's verdicts are a cache: committing them puts thousands of lines in every
    // pull request of a stack (5,890 answers became 131,440 lines, 20.5 MB for 0.9 MB).
    expect(scopedAnswerCacheDir({ declared: undefined, repository, machine, scoped: true })).toBe(
      machine,
    )
    // A full run still writes the ledger, which is what trunk commits.
    expect(scopedAnswerCacheDir({ declared: undefined, repository, machine, scoped: false })).toBe(
      repository,
    )
    // A caller that names a store means it.
    expect(
      scopedAnswerCacheDir({ declared: "/explicit", repository, machine, scoped: true }),
    ).toBe("/explicit")
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
