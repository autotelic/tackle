import { Claim as ClaimSchema, Job as JobSchema, type Job } from "@autotelic/board"
import { Data, Result, Schema } from "effect"

/*
 * The room client.
 *
 * The daemon is a client of the room, not a second writer. Everything it knows about work
 * comes from this small HTTP surface, which means the same daemon works against a local
 * celld object and a deployed one.
 */

/** One worker session. */
export const Worker = Schema.Struct({
  name: Schema.String,
  room: Schema.String,
  pr: Schema.optionalKey(Schema.Finite),
  kind: Schema.String,
  address: Schema.String,
  worktree: Schema.String,
  state: Schema.String,
  startedAt: Schema.Finite,
  updatedAt: Schema.Finite,
})

/** One worker session. */
export type Worker = typeof Worker.Type

/** The board projection the CLI and the Pi widget render. */
export const Board = Schema.Struct({
  room: Schema.String,
  counts: Schema.Struct({ chits: Schema.Finite, jobs: Schema.Finite, receipts: Schema.Finite }),
  chits: Schema.Array(Schema.Struct({ state: Schema.String, count: Schema.Finite })),
  jobs: Schema.Array(JobSchema),
  claims: Schema.Array(ClaimSchema),
  presence: Schema.Array(
    Schema.Struct({ host: Schema.String, actor: Schema.String, at: Schema.Finite }),
  ),
  workers: Schema.Array(Worker),
})

/** The board projection. */
export type Board = typeof Board.Type

/** One message waiting for the project session. */
export interface InboxItem {
  readonly seq: number
  readonly id: string
  readonly kind: "turn" | "card"
  readonly pr?: number
  readonly ticket?: string
  readonly text: string
  readonly at: number
}

/** What the room client can fail with. */
export class RoomClientError extends Data.TaggedError("RoomClientError")<{
  readonly message: string
}> {}

export class RoomClient {
  readonly #base: string
  readonly #room: string

  constructor(base: string, room: string) {
    this.#base = base.replace(/\/+$/, "")
    this.#room = room
  }

  #url(path: string): string {
    return `${this.#base}/r/${encodeURIComponent(this.#room)}${path}`
  }

  async #json<T>(path: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers)
    headers.set("content-type", "application/json")
    // SAFETY: this is the room client's only network boundary; the caller supplies the
    // schema for the shape it expects from its own service.
    // oxlint-disable-next-line plumb-effect/no-direct-fetch
    const response = await fetch(this.#url(path), { ...init, headers })
    const value: unknown = await response.json()
    if (!response.ok)
      throw new RoomClientError({
        message: `room ${path}: ${response.status} ${JSON.stringify(value)}`,
      })
    // SAFETY: the room is this process's own service; each caller decodes the shape it asked
    // for, and a mismatch surfaces there rather than here.
    // oxlint-disable-next-line plumb/no-reinterpret-cast plumb/require-safety-comment-for-type-assertion
    return value as T
  }

  health(): Promise<{ room: string; counts: Record<string, number> }> {
    return this.#json("/health")
  }

  /**
   * Read the board projection.
   *
   * @returns Some(board) when the room answers and the shape decodes, None otherwise.
   */
  async board(): Promise<Result.Result<Board, string>> {
    // SAFETY: the room client's only network boundary; the response is decoded below.
    // oxlint-disable-next-line plumb-effect/no-direct-fetch
    const response = await fetch(this.#url("/board"))
    if (!response.ok) return Result.fail("room did not answer")
    const text = await response.text()
    const decoded = Schema.decodeResult(Schema.fromJsonString(Board))(text)
    return Result.isSuccess(decoded)
      ? Result.succeed(decoded.success)
      : Result.fail("board did not decode")
  }

  configure(actor: string, name: string, label: string | undefined): Promise<{ ok: boolean }> {
    return this.#json("/config", {
      method: "PUT",
      body: JSON.stringify(label === undefined ? { actor, name } : { actor, name, label }),
    })
  }

  ingest(
    headers: Record<string, string>,
    body: Schema.Json,
  ): Promise<{ accepted: boolean; queued: boolean }> {
    return this.#json("/ingest", { method: "POST", headers, body: JSON.stringify(body) })
  }

  registerSession(id: string, at: number): Promise<{ ok: boolean }> {
    return this.#json("/session", { method: "PUT", body: JSON.stringify({ id, at }) })
  }

  session(): Promise<{ id: string | null; active: boolean; at: number }> {
    return this.#json("/session")
  }

  inbox(after: number, limit = 50): Promise<{ items: ReadonlyArray<InboxItem>; next: number }> {
    return this.#json(`/inbox?after=${after}&limit=${limit}`)
  }

  ack(seqs: ReadonlyArray<number>): Promise<{ ok: boolean; changed: number }> {
    return this.#json("/inbox/ack", { method: "POST", body: JSON.stringify({ seqs }) })
  }

  workers(): Promise<{ workers: ReadonlyArray<Worker> }> {
    return this.#json("/workers")
  }

  putWorker(input: {
    readonly name: string
    readonly pr?: number
    readonly kind: string
    readonly address: string
    readonly worktree: string
  }): Promise<{ ok: boolean }> {
    return this.#json("/workers", { method: "PUT", body: JSON.stringify(input) })
  }

  async claim(host: string): Promise<Job | null> {
    const value = await this.#json<{ job: unknown }>("/jobs/claim", {
      method: "POST",
      body: JSON.stringify({ host }),
    })
    return Result.getOrUndefined(Schema.decodeUnknownResult(JobSchema)(value.job)) ?? null
  }

  start(id: string): Promise<{ ok: boolean }> {
    return this.#json("/jobs/start", { method: "POST", body: JSON.stringify({ id }) })
  }

  finish(id: string, state: string, note: string | undefined): Promise<{ ok: boolean }> {
    return this.#json("/jobs/finish", { method: "POST", body: JSON.stringify({ id, state, note }) })
  }

  beat(host: string, actor: string, ttl: number): Promise<{ ok: boolean }> {
    return this.#json("/presence", { method: "POST", body: JSON.stringify({ host, actor, ttl }) })
  }
}
