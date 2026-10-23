import {
  decodeChit,
  decodeJob,
  decodePresence,
  decodeReceipt,
  type Chit,
  type Claim,
  type Job,
  type Presence,
  type Receipt,
} from "@autotelic/board"
import type { Sql } from "./sql.ts"

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

interface Row {
  readonly [key: string]: unknown
}

const rows = (value: unknown): ReadonlyArray<Row> =>
  Array.isArray(value) ? (value as ReadonlyArray<Row>) : []

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

export interface ClaimOutcome {
  readonly ok: boolean
  readonly epoch: number
  readonly reason?: "held"
}

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

  /* ---------------------------------------------------------------- chits */

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

  chit(id: string): Chit | undefined {
    const row = this.#sql.get<Row>("SELECT * FROM chits WHERE id = ?", id)
    return row === undefined ? undefined : toChit(row)
  }

  chits(): ReadonlyArray<Chit> {
    return this.#sql.all<Row>("SELECT * FROM chits ORDER BY updated_at DESC").flatMap((row) => {
      const chit = toChit(row)
      return chit === undefined ? [] : [chit]
    })
  }

  /* ---------------------------------------------------------------- claims */

  claim(chit: string, host: string, actor: string, ttlMs: number, now: number): ClaimOutcome {
    return this.#sql.transaction(() => {
      const current = this.#sql.get<Row>("SELECT * FROM claims WHERE chit = ?", chit)
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
      .all<Row>("SELECT * FROM claims WHERE expires_at > ? ORDER BY expires_at", now)
      .map((row) => ({
        chit: String(row.chit),
        room: String(row.room),
        host: String(row.host),
        actor: String(row.actor) as Claim["actor"],
        epoch: Number(row.epoch),
        expiresAt: Number(row.expires_at),
      }))
  }

  /* ------------------------------------------------------------------ jobs */

  /** Enqueue is idempotent by job id — the same PR head is never reviewed twice by accident. */
  enqueue(job: Job): boolean {
    return this.#sql.transaction(() => {
      const existing = this.#sql.get<Row>("SELECT id FROM jobs WHERE id = ?", job.id)
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

  claimJob(host: string, now: number): Job | undefined {
    return this.#sql.transaction(() => {
      const row = this.#sql.get<Row>(
        "SELECT * FROM jobs WHERE state = 'queued' ORDER BY created_at LIMIT 1",
      )
      if (row === undefined) return undefined
      const job = toJob(row)
      if (job === undefined) return undefined
      this.#sql.exec(
        "UPDATE jobs SET state = 'claimed', host = ?, updated_at = ? WHERE id = ?",
        host,
        now,
        job.id,
      )
      return { ...job, state: "claimed", host, updatedAt: now }
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
    return this.#sql.all<Row>("SELECT * FROM jobs ORDER BY created_at DESC").flatMap((row) => {
      const job = toJob(row)
      return job === undefined ? [] : [job]
    })
  }

  /* -------------------------------------------------------------- receipts */

  /** A delivery id is the receipt id, so a re-delivered webhook appends nothing. */
  append(receipt: Receipt): boolean {
    return this.#sql.transaction(() => {
      const existing = this.#sql.get<Row>("SELECT id FROM receipts WHERE id = ?", receipt.id)
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
      .all<Row>("SELECT * FROM receipts ORDER BY at DESC LIMIT ?", limit)
      .flatMap((row) => {
        const payload = typeof row.payload === "string" ? safeJson(row.payload) : undefined
        const receipt = decodeReceipt({
          id: row.id,
          room: row.room,
          at: row.at,
          kind: row.kind,
          chit: row.chit ?? undefined,
          job: row.job ?? undefined,
          actor: row.actor ?? undefined,
          host: row.host ?? undefined,
          payload,
        })
        return receipt === undefined ? [] : [receipt]
      })
  }

  /* -------------------------------------------------------------- presence */

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
      .all<Row>("SELECT * FROM presence WHERE at + ttl > ? ORDER BY at DESC", now)
      .flatMap((row) => {
        const presence = decodePresence({
          host: row.host,
          room: row.room,
          actor: row.actor,
          at: row.at,
          ttl: row.ttl,
          session: row.session ?? undefined,
        })
        return presence === undefined ? [] : [presence]
      })
  }

  /* ------------------------------------------------------------------ meta */

  get(key: string): string | undefined {
    const row = this.#sql.get<Row>("SELECT value FROM meta WHERE key = ?", key)
    return row === undefined ? undefined : String(row.value)
  }

  set(key: string, value: string): void {
    this.#sql.exec(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      value,
    )
  }

  counts(): { readonly chits: number; readonly jobs: number; readonly receipts: number } {
    const count = (table: string): number => {
      const row = this.#sql.get<Row>(`SELECT COUNT(*) AS n FROM ${table}`)
      return row === undefined ? 0 : Number(row.n)
    }
    return { chits: count("chits"), jobs: count("jobs"), receipts: count("receipts") }
  }
}

const safeJson = (value: string): Record<string, unknown> | undefined => {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

const toChit = (row: Row): Chit | undefined =>
  decodeChit({
    id: row.id,
    room: row.room,
    ticket: row.ticket,
    kind: row.kind,
    state: row.state,
    updatedAt: row.updated_at,
    ...(row.pr === null || row.pr === undefined
      ? {}
      : {
          anchor: {
            pr: row.pr,
            sha: row.sha,
            ...(row.path === null || row.path === undefined ? {} : { path: row.path }),
            ...(row.line === null || row.line === undefined ? {} : { line: row.line }),
            ...(row.comment_id === null || row.comment_id === undefined
              ? {}
              : { commentId: row.comment_id }),
          },
        }),
    ...(row.layer === null || row.layer === undefined ? {} : { layer: row.layer }),
  })

const toJob = (row: Row): Job | undefined =>
  decodeJob({
    id: row.id,
    room: row.room,
    kind: row.kind,
    pr: row.pr,
    sha: row.sha,
    state: row.state,
    attempts: row.attempts,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.host === null || row.host === undefined ? {} : { host: row.host }),
    ...(row.note === null || row.note === undefined ? {} : { note: row.note }),
  })

export { decodePresence, decodeReceipt }
