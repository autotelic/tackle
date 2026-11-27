import { createHash } from "node:crypto"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { Result, Schema, SchemaParser } from "effect"
import { HASH_VERSION } from "./identity.ts"
import { shortHash } from "./state.ts"
import { langOf, type Unit } from "./workspace.ts"

/*
 * The fact store: what a run derives, kept where a cache belongs.
 *
 * Judgements are decisions and stay in `.joggle/answers` as text, because a
 * reviewer has to read a verdict change and two branches have to merge one.
 * Facts -- fragment ids and whether a unit's set was cut -- are derived from the
 * tree, so they are not reviewed and must not be committed.
 * They live in one machine-local SQLite file instead.
 *
 * The file is disposable. A corrupt one is replaced rather than repaired, and a
 * missing one is a cold run rather than a failure. What it must never do is make
 * a run look clean: a store that cannot be read is reported in the census, not
 * silently treated as an empty repository.
 */

/** Where the store lives, relative to the analysed root. */
export const STORE_PATH = ".joggle/cache/store.sqlite"

/**
 * Evidence that this machine had a store before the database disappeared.
 *
 * Without it, deleting the database is indistinguishable from the first run and
 * the census would call both "cold". The marker survives `rm store.sqlite` but
 * not `rm -rf .joggle/cache`, which is exactly the line between a rebuild and a
 * genuinely cold machine.
 */
const STORE_MARKER = ".joggle/cache/store.seen"

/** The schema this build writes. Part of the version, beside {@link HASH_VERSION}. */
const STORE_SCHEMA = "3"

const STORE_FILE = (root: string): string => join(root, STORE_PATH)
const STORE_MARK = (root: string): string => join(root, STORE_MARKER)

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

const TABLES = ["object", "fragment", "finding"] as const

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
CREATE TABLE IF NOT EXISTS finding (
  site TEXT NOT NULL,
  rule TEXT NOT NULL,
  remedy_hash TEXT NOT NULL,
  run TEXT NOT NULL,
  PRIMARY KEY (site, rule, run)
);
CREATE INDEX IF NOT EXISTS finding_run ON finding (run);
CREATE INDEX IF NOT EXISTS finding_remedy ON finding (remedy_hash);
`

export type FactStoreState = "cold" | "warm" | "rebuilt" | "rebuilt-on-version-change"

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

/**
 * Why a store lookup did not produce a value.
 *
 * A cache miss is `Rejected` rather than an empty success: the caller asked for a
 * fact this store does not have, and the next step is to derive it. The other
 * reasons name the boundary that refused -- a corrupt file (`Unreadable`), a
 * schema from another normaliser (`WrongVersion`), a path that is not a directory
 * (`NotADirectory`), or a write the database declined (`Rejected`).
 */
export const StoreErrorReason = Schema.Literals([
  "Unreadable",
  "WrongVersion",
  "NotADirectory",
  "Rejected",
])

export class StoreError extends Schema.TaggedError<
  StoreError,
  { readonly brand: unique symbol }
>()("joggle/StoreError", {
  reason: StoreErrorReason,
  detail: Schema.String,
}) {}

/**
 * One run's handle on the store.
 *
 * A handle, not a module singleton: the state that varies (open database, counts,
 * state, issue) belongs to the run that owns it. Two callers can hold two stores,
 * and a test never has to tear down global state left by another test.
 */
export interface StoredFinding {
  /** `file:line`, the place the finding is about. */
  readonly site: string
  readonly rule: string
  readonly remedyHash: string
  readonly run: string
}

export interface FactStore {
  /** The fragment set already stored for this unit, or the reason there is none. */
  readonly cached: (unit: Unit) => Result.Result<FragmentSet, StoreError>
  /** Write one unit's fragment set. */
  readonly store: (unit: Unit, fragments: FragmentSet) => void
  /** The findings one remedies run recorded. */
  readonly findingsOf: (run: string) => ReadonlyArray<StoredFinding>
  /** Replace the findings for this run, atomically. Returns the rows written. */
  readonly rememberFindings: (
    run: string,
    findings: ReadonlyArray<Omit<StoredFinding, "run">>,
  ) => number
  /** Close the store and say which kind of run this was, or why it never opened. */
  readonly close: () => Result.Result<FactStoreReport, StoreError>
}

interface OpenedStore {
  readonly db: DatabaseSync
  readonly state: FactStoreState
  readonly issue: string | undefined
}

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause)

/**
 * The columns `node:sqlite` hands back, spelled as the driver spells them.
 *
 * Every reader takes this union rather than narrowing its own argument, so the
 * one place that reads a driver representation is {@link textOf}.
 */
type Column = string | number | bigint | Uint8Array | null | undefined

/** One row, as the driver returns it. */
type ColumnRow = Readonly<Record<string, Column>>

/*
 * The row shapes this store reads. A decode at the boundary says what the query
 * promises; a hand-rolled predicate only says what today's rows happen to look
 * like. A mismatch is a miss, which is what a cache should do when its contract
 * does not hold.
 */
const UserVersionRow = Schema.Struct({ user_version: Schema.optional(Schema.Number) })
const CountRow = Schema.Struct({ count: Schema.optional(Schema.Number) })
const NameRow = Schema.Struct({ name: Schema.optional(Schema.String) })
const BodyRow = Schema.Struct({ body: Schema.optional(Schema.Uint8Array) })
const IdRow = Schema.Struct({ id: Schema.optional(Schema.Uint8Array) })
const FindingRow = Schema.Struct({
  site: Schema.optional(Schema.String),
  rule: Schema.optional(Schema.String),
  remedy_hash: Schema.optional(Schema.String),
  run: Schema.optional(Schema.String),
})

/** The JSON the store writes into `object.body` for a fragment set. */
const FragmentSetBody = Schema.Struct({ cut: Schema.optional(Schema.Boolean) })

/** Decode one row, or `undefined` when it is not the shape the query promised. */
function decodeRow<S extends Schema.ConstraintDecoder<unknown>>(
  schema: S,
  row: ColumnRow | undefined,
): S["Type"] | undefined {
  if (row === undefined) return undefined
  const decoded = SchemaParser.decodeResult(schema)(row)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

const userVersionOf = (db: DatabaseSync): number => {
  const row = decodeRow(UserVersionRow, db.prepare("PRAGMA user_version").get())
  return Number(row?.user_version ?? 0)
}

const hasSchema = (db: DatabaseSync): boolean => {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const names = new Set(
    rows.flatMap((row) => {
      const name = decodeRow(NameRow, row)?.name
      return name === undefined ? [] : [name]
    }),
  )
  return TABLES.every((table) => names.has(table))
}

const fragmentSetsOf = (db: DatabaseSync): number => {
  const row = decodeRow(
    CountRow,
    db.prepare("SELECT COUNT(*) AS count FROM \"object\" WHERE kind = 'fragment-set'").get(),
  )
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
    // SAFETY: `rmSync` throws for a permissions or handle problem; a cache file
    // that cannot be removed is still not a reason to fail the run.
    try {
      rmSync(file + suffix, { force: true })
    } catch {
      // A file that cannot be removed is still not a reason to fail the run.
    }
  }
}

const rememberStore = (marker: string): void => {
  // SAFETY: a marker is evidence, not correctness. Losing the write makes the
  // next run report cold instead of rebuilt, never a false cache hit.
  try {
    writeFileSync(marker, "")
  } catch {
    // An unwritable cache directory degrades to a cold report.
  }
}

/** Open the file, replacing it when SQLite says it is not a database. */
const openFile = (input: {
  readonly file: string
  readonly marker: string
  readonly version: number
}): OpenedStore => {
  const { file, marker, version } = input
  mkdirSync(dirname(file), { recursive: true })
  const existed = existsSync(file)
  const known = existsSync(marker)
  let db: DatabaseSync | undefined
  // SAFETY: `node:sqlite`'s `DatabaseSync` and PRAGMA statements throw for an
  // unreadable or corrupt file. This function is the integration boundary that
  // turns those throws into a replaced store or an in-memory one.
  try {
    db = new DatabaseSync(file)
    configure(db)
    const current = userVersionOf(db)
    const complete = hasSchema(db)
    if (current === version && complete) {
      rememberStore(marker)
      return {
        db,
        state: fragmentSetsOf(db) === 0 ? "cold" : "warm",
        issue: undefined,
      }
    }
    // A version mismatch or a half-written schema is a migration, not a cache
    // hit: ids from another normaliser do not mean the same thing.
    const changedVersion = existed && (current !== 0 || complete)
    createSchema(db, version)
    rememberStore(marker)
    return {
      db,
      state: changedVersion ? "rebuilt-on-version-change" : known ? "rebuilt" : "cold",
      issue: undefined,
    }
  } catch (cause) {
    // SAFETY: closing a handle that just failed to open is another `node:sqlite`
    // boundary; it may throw the same error again.
    try {
      db?.close()
    } catch {
      // Already unusable.
    }
    // A corrupt file is replaced whole. Its contents were derived, and a partial
    // read would be a wrong answer rather than a slow one.
    removeDatabase(file)
    const issue = "the fact store could not be read and was replaced: " + messageOf(cause)
    const state: FactStoreState = known ? "rebuilt" : "cold"
    // SAFETY: the replacement is the same `node:sqlite` boundary; a directory
    // that still refuses a database falls through to the in-memory store below.
    try {
      const fresh = new DatabaseSync(file)
      configure(fresh)
      createSchema(fresh, version)
      rememberStore(marker)
      return { db: fresh, state, issue }
    } catch {
      // An unreadable directory is not a failed run. The in-memory store keeps
      // every fact this run's rules need, and the census says it was not kept.
      const memory = new DatabaseSync(":memory:")
      configure(memory)
      createSchema(memory, version)
      return { db: memory, state, issue }
    }
  }
}

/**
 * A unit's cache key: its language and text.
 *
 * The fragment set is a function of exactly those two things (the normaliser
 * version rides in the store's `user_version`), so a changed declaration is a
 * miss and an unchanged one never walks its tree again.
 */
const unitKeyOf = (unit: Unit): string => shortHash(langOf(unit.file) + "\u0000" + unit.text)

export interface FragmentSet {
  /** Deduplicated subtree ids, in the order the code first presents them. */
  readonly ids: ReadonlyArray<string>
  /** True when the policy bound cut the set, so a caller never reads it as complete. */
  readonly cut: boolean
}

const idBytes = (id: string): Uint8Array => Buffer.from(id, "utf8")
const textOf = (value: Column): string =>
  value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : String(value)

/**
 * Point one run at one project root.
 *
 * The database is opened lazily: a run whose rules never ask for a fragment set
 * does not create the file, exactly as the parse cache is only written when it
 * parsed.
 */
export const createFactStore = (root: string): FactStore => {
  const file = STORE_FILE(root)
  const marker = STORE_MARK(root)
  let db: DatabaseSync | undefined
  let state: FactStoreState = "cold"
  let issue: string | undefined
  let units = 0
  let reused = 0
  let walked = 0

  const ensure = (): DatabaseSync => {
    if (db !== undefined) return db
    const opened = openFile({ file, marker, version: storeVersionOf() })
    db = opened.db
    state = opened.state
    issue = opened.issue
    units = fragmentSetsOf(opened.db)
    return opened.db
  }

  const cached = (unit: Unit): Result.Result<FragmentSet, StoreError> => {
    const database = ensure()
    const key = unitKeyOf(unit)
    // SAFETY: reading a cache through `node:sqlite` throws for a row or schema
    // this build cannot decode; a miss is the correct degradation.
    try {
      const row = decodeRow(
        BodyRow,
        database
          .prepare('SELECT body FROM "object" WHERE id = ? AND kind = ?')
          .get(idBytes(key), "fragment-set"),
      )
      if (row?.body === undefined) {
        return Result.fail(
          StoreError.make({ reason: "Rejected", detail: "no stored fragment set for " + key }),
        )
      }
      const body = SchemaParser.decodeResult(
        Schema.fromJsonString(FragmentSetBody),
      )(textOf(row.body))
      const ids = database
        .prepare("SELECT id FROM fragment WHERE unit = ? ORDER BY rowid")
        .all(key)
        .flatMap((entry) => {
          const id = decodeRow(IdRow, entry)?.id
          return id === undefined ? [] : [textOf(id)]
        })
      if (Result.isFailure(body)) {
        const detail = "a stored fragment set did not decode"
        issue ??= detail
        return Result.fail(StoreError.make({ reason: "Unreadable", detail }))
      }
      reused += 1
      return Result.succeed({ ids, cut: body.success.cut === true })
    } catch (cause) {
      // A row this build cannot read is a miss, not a failed run. The walk that
      // follows counts it once, in `store`.
      const detail = messageOf(cause)
      issue ??= "a stored fragment set could not be read: " + detail
      return Result.fail(StoreError.make({ reason: "Unreadable", detail }))
    }
  }

  const storeFragments = (unit: Unit, fragments: FragmentSet): void => {
    const database = ensure()
    const key = unitKeyOf(unit)
    // SAFETY: writing through `node:sqlite` throws on a locked or corrupt file;
    // the walk that produced these facts already succeeded, so the run keeps the
    // facts and reports that they were not stored.
    try {
      database.exec("BEGIN IMMEDIATE")
      const existed =
        database
          .prepare('SELECT 1 AS present FROM "object" WHERE id = ? AND kind = ?')
          .get(idBytes(key), "fragment-set") !== undefined
      database.prepare("DELETE FROM fragment WHERE unit = ?").run(key)
      database
        .prepare('INSERT OR REPLACE INTO "object" (id, kind, body) VALUES (?, ?, ?)')
        .run(
          idBytes(key),
          "fragment-set",
          Buffer.from(JSON.stringify({ cut: fragments.cut }), "utf8"),
        )
      const insert = database.prepare("INSERT OR IGNORE INTO fragment (id, unit) VALUES (?, ?)")
      for (const id of fragments.ids) insert.run(idBytes(id), key)
      database.exec("COMMIT")
      if (!existed) units += 1
      walked += 1
    } catch (cause) {
      // SAFETY: rolling back a transaction that already failed is the same
      // `node:sqlite` boundary and may throw because there is nothing to roll back.
      try {
        database.exec("ROLLBACK")
      } catch {
        // No transaction to roll back.
      }
      issue ??= "a fragment set could not be written: " + messageOf(cause)
      walked += 1
    }
  }

  const findingsOf = (run: string): ReadonlyArray<StoredFinding> => {
    const database = ensure()
    // SAFETY: reading through `node:sqlite` throws for a schema this build cannot
    // read; an empty answer is the same degradation as a cold store.
    try {
      return database
        .prepare(
          "SELECT site, rule, remedy_hash, run FROM finding WHERE run = ? ORDER BY site, rule",
        )
        .all(run)
        .flatMap((row) => {
          const decoded = decodeRow(FindingRow, row)
          if (
            decoded?.site === undefined ||
            decoded.rule === undefined ||
            decoded.remedy_hash === undefined ||
            decoded.run === undefined
          ) {
            return []
          }
          return [
            {
              site: decoded.site,
              rule: decoded.rule,
              remedyHash: decoded.remedy_hash,
              run: decoded.run,
            },
          ]
        })
    } catch (cause) {
      issue ??= "stored findings could not be read: " + messageOf(cause)
      return []
    }
  }

  const rememberFindings = (
    run: string,
    findings: ReadonlyArray<Omit<StoredFinding, "run">>,
  ): number => {
    const database = ensure()
    // SAFETY: writing through `node:sqlite` throws on a locked or corrupt file;
    // the caller already has the report, so a failed write is a cache miss, not
    // a failed remedies run.
    try {
      database.exec("BEGIN IMMEDIATE")
      database.prepare("DELETE FROM finding WHERE run = ?").run(run)
      const insert = database.prepare(
        "INSERT OR REPLACE INTO finding (site, rule, remedy_hash, run) VALUES (?, ?, ?, ?)",
      )
      for (const finding of findings) {
        insert.run(finding.site, finding.rule, finding.remedyHash, run)
      }
      database.exec("COMMIT")
      return findings.length
    } catch (cause) {
      // SAFETY: rolling back a transaction that already failed is the same
      // `node:sqlite` boundary and may throw because there is nothing to roll back.
      try {
        database.exec("ROLLBACK")
      } catch {
        // No transaction to roll back.
      }
      issue ??= "findings could not be written: " + messageOf(cause)
      return 0
    }
  }

  const close = (): Result.Result<FactStoreReport, StoreError> => {
    const current = db
    if (current === undefined) {
      return Result.fail(
        StoreError.make({
          reason: "Rejected",
          detail: "the fact store was never opened by this run",
        }),
      )
    }
    db = undefined
    const report: FactStoreReport = { state, reused, walked, units, issue }
    // SAFETY: closing a `node:sqlite` handle throws if it is already unusable;
    // the answer was already read, and a close failure is not a report failure.
    try {
      current.close()
    } catch {
      // The answer was already read; a close failure is not a report failure.
    }
    return Result.succeed(report)
  }

  return { cached, store: storeFragments, findingsOf, rememberFindings, close }
}
