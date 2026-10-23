import { DurableObject } from "cloudflare:workers"
import { handle } from "../src/api.ts"
import { Ledger } from "../src/ledger.ts"
import { DoSql } from "../src/sql.ts"

/*
 * The room as a Durable Object.
 *
 * This is the bundle celld runs locally. It is deliberately thin: the DO owns the SQLite
 * and the request gate, and every decision lives in `src/` so it can be tested without a
 * Worker. `blockConcurrencyWhile` is the whole concurrency story for construction; the DO's
 * input gate is the rest.
 */

export interface RoomEnv {
  readonly ROOMS: DurableObjectNamespace
}

export class Room extends DurableObject<RoomEnv> {
  #ledger: Ledger | undefined

  constructor(ctx: DurableObjectState, env: RoomEnv) {
    super(ctx, env)
    void ctx.blockConcurrencyWhile(async () => {
      const sql = new DoSql(ctx.storage.sql, (run) => ctx.storage.transactionSync(run))
      this.#ledger = Ledger.open(sql, ctx.id.name ?? "room")
    })
  }

  override async fetch(request: Request): Promise<Response> {
    const ledger = this.#ledger
    if (ledger === undefined) return new Response("room: not ready\n", { status: 503 })
    return handle(request, ledger, { now: () => Date.now() })
  }
}
