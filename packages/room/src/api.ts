import { JOB_STATES, actorOf } from "@autotelic/board"
import { Option, Result, Schema } from "effect"
import type { Ledger } from "./ledger.ts"
import { fromGithub, fromLinear } from "./ingest.ts"
import { reviewJob, shouldReview } from "./policy.ts"

/*
 * The room's HTTP surface.
 *
 * The Worker and the Durable Object only route; this file is the whole API, written against
 * the `Ledger` so it can be tested without a Worker runtime. The daemon is a client of this,
 * never a second writer.
 *
 * The room is the listener: webhooks land here, jobs are queued here, and the daemon claims
 * them. That is why `roomd` no longer needs an HTTP server of its own.
 */

/** What the API needs from its host. */
export interface ApiOptions {
  readonly now: () => number
}

const ConfigBody = Schema.Struct({
  actor: Schema.String,
  name: Schema.optionalKey(Schema.String),
})

const PresenceBody = Schema.Struct({
  host: Schema.String,
  actor: Schema.String,
  ttl: Schema.optionalKey(Schema.Finite),
})

const ClaimBody = Schema.Struct({ host: Schema.String })

const IdBody = Schema.Struct({ id: Schema.String })

const FinishBody = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals(JOB_STATES),
  note: Schema.optionalKey(Schema.String),
})

const json = (input: { readonly body: object; readonly status?: number }): Response => {
  const text = `${JSON.stringify(input.body)}\n`
  return new Response(text, {
    status: input.status ?? 200,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text)),
    },
  })
}

const rawBody = async (request: Request): Promise<unknown> => request.json().catch(() => undefined)

/**
 * Handle one room request.
 *
 * @param request - The forwarded request, with the room already selected.
 * @param ledger - The room's ledger.
 * @param options - The room's clock.
 * @returns The response.
 */
export const handle = async (
  request: Request,
  ledger: Ledger,
  options: ApiOptions,
): Promise<Response> => {
  const url = new URL(request.url)
  const path = url.pathname
  const now = options.now()

  if (request.method === "GET" && path === "/health") {
    return json({
      body: {
        room: ledger.room,
        counts: ledger.counts(),
        presences: ledger.presences(now).length,
        jobs: ledger.jobs().slice(0, 10),
      },
    })
  }

  if (request.method === "GET" && path === "/board") {
    return json({
      body: {
        room: ledger.room,
        counts: ledger.counts(),
        chits: ledger.chitStates(),
        jobs: ledger.jobs().slice(0, 20),
        claims: ledger.claims(now),
        presence: ledger.presences(now).map((presence) => ({
          host: presence.host,
          actor: presence.actor,
          at: presence.at,
        })),
      },
    })
  }

  if (request.method === "PUT" && path === "/config") {
    const body = Result.getOrUndefined(
      Schema.decodeUnknownResult(ConfigBody)(await rawBody(request)),
    )
    if (body === undefined) return json({ body: { error: "actor is required" }, status: 400 })
    ledger.set("actor", body.actor)
    ledger.set("name", body.name ?? "")
    return json({ body: { ok: true, actor: body.actor } })
  }

  if (request.method === "POST" && path === "/ingest") {
    const raw = await rawBody(request)
    const github = request.headers.get("x-github-event")
    const linear =
      request.headers.get("x-linear-delivery") ?? request.headers.get("linear-delivery")
    const delivery = request.headers.get("x-github-delivery") ?? linear ?? `local:${now}`
    const event =
      github !== null
        ? fromGithub({ event: github, delivery, body: raw, now })
        : fromLinear({ delivery, body: raw, now })
    const fresh = ledger.append({
      id: event.id,
      room: ledger.room,
      at: now,
      kind: event.kind,
      payload: { event: event.kind },
    })
    if (!fresh) {
      return json({ body: { event: event.kind, accepted: false, queued: false } })
    }
    const actor = Option.getOrUndefined(ledger.get("actor")) ?? actorOf("")
    const queued =
      shouldReview({ event, actor }) && event.kind === "review.requested"
        ? ledger.enqueue(reviewJob({ event, room: ledger.room, now }))
        : false
    return json({ body: { event: event.kind, accepted: true, queued } })
  }

  if (request.method === "POST" && path === "/presence") {
    const body = Result.getOrUndefined(
      Schema.decodeUnknownResult(PresenceBody)(await rawBody(request)),
    )
    if (body === undefined)
      return json({ body: { error: "host and actor are required" }, status: 400 })
    ledger.beat({
      host: body.host,
      room: ledger.room,
      actor: body.actor,
      at: now,
      ttl: body.ttl ?? 60_000,
    })
    return json({ body: { ok: true } })
  }

  if (request.method === "POST" && path === "/jobs/claim") {
    const body = Result.getOrUndefined(
      Schema.decodeUnknownResult(ClaimBody)(await rawBody(request)),
    )
    if (body === undefined) return json({ body: { error: "host is required" }, status: 400 })
    const job = Option.getOrUndefined(ledger.claimJob(body.host, now))
    return json({ body: { job: job ?? null } })
  }

  if (request.method === "POST" && path === "/jobs/start") {
    const body = Result.getOrUndefined(Schema.decodeUnknownResult(IdBody)(await rawBody(request)))
    if (body === undefined) return json({ body: { error: "id is required" }, status: 400 })
    ledger.startJob(body.id, now)
    return json({ body: { ok: true } })
  }

  if (request.method === "POST" && path === "/jobs/finish") {
    const body = Result.getOrUndefined(
      Schema.decodeUnknownResult(FinishBody)(await rawBody(request)),
    )
    if (body === undefined) {
      return json({ body: { error: "id and a valid state are required" }, status: 400 })
    }
    ledger.finishJob(body.id, body.state, body.note, now)
    return json({ body: { ok: true } })
  }

  if (request.method === "GET" && path === "/jobs") {
    return json({ body: { jobs: ledger.jobs() } })
  }

  if (request.method === "GET" && path === "/receipts") {
    return json({ body: { receipts: ledger.receipts(100) } })
  }

  return json({ body: { error: "not found", path }, status: 404 })
}
