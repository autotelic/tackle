import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { HASH_VERSION } from "./identity.ts"
import { shortHash } from "./state.ts"
import { langOf, type Unit } from "./workspace.ts"

/*
 * The fact store: what a run derives, kept where a cache belongs.
 *
 * Judgements are decisions and stay in `.joggle/answers` as text, because a
 * reviewer has to read a verdict change and two branches have to merge one.
 * Facts -- fragment ids, document frequency, the dependency surface -- are
 * derived from the tree, so they are not reviewed and must not be committed.
 * They live in one machine-local SQLite file instead.
 *
 * The file is disposable. A corrupt one is replaced rather than repaired, and a
 * missing one is a cold run rather than a failure. What it must never do is make
 * a run look clean: a store that cannot be read is reported in the census, not
 * silently treated as an empty repository.
 */

/** Where the store lives, relative to the analysed root. */
export const STORE_PATH = ".joggle/cache/store.sqlite"

/** The schema this build writes. Part of the version, beside {@link HASH_VERSION}. */
export const STORE_SCHEMA = "1"

const STORE_FILE = (root: string): string => join(root, STORE_PATH)

/**
 * `PRAGMA user_version` is one 32-bit integer, so the identity hash and the
 * schema number are folded together rather than stored side by side. Any change
 * to either changes this number, which turns a normaliser change into a rebuild
 * instead of a silent re-read of ids with different meaning.
 */
export const storeVersionOf = (identity: string = HASH_VERSION): number => {
  const digest = createHash("sha256")
    .update(identity + "\u0000" + STORE_SCHEMA)
    .digest()
  // Zero is SQLite's "never written" value, so it must not be a valid version.
  return digest.readUInt32BE(0) & 0x7fffffff || 1
}

const TABLES = ["object", "fragment", "df", "surface"] as const

const SCHEMA = `
CREATE TABLE IF NOT EXISTS "object" (
  id BLOB PRIMARY KEY,
  kind TEXT NOT NULL,
  body BLOB NOT NULL
);
CREATE TABLE IF NOT EXISTS fragment (
  id BLOB,
  unit TEXT NOT NULL,
  PRIMARY KEY (id, unit)
);
CREATE INDEX IF NOT EXISTS fragment_unit ON fragment (unit);
CREATE TABLE IF NOT EXISTS df (
  id BLOB PRIMARY KEY,
  units INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS surface (
  package TEXT NOT NULL,
  name TEXT NOT NULL,
  module TEXT NOT NULL,
  signature TEXT NOT NULL,
  doc TEXT
);
`

export type FactStoreState = "cold" | "warm" | "rebuilt-on-version-change"

export interface FactStoreReport {
  readonly state: FactStoreState
  /** Fragment sets served from the store. */
  readonly reused: number
  /** Fragment sets walked and written this run. */
  readonly walked: number
  /** Fragment sets the store held when the run opened it. */
  readonly units: number
  /** Why a damaged store was replaced, when it was. */
  readonly issue: string | undefined
}

interface ActiveStore {
  readonly root: string
  readonly file: string
  db: DatabaseSync | undefined
  state: FactStoreState
  issue: string | undefined
  units: number
  reused: number
  walked: number
}

let active: ActiveStore | undefined

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

const userVersionOf = (db: DatabaseSync): number => {
  const row = db.prepare("PRAGMA user_version").get() as { user_version?: number } | undefined
  return Number(row?.user_version ?? 0)
}

const hasSchema = (db: DatabaseSync): boolean => {
  const rows = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as ReadonlyArray<{ name?: string }>
  const names = new Set(rows.map((row) => row.name))
  return TABLES.every((table) => names.has(table))
}

const fragmentSetsOf = (db: DatabaseSync): number => {
  const row = db
    .prepare("SELECT COUNT(*) AS count FROM \"object\" WHERE kind = 'fragment-set'")
    .get() as { count?: number } | undefined
  return Number(row?.count ?? 0)
}

const configure = (db: DatabaseSync): void => {
  db.exec("PRAGMA busy_timeout = 5000")
  // WAL so a reader does not block a writer; the file is a cache, not a
  // checkpoint anyone needs from another process.
  db.exec("PRAGMA journal_mode = WAL")
  db.exec("PRAGMA synchronous = NORMAL")
}

const createSchema = (db: DatabaseSync, version: number): void => {
  for (const table of TABLES) db.exec('DROP TABLE IF EXISTS "' + table + '"')
  db.exec(SCHEMA)
  db.exec("PRAGMA user_version = " + String(version))
}

const removeDatabase = (file: string): void => {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      rmSync(file + suffix, { force: true })
    } catch {
      // A file that cannot be removed is still not a reason to fail the run.
    }
  }
}

/** Open the file, replacing it when SQLite says it is not a database. */
const openFile = (
  file: string,
  version: number,
): { db: DatabaseSync; state: FactStoreState; issue: string | undefined } => {
  mkdirSync(dirname(file), { recursive: true })
  const existed = existsSync(file)
  let db: DatabaseSync | undefined
  try {
    db = new DatabaseSync(file)
    configure(db)
    const current = userVersionOf(db)
    const complete = hasSchema(db)
    if (current === version && complete) {
      return {
        db,
        state: fragmentSetsOf(db) === 0 ? "cold" : "warm",
        issue: undefined,
      }
    }
    // A version mismatch or a half-written schema is a migration, not a cache
    // hit: ids from another normaliser do not mean the same thing.
    const rebuilt = existed && (current !== 0 || complete)
    createSchema(db, version)
    return {
      db,
      state: rebuilt ? "rebuilt-on-version-change" : "cold",
      issue: undefined,
    }
  } catch (cause) {
    try {
      db?.close()
    } catch {
      // Already unusable.
    }
    // A corrupt file is replaced whole. Its contents were derived, and a partial
    // read would be a wrong answer rather than a slow one.
    removeDatabase(file)
    const issue = "the fact store could not be read and was replaced: " + messageOf(cause)
    try {
      const fresh = new DatabaseSync(file)
      configure(fresh)
      createSchema(fresh, version)
      return { db: fresh, state: "cold", issue }
    } catch {
      // An unreadable directory is not a failed run. The in-memory store keeps
      // every fact this run's rules need, and the census says it was not kept.
      const memory = new DatabaseSync(":memory:")
      configure(memory)
      createSchema(memory, version)
      return { db: memory, state: "cold", issue }
    }
  }
}

/**
 * Point the fragment index at one project root.
 *
 * Called by a run before its rules execute. Tests and library callers that never
 * call it keep the pure `fragmentsOf` behaviour: compute, no disk.
 */
export const useFactStore = (root: string): void => {
  closeFactStore()
  // Deliberately lazy: a run whose rules never ask for a fragment set does not
  // create the file, exactly as the parse cache is only written when it parsed.
  active = {
    root,
    file: STORE_FILE(root),
    db: undefined,
    state: "cold",
    issue: undefined,
    units: 0,
    reused: 0,
    walked: 0,
  }
}

const ensureStore = (): ActiveStore | undefined => {
  const current = active
  if (current === undefined) return undefined
  if (current.db === undefined) {
    const opened = openFile(current.file, storeVersionOf())
    current.db = opened.db
    current.state = opened.state
    current.issue = opened.issue
    current.units = fragmentSetsOf(opened.db)
  }
  return current
}

/**
 * Close the store and say which kind of run this was.
 *
 * Returns undefined when no fragment was ever requested, so a run of rules that
 * do not read fragments does not claim a cache it never opened.
 */
export const closeFactStore = (): FactStoreReport | undefined => {
  const current = active
  if (current === undefined) return undefined
  active = undefined
  if (current.db === undefined) return undefined
  const report: FactStoreReport = {
    state: current.state,
    reused: current.reused,
    walked: current.walked,
    units: current.units,
    issue: current.issue,
  }
  try {
    current.db.close()
  } catch {
    // The answer was already read; a close failure is not a report failure.
  }
  return report
}

/**
 * A unit's cache key: its language and text.
 *
 * The fragment set is a function of exactly those two things (the normaliser
 * version rides in the store's `user_version`), so a changed declaration is a
 * miss and an unchanged one never walks its tree again.
 */
export const unitKeyOf = (unit: Unit): string => shortHash(langOf(unit.file) + "\u0000" + unit.text)

export interface StoredFragments {
  readonly ids: ReadonlyArray<string>
  readonly cut: boolean
}

const idBytes = (id: string): Uint8Array => Buffer.from(id, "utf8")
const textOf = (value: unknown): string =>
  value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value)

/** The fragment set already stored for this unit, or undefined on a miss. */
export const cachedFragmentsOf = (unit: Unit): StoredFragments | undefined => {
  const current = ensureStore()
  if (current === undefined || current.db === undefined) return undefined
  const key = unitKeyOf(unit)
  try {
    const row = current.db
      .prepare('SELECT body FROM "object" WHERE id = ? AND kind = ?')
      .get(idBytes(key), "fragment-set") as { body?: Uint8Array } | undefined
    if (row === undefined) {
      return undefined
    }
    const body = JSON.parse(textOf(row.body)) as { cut?: unknown }
    const ids = (
      current.db
        .prepare("SELECT id FROM fragment WHERE unit = ? ORDER BY rowid")
        .all(key) as ReadonlyArray<{ id?: Uint8Array }>
    ).map((entry) => textOf(entry.id))
    current.reused += 1
    return { ids, cut: body.cut === true }
  } catch (cause) {
    // A row this build cannot read is a miss, not a failed run. The walk that
    // follows counts it once, in `storeFragmentsOf`.
    current.issue ??= "a stored fragment set could not be read: " + messageOf(cause)
    return undefined
  }
}

/** Write one unit's fragment set, and keep the document-frequency table truthful. */
export const storeFragmentsOf = (unit: Unit, fragments: StoredFragments): void => {
  const current = ensureStore()
  if (current === undefined || current.db === undefined) return
  const key = unitKeyOf(unit)
  const db = current.db
  try {
    db.exec("BEGIN IMMEDIATE")
    const before = db.prepare("SELECT id FROM fragment WHERE unit = ?").all(key) as ReadonlyArray<{
      id?: Uint8Array
    }>
    const existed =
      db
        .prepare('SELECT 1 AS present FROM "object" WHERE id = ? AND kind = ?')
        .get(idBytes(key), "fragment-set") !== undefined
    const decrement = db.prepare("UPDATE df SET units = units - 1 WHERE id = ?")
    const prune = db.prepare("DELETE FROM df WHERE id = ? AND units <= 0")
    for (const entry of before) {
      const id = idBytes(textOf(entry.id))
      decrement.run(id)
      prune.run(id)
    }
    db.prepare("DELETE FROM fragment WHERE unit = ?").run(key)
    db.prepare('INSERT OR REPLACE INTO "object" (id, kind, body) VALUES (?, ?, ?)').run(
      idBytes(key),
      "fragment-set",
      Buffer.from(JSON.stringify({ cut: fragments.cut }), "utf8"),
    )
    const insert = db.prepare("INSERT OR IGNORE INTO fragment (id, unit) VALUES (?, ?)")
    const count = db.prepare(
      "INSERT INTO df (id, units) VALUES (?, 1) ON CONFLICT(id) DO UPDATE SET units = units + 1",
    )
    for (const id of fragments.ids) {
      insert.run(idBytes(id), key)
      count.run(idBytes(id))
    }
    db.exec("COMMIT")
    if (!existed) current.units += 1
    current.walked += 1
  } catch (cause) {
    try {
      db.exec("ROLLBACK")
    } catch {
      // No transaction to roll back.
    }
    current.issue ??= "a fragment set could not be written: " + messageOf(cause)
    current.walked += 1
  }
}

/** The store's document frequency, keyed by fragment id. */
export const storedFrequency = (): ReadonlyMap<string, number> => {
  const current = ensureStore()
  if (current === undefined || current.db === undefined) return new Map()
  try {
    const rows = current.db.prepare("SELECT id, units FROM df").all() as ReadonlyArray<{
      id?: Uint8Array
      units?: number
    }>
    return new Map(rows.map((row) => [textOf(row.id), Number(row.units ?? 0)]))
  } catch (cause) {
    current.issue ??= "the document frequency table could not be read: " + messageOf(cause)
    return new Map()
  }
}
