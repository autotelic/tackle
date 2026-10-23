/*
 * The SQL seam.
 *
 * The ledger is the same SQL in two hosts: `node:sqlite` on a laptop, and the Durable
 * Object's `ctx.storage.sql` under celld or Cloudflare. Keeping the port this small is
 * what makes the second host an adapter rather than a rewrite.
 *
 * Everything is synchronous because both backends are: DO SQL is synchronous by contract,
 * and `DatabaseSync` is too. Async plumbing would be a lie about the transaction boundary.
 */

export type SqlValue = string | number | null | Uint8Array

/** One row, as the drivers return it: named columns, SQL values only. */
export type SqlRow = Readonly<Record<string, SqlValue>>

export interface Sql {
  exec(sql: string, ...params: ReadonlyArray<SqlValue>): void
  all<T>(sql: string, ...params: ReadonlyArray<SqlValue>): ReadonlyArray<T>
  get<T>(sql: string, ...params: ReadonlyArray<SqlValue>): T | undefined
  /** One synchronous transaction. The callback must not await. */
  transaction<T>(run: () => T): T
}

/** The cursor shape `ctx.storage.sql.exec` returns, without importing workerd types. */
export interface SqlCursor {
  toArray(): ReadonlyArray<unknown>
}

export interface DoSqlStorage {
  exec(query: string, ...bindings: ReadonlyArray<unknown>): SqlCursor
}

/**
 * The Durable Object's SQLite.
 *
 * `ctx.storage.sql` cannot open a transaction inside a transaction; `transactionSync` is
 * the DO's own boundary, so it is passed in rather than invented here.
 */
export class DoSql implements Sql {
  readonly #sql: DoSqlStorage
  readonly #transaction: <T>(run: () => T) => T

  constructor(sql: DoSqlStorage, transaction: <T>(run: () => T) => T) {
    this.#sql = sql
    this.#transaction = transaction
  }

  exec(sql: string, ...params: ReadonlyArray<SqlValue>): void {
    this.#sql.exec(sql, ...params)
  }

  all<T>(sql: string, ...params: ReadonlyArray<SqlValue>): ReadonlyArray<T> {
    // SAFETY: the caller names the row type; the Durable Object returns named columns.
    // oxlint-disable-next-line plumb/no-reinterpret-cast plumb/require-safety-comment-for-type-assertion
    return this.#sql.exec(sql, ...params).toArray() as ReadonlyArray<T>
  }

  // The SQL port returns absence, not a reason; the ledger turns it into a typed failure.
  // oxlint-disable-next-line plumb-effect/guarded-op-must-return-option
  get<T>(sql: string, ...params: ReadonlyArray<SqlValue>): T | undefined {
    return this.all<T>(sql, ...params)[0]
  }

  transaction<T>(run: () => T): T {
    return this.#transaction(run)
  }
}
