import { expect, test } from "vitest"
import { Effect, Option, Result } from "effect"
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { checkRepository } from "../src/check.ts"
import { layer as decisionLayer } from "../src/decision.ts"
import { fragmentsOf } from "../src/fragments.ts"
import { builtIn } from "../src/rules/index.ts"
import {
  STORE_PATH,
  createFactStore,
  storeVersionOf,
  type FactStore,
  type FactStoreReport,
} from "../src/store.ts"
import { loadWorkspace, type Workspace } from "../src/workspace.ts"
import { nodeLayer, tsgoStub } from "./support.ts"

const run = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(effect.pipe(Effect.provide(nodeLayer)) as Effect.Effect<A, E, never>)

const fixture = () => loadWorkspace("testdata/containment", ["src"])

const idsOf = (
  workspace: Workspace,
  store: FactStore | undefined,
): ReadonlyArray<ReadonlyArray<string>> =>
  workspace.units.map((unit) => fragmentsOf(unit, store).ids)

const reportOf = (report: Result.Result<FactStoreReport, unknown>): FactStoreReport => {
  if (Result.isFailure(report)) throw new Error("expected a fact store report: " + report.failure)
  return report.success
}

const storeFile = (root: string): string => join(root, STORE_PATH)

test("a cold store fills, a warm store reuses, and the ids do not move", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  const store = createFactStore(root)
  const coldIds = idsOf(first, store)
  const cold = reportOf(store.close())
  expect(cold.state).toBe("cold")
  expect(cold.walked).toBe(first.units.length)
  expect(cold.reused).toBe(0)
  expect(existsSync(storeFile(root))).toBe(true)

  const second = await run(fixture())
  const warmStore = createFactStore(root)
  const warmIds = idsOf(second, warmStore)
  const warm = reportOf(warmStore.close())
  expect(warm.state).toBe("warm")
  expect(warm.walked).toBe(0)
  expect(warm.reused).toBe(second.units.length)
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
  const coldStore = createFactStore(root)
  const before = idsOf(first, coldStore)
  coldStore.close()

  const stale = storeVersionOf() === 1 ? 2 : 1
  const db = new DatabaseSync(storeFile(root))
  db.exec("PRAGMA user_version = " + String(stale))
  db.close()

  const store = createFactStore(root)
  const after = idsOf(first, store)
  const rebuilt = reportOf(store.close())
  expect(rebuilt.state).toBe("rebuilt-on-version-change")
  expect(after).toEqual(before)
})

test("a deleted database is rebuilt, and the census says so", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  const coldStore = createFactStore(root)
  const before = idsOf(first, coldStore)
  expect(reportOf(coldStore.close()).state).toBe("cold")

  rmSync(storeFile(root), { force: true })

  const store = createFactStore(root)
  const after = idsOf(first, store)
  const rebuilt = reportOf(store.close())
  expect(rebuilt.state).toBe("rebuilt")
  expect(after).toEqual(before)
})

test("a corrupt store is replaced, and the run still has its facts", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  const coldStore = createFactStore(root)
  const expected = idsOf(first, coldStore)
  coldStore.close()

  writeFileSync(storeFile(root), "this is not a SQLite database")

  const store = createFactStore(root)
  const after = idsOf(first, store)
  const recovered = reportOf(store.close())
  expect(recovered.state).toBe("rebuilt")
  expect(recovered.issue).toContain("could not be read")
  expect(after).toEqual(expected)
})

test("a check says cold, warm, then rebuilt in its census, with the same findings", async () => {
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

  const noteOf = (report: Awaited<ReturnType<typeof check>>) =>
    report.notes.find((note) => note.reason.startsWith("fragment store:"))

  const cold = await check()
  expect(noteOf(cold)?.reason).toContain("fragment store: cold")

  const warm = await check()
  expect(noteOf(warm)?.reason).toContain("fragment store: warm")
  expect(warm.diagnostics).toEqual(cold.diagnostics)

  rmSync(storeFile(root), { force: true })
  const rebuilt = await check()
  expect(noteOf(rebuilt)?.reason).toContain("fragment store: rebuilt")
  expect(rebuilt.diagnostics).toEqual(cold.diagnostics)
})

test("a row the decoder refuses is a miss, not a wrong answer", async () => {
  const root = mkdtempSync(join(tmpdir(), "joggle-store-"))
  const first = await run(fixture())
  const seeded = createFactStore(root)
  const expected = idsOf(first, seeded)
  expect(reportOf(seeded.close()).state).toBe("cold")

  // A TEXT body is not the BLOB the fragment-set query promises. The row decode
  // refuses it, so the unit is walked again instead of being read as whatever
  // the column happens to hold.
  const db = new DatabaseSync(storeFile(root))
  db.exec("UPDATE \"object\" SET body = 'not a blob' WHERE kind = 'fragment-set'")
  db.close()

  const store = createFactStore(root)
  const after = idsOf(first, store)
  const reread = reportOf(store.close())
  expect(reread.reused).toBe(0)
  expect(reread.walked).toBe(first.units.length)
  expect(after).toEqual(expected)
})
