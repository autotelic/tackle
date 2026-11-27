import { expect, test } from "vitest"
import { Effect, Option } from "effect"
import { cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { checkRepository } from "../src/check.ts"
import { layer as decisionLayer } from "../src/decision.ts"
import { fragmentsOf } from "../src/fragments.ts"
import { builtIn } from "../src/rules/index.ts"
import { STORE_PATH, closeFactStore, storeVersionOf, useFactStore } from "../src/store.ts"
import { loadWorkspace, type Workspace } from "../src/workspace.ts"
import { nodeLayer, tsgoStub } from "./support.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(nodeLayer)) as Effect.Effect<A, E, never>)

const fixture = () => loadWorkspace("testdata/containment", ["src"])

const idsOf = (workspace: Workspace): ReadonlyArray<ReadonlyArray<string>> =>
  workspace.units.map((unit) => fragmentsOf(unit).ids)

const storeFile = (root: string): string => join(root, STORE_PATH)

test("a cold store fills, a warm store reuses, and the ids do not move", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  useFactStore(root)
  const coldIds = idsOf(first)
  const cold = closeFactStore()
  expect(cold?.state).toBe("cold")
  expect(cold?.walked).toBe(first.units.length)
  expect(cold?.reused).toBe(0)
  expect(existsSync(storeFile(root))).toBe(true)

  const second = await run(fixture())
  useFactStore(root)
  const warmIds = idsOf(second)
  const warm = closeFactStore()
  expect(warm?.state).toBe("warm")
  expect(warm?.walked).toBe(0)
  expect(warm?.reused).toBe(second.units.length)
  // A cache that changes the answer is not a cache. Same unit, same ids.
  expect(warmIds).toEqual(coldIds)

  const db = new DatabaseSync(storeFile(root))
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as ReadonlyArray<{
      name?: string
    }>
  ).map((row) => row.name)
  db.close()
  for (const table of ["object", "fragment", "df", "surface"]) {
    expect(tables).toContain(table)
  }
})

test("a store from another normaliser is rebuilt, not re-read", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  useFactStore(root)
  const before = idsOf(first)
  closeFactStore()

  const stale = storeVersionOf() === 1 ? 2 : 1
  const db = new DatabaseSync(storeFile(root))
  db.exec("PRAGMA user_version = " + String(stale))
  db.close()

  useFactStore(root)
  const after = idsOf(first)
  const rebuilt = closeFactStore()
  expect(rebuilt?.state).toBe("rebuilt-on-version-change")
  expect(after).toEqual(before)
})

test("a corrupt store is replaced, and the run still has its facts", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  useFactStore(root)
  const expected = idsOf(first)
  closeFactStore()

  writeFileSync(storeFile(root), "this is not a SQLite database")

  useFactStore(root)
  const after = idsOf(first)
  const recovered = closeFactStore()
  expect(recovered?.state).toBe("cold")
  expect(recovered?.issue).toContain("could not be read")
  expect(after).toEqual(expected)
})

test("a check says cold then warm in its census, with the same findings", async () => {
  const base = mkdtempSync(join(tmpdir(), "joggle-store-check-"))
  const root = join(base, "fixture")
  cpSync("testdata/containment", root, { recursive: true })
  const cacheDir = join(base, "cache")

  const check = () =>
    run(
      checkRepository({
        cwd: root,
        paths: ["src"],
        rules: ["joggle/containment"],
        typecheck: false,
        types: "off",
        useTsgo: false,
        cacheDirExplicit: true,
        cacheDir,
        replayUnchanged: false,
        changed: false,
        baselinePath: undefined,
        updateBaselinePath: undefined,
        config: {},
      }).pipe(
        Effect.provide(decisionLayer({ cacheDir, offline: true, apiKey: Option.none() })),
        Effect.provide(tsgoStub),
        Effect.provide(builtIn),
      ),
    )

  const cold = await check()
  const coldNote = cold.notes.find((note) => note.reason.startsWith("fragment store:"))
  expect(coldNote?.reason).toContain("fragment store: cold")

  const warm = await check()
  const warmNote = warm.notes.find((note) => note.reason.startsWith("fragment store:"))
  expect(warmNote?.reason).toContain("fragment store: warm")
  expect(warm.diagnostics).toEqual(cold.diagnostics)
})
