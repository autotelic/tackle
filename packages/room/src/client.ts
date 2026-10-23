import { decodeJob, type Job } from "@autotelic/board"

/*
 * The room client.
 *
 * The daemon is a client of the room, not a second writer. Everything it knows about work
 * comes from this small HTTP surface, which means the same daemon works against a local
 * celld object and a deployed one.
 */

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
    return value.job === null ? null : (decodeJob(value.job) ?? null)
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
