import { Claim as ClaimSchema, Job as JobSchema, decodeJob, type Job } from "@autotelic/board"
import { Option, Result, Schema } from "effect"

/*
 * The room client.
 *
 * The daemon is a client of the room, not a second writer. Everything it knows about work
 * comes from this small HTTP surface, which means the same daemon works against a local
 * celld object and a deployed one.
 */

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
})

/** The board projection. */
export type Board = typeof Board.Type

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
    const response = await fetch(this.#url(path), { ...init, headers })
    const value: unknown = await response.json()
    if (!response.ok) throw new Error(`room ${path}: ${response.status} ${JSON.stringify(value)}`)
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
  async board(): Promise<Option.Option<Board>> {
    const response = await fetch(this.#url("/board"))
    if (!response.ok) return Option.none()
    const text = await response.text()
    const decoded = Schema.decodeUnknownResult(Schema.fromJsonString(Board))(text)
    return Result.isSuccess(decoded) ? Option.some(decoded.success) : Option.none()
  }

  configure(actor: string, name: string): Promise<{ ok: boolean }> {
    return this.#json("/config", { method: "PUT", body: JSON.stringify({ actor, name }) })
  }

  ingest(
    headers: Record<string, string>,
    body: unknown,
  ): Promise<{ accepted: boolean; queued: boolean }> {
    return this.#json("/ingest", { method: "POST", headers, body: JSON.stringify(body) })
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
