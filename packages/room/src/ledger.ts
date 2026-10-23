import {
  decodeChit,
  decodeJob,
  decodePresence,
  decodeReceipt,
  type Anchor,
  type Chit,
  type Claim,
  type Job,
  type Presence,
  type Receipt,
} from "@autotelic/board"
import { Option, Result } from "effect"
import type { Sql, SqlRow, SqlValue } from "./sql.ts"

/*
 * The ledger.
 *
 * One SQLite file per room, written by one host at a time. The schema is the same under
 * `node:sqlite` and a Durable Object, because `Sql` is the only thing this module knows.
 *
 * The claim table holds one row per chit. Expiry is a timestamp, not a delete: an expired
 * claim still carries its epoch, which is the fence that stops a paused process from
 * writing after someone else has taken over.
 */

const SCHEMA: ReadonlyArray<string> = [
  "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS chits (
     id TEXT PRIMARY KEY, room TEXT NOT NULL, ticket TEXT NOT NULL,
     kind TEXT NOT NULL, state TEXT NOT NULL, pr INTEGER, sha TEXT,
     path TEXT, line INTEGER, comment_id INTEGER, layer INTEGER,
     updated_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS claims (
     chit TEXT PRIMARY KEY, room TEXT NOT NULL, host TEXT NOT NULL,
     actor TEXT NOT NULL, epoch INTEGER NOT NULL, expires_at INTEGER NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS jobs (
     id TEXT PRIMARY KEY, room TEXT NOT NULL, kind TEXT NOT NULL,
     pr INTEGER NOT NULL, sha TEXT NOT NULL, state TEXT NOT NULL,
     host TEXT, attempts INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, note TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS receipts (
     id TEXT PRIMARY KEY, room TEXT NOT NULL, at INTEGER NOT NULL,
     kind TEXT NOT NULL, chit TEXT, job TEXT, actor TEXT, host TEXT, payload TEXT
   )`,
  `CREATE TABLE IF NOT EXISTS presence (
     host TEXT PRIMARY KEY, room TEXT NOT NULL, actor TEXT NOT NULL,
     at INTEGER NOT NULL, ttl INTEGER NOT NULL, session TEXT
   )`,
  "CREATE INDEX IF NOT EXISTS jobs_state ON jobs (state, created_at)",
  "CREATE INDEX IF NOT EXISTS receipts_at ON receipts (at DESC)",
]

/** What an acquisition decided. */
export interface ClaimOutcome {
  readonly ok: boolean
  readonly epoch: number
  readonly reason?: "held"
}

const nullable = (value: SqlValue | undefined): Option.Option<string> =>
  value === null || value === undefined ? Option.none() : Option.some(String(value))

const numberOrNull = (value: SqlValue | undefined): Option.Option<number> =>
  value === null || value === undefined ? Option.none() : Option.some(Number(value))

/** Build the anchor a chit row carries, or nothing when the row has no PR. */
const anchorOf = (row: SqlRow): Option.Option<Anchor> => {
  const pr = numberOrNull(row.pr)
  if (Option.isNone(pr)) return Option.none()
  return Option.some(
    Object.assign(
      { pr: pr.value, sha: row.sha === undefined || row.sha === null ? "" : String(row.sha) },
      Option.match(nullable(row.path), { onNone: () => ({}), onSome: (path) => ({ path }) }),
      Option.match(numberOrNull(row.line), { onNone: () => ({}), onSome: (line) => ({ line }) }),
      Option.match(numberOrNull(row.comment_id), {
        onNone: () => ({}),
        onSome: (commentId) => ({ commentId }),
      }),
    ),
  )
}

const toChit = (row: SqlRow): Option.Option<Chit> =>
  Option.fromUndefinedOr(
    Result.getOrUndefined(
      decodeChit(
        Object.assign(
          {
            id: String(row.id),
            room: String(row.room),
            ticket: String(row.ticket),
            kind: String(row.kind),
            state: String(row.state),
            updatedAt: Number(row.updated_at),
          },
          Option.match(anchorOf(row), {
            onNone: () => ({}),
            onSome: (anchor) => ({ anchor }),
          }),
          Option.match(numberOrNull(row.layer), {
            onNone: () => ({}),
            onSome: (layer) => ({ layer }),
          }),
        ),
      ),
    ),
  )

const toJob = (row: SqlRow): Option.Option<Job> =>
  Option.fromUndefinedOr(
    Result.getOrUndefined(
      decodeJob(
        Object.assign(
          {
            id: String(row.id),
            room: String(row.room),
            kind: String(row.kind),
            pr: Number(row.pr),
            sha: String(row.sha),
            state: String(row.state),
            attempts: Number(row.attempts),
            createdAt: Number(row.created_at),
            updatedAt: Number(row.updated_at),
          },
          Option.match(nullable(row.host), {
            onNone: () => ({}),
            onSome: (host) => ({ host }),
          }),
          Option.match(nullable(row.note), {
            onNone: () => ({}),
            onSome: (note) => ({ note }),
          }),
        ),
      ),
    ),
  )

/** The room's durable state. */
export class Ledger {
  readonly #sql: Sql
  readonly #room: string

  private constructor(sql: Sql, room: string) {
    this.#sql = sql
    this.#room = room
  }

  static open(sql: Sql, room: string): Ledger {
    const ledger = new Ledger(sql, room)
    for (const statement of SCHEMA) ledger.#sql.exec(statement)
    return ledger
  }

  get room(): string {
    return this.#room
  }

  putChit(chit: Chit): void {
    this.#sql.exec(
      `INSERT INTO chits (id, room, ticket, kind, state, pr, sha, path, line, comment_id, layer, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         state = excluded.state, pr = excluded.pr, sha = excluded.sha,
         path = excluded.path, line = excluded.line, comment_id = excluded.comment_id,
         layer = excluded.layer, updated_at = excluded.updated_at`,
      chit.id,
      chit.room,
      chit.ticket,
      chit.kind,
      chit.state,
      chit.anchor?.pr ?? null,
      chit.anchor?.sha ?? null,
      chit.anchor?.path ?? null,
      chit.anchor?.line ?? null,
      chit.anchor?.commentId ?? null,
      chit.layer ?? null,
      chit.updatedAt,
    )
  }

  /** One chit, or the reason it is absent. */
  chit(id: string): Result.Result<Chit, string> {
    const row = this.#sql.get<SqlRow>("SELECT * FROM chits WHERE id = ?", id)
    if (row === undefined) return Result.fail("no such chit")
    const chit = toChit(row)
    return Option.isNone(chit)
      ? Result.fail("the chit row does not decode")
      : Result.succeed(chit.value)
  }

  chits(): ReadonlyArray<Chit> {
    return this.#sql.all<SqlRow>("SELECT * FROM chits ORDER BY updated_at DESC").flatMap((row) =>
      Option.match(toChit(row), {
        onNone: () => [],
        onSome: (chit) => [chit],
      }),
    )
  }

  claim(chit: string, host: string, actor: string, ttlMs: number, now: number): ClaimOutcome {
    return this.#sql.transaction(() => {
      const current = this.#sql.get<SqlRow>("SELECT * FROM claims WHERE chit = ?", chit)
      if (current !== undefined) {
        const holder = String(current.host)
        const expiresAt = Number(current.expires_at)
        if (holder !== host && expiresAt > now) {
          return { ok: false, epoch: Number(current.epoch), reason: "held" as const }
        }
      }
      const epoch = (current === undefined ? 0 : Number(current.epoch)) + 1
      this.#sql.exec(
        `INSERT INTO claims (chit, room, host, actor, epoch, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(chit) DO UPDATE SET
           host = excluded.host, actor = excluded.actor,
           epoch = excluded.epoch, expires_at = excluded.expires_at`,
        chit,
        this.#room,
        host,
        actor,
        epoch,
        now + ttlMs,
      )
      return { ok: true, epoch }
    })
  }

  release(chit: string, host: string): void {
    this.#sql.exec("DELETE FROM claims WHERE chit = ? AND host = ?", chit, host)
  }

  claims(now: number): ReadonlyArray<Claim> {
    return this.#sql
      .all<SqlRow>("SELECT * FROM claims WHERE expires_at > ? ORDER BY expires_at", now)
      .map((row) => ({
        chit: String(row.chit),
        room: String(row.room),
        host: String(row.host),
        actor: String(row.actor),
        epoch: Number(row.epoch),
        expiresAt: Number(row.expires_at),
      }))
  }

  /** Enqueue is idempotent by job id — the same PR head is never reviewed twice by accident. */
  enqueue(job: Job): boolean {
    return this.#sql.transaction(() => {
      const existing = this.#sql.get<SqlRow>("SELECT id FROM jobs WHERE id = ?", job.id)
      if (existing !== undefined) return false
      this.#sql.exec(
        `INSERT INTO jobs (id, room, kind, pr, sha, state, host, attempts, created_at, updated_at, note)
         VALUES (?, ?, ?, ?, ?, 'queued', NULL, 0, ?, ?, NULL)`,
        job.id,
        job.room,
        job.kind,
        job.pr,
        job.sha,
        job.createdAt,
        job.updatedAt,
      )
      return true
    })
  }

  /** The next queued job, claimed by this host. */
  claimJob(host: string, now: number): Result.Result<Job, string> {
    return this.#sql.transaction(() => {
      const row = this.#sql.get<SqlRow>(
        "SELECT * FROM jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1",
      )
      if (row === undefined) return Result.fail("no queued job")
      const job = toJob(row)
      if (Option.isNone(job)) return Result.fail("the job row does not decode")
      this.#sql.exec(
        "UPDATE jobs SET state = 'claimed', host = ?, updated_at = ? WHERE id = ?",
        host,
        now,
        job.value.id,
      )
      return Result.succeed({ ...job.value, state: "claimed" as const, host, updatedAt: now })
    })
  }

  startJob(id: string, now: number): void {
    this.#sql.exec(
      "UPDATE jobs SET state = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?",
      now,
      id,
    )
  }

  finishJob(id: string, state: Job["state"], note: string | undefined, now: number): void {
    this.#sql.exec(
      "UPDATE jobs SET state = ?, note = ?, updated_at = ? WHERE id = ?",
      state,
      note ?? null,
      now,
      id,
    )
  }

  jobs(): ReadonlyArray<Job> {
    return this.#sql
      .all<SqlRow>("SELECT * FROM jobs ORDER BY created_at DESC")
      .flatMap((row) => Option.match(toJob(row), { onNone: () => [], onSome: (job) => [job] }))
  }

  /** A delivery id is the receipt id, so a re-delivered webhook appends nothing. */
  append(receipt: Receipt): boolean {
    return this.#sql.transaction(() => {
      const existing = this.#sql.get<SqlRow>("SELECT id FROM receipts WHERE id = ?", receipt.id)
      if (existing !== undefined) return false
      this.#sql.exec(
        `INSERT INTO receipts (id, room, at, kind, chit, job, actor, host, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        receipt.id,
        receipt.room,
        receipt.at,
        receipt.kind,
        receipt.chit ?? null,
        receipt.job ?? null,
        receipt.actor ?? null,
        receipt.host ?? null,
        receipt.payload === undefined ? null : JSON.stringify(receipt.payload),
      )
      return true
    })
  }

  receipts(limit = 50): ReadonlyArray<Receipt> {
    return this.#sql
      .all<SqlRow>("SELECT * FROM receipts ORDER BY at DESC LIMIT ?", limit)
      .flatMap((row) => {
        const base = Object.assign(
          {
            id: String(row.id),
            room: String(row.room),
            at: Number(row.at),
            kind: String(row.kind),
          },
          Option.match(nullable(row.chit), { onNone: () => ({}), onSome: (chit) => ({ chit }) }),
          Option.match(nullable(row.job), { onNone: () => ({}), onSome: (job) => ({ job }) }),
          Option.match(nullable(row.actor), { onNone: () => ({}), onSome: (actor) => ({ actor }) }),
          Option.match(nullable(row.host), { onNone: () => ({}), onSome: (host) => ({ host }) }),
        )
        return Option.match(Option.fromUndefinedOr(Result.getOrUndefined(decodeReceipt(base))), {
          onNone: () => [],
          onSome: (receipt) => [receipt],
        })
      })
  }

  beat(presence: Presence): void {
    this.#sql.exec(
      `INSERT INTO presence (host, room, actor, at, ttl, session)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(host) DO UPDATE SET
         room = excluded.room, actor = excluded.actor,
         at = excluded.at, ttl = excluded.ttl, session = excluded.session`,
      presence.host,
      presence.room,
      presence.actor,
      presence.at,
      presence.ttl,
      presence.session ?? null,
    )
  }

  presences(now: number): ReadonlyArray<Presence> {
    return this.#sql
      .all<SqlRow>("SELECT * FROM presence WHERE at + ttl > ? ORDER BY at DESC", now)
      .flatMap((row) => {
        const base = Object.assign(
          {
            host: String(row.host),
            room: String(row.room),
            actor: String(row.actor),
            at: Number(row.at),
            ttl: Number(row.ttl),
          },
          Option.match(nullable(row.session), {
            onNone: () => ({}),
            onSome: (session) => ({ session }),
          }),
        )
        return Option.match(Option.fromUndefinedOr(Result.getOrUndefined(decodePresence(base))), {
          onNone: () => [],
          onSome: (presence) => [presence],
        })
      })
  }

  /** A meta value, or absence. */
  get(key: string): Result.Result<string, string> {
    const row = this.#sql.get<SqlRow>("SELECT value FROM meta WHERE key = ?", key)
    return row === undefined ? Result.fail("unset") : Result.succeed(String(row.value))
  }

  set(key: string, value: string): void {
    this.#sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    )
  }

  chitStates() {
    return this.#sql
      .all<SqlRow>("SELECT state, COUNT(*) AS n FROM chits GROUP BY state ORDER BY state")
      .map((row) => ({ state: String(row.state), count: Number(row.n) }))
  }

  counts() {
    const count = (row: SqlRow | undefined): number => (row === undefined ? 0 : Number(row.n))
    const chits = this.#sql.get<SqlRow>("SELECT COUNT(*) AS n FROM chits")
    const jobs = this.#sql.get<SqlRow>("SELECT COUNT(*) AS n FROM jobs")
    const receipts = this.#sql.get<SqlRow>("SELECT COUNT(*) AS n FROM receipts")
    return { chits: count(chits), jobs: count(jobs), receipts: count(receipts) }
  }
}
