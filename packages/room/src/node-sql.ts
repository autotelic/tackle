import type { DatabaseSync } from "node:sqlite"
import type { Sql, SqlValue } from "./sql.ts"

/** `node:sqlite`, used by tests, `room` commands, and the local daemon. */
export class NodeSql implements Sql {
  readonly #db: import("node:sqlite").DatabaseSync

  constructor(db: import("node:sqlite").DatabaseSync) {
    this.#db = db
  }

  exec(sql: string, ...params: ReadonlyArray<SqlValue>): void {
    this.#db.prepare(sql).run(...params)
  }

  all<T>(sql: string, ...params: ReadonlyArray<SqlValue>): ReadonlyArray<T> {
    return this.#db.prepare(sql).all(...params) as unknown as ReadonlyArray<T>
  }

  get<T>(sql: string, ...params: ReadonlyArray<SqlValue>): T | undefined {
    return this.#db.prepare(sql).get(...params) as unknown as T | undefined
  }

  transaction<T>(run: () => T): T {
    this.#db.exec("BEGIN IMMEDIATE")
    try {
      const value = run()
      this.#db.exec("COMMIT")
      return value
    } catch (error) {
      this.#db.exec("ROLLBACK")
      throw error
    }
  }
}
