import { JOB_STATES, actorOf } from "@autotelic/board"
import { Effect, Result, Schema } from "effect"
import type { Ledger } from "./ledger.ts"
import { fromGithub, fromLinear } from "./ingest.ts"
import { inboxFor } from "./inbox.ts"
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
  name: Schema.String.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  label: Schema.optionalKey(Schema.String),
  batchMs: Schema.optionalKey(Schema.Finite),
  linearUser: Schema.optionalKey(Schema.String),
})

const PresenceBody = Schema.Struct({
  host: Schema.String,
  actor: Schema.String,
  ttl: Schema.Finite.pipe(Schema.withDecodingDefaultKey(Effect.succeed(60_000))),
})

const ClaimBody = Schema.Struct({ host: Schema.String })

const IdBody = Schema.Struct({ id: Schema.String, at: Schema.optionalKey(Schema.Finite) })

const AckBody = Schema.Struct({ seqs: Schema.Array(Schema.Finite) })

const WorkerBody = Schema.Struct({
  name: Schema.String,
  pr: Schema.optionalKey(Schema.Finite),
  kind: Schema.String,
  address: Schema.String,
  worktree: Schema.String,
})

const FinishBody = Schema.Struct({
  id: Schema.String,
  state: Schema.Literals(JOB_STATES),
  note: Schema.optionalKey(Schema.String),
})

const json = (input: { readonly body: object; readonly status?: number }): Response => {
  const text = `${JSON.stringify(input.body)}\n`
  return new Response(text, {
    status: input.status === undefined ? 200 : input.status,
    headers: {
      "content-type": "application/json",
      "content-length": String(Buffer.byteLength(text)),
    },
  })
}

const rawBody = async (request: Request): Promise<Schema.Json | undefined> => {
  const value: unknown = await request.json().catch(() => undefined)
  return Result.getOrUndefined(Schema.decodeUnknownResult(Schema.Json)(value))
}

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
        workers: ledger.workers(),
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
    ledger.set("name", body.name)
    if (body.label !== undefined) ledger.set("label", body.label)
    if (body.batchMs !== undefined) ledger.set("batchMs", String(body.batchMs))
    if (body.linearUser !== undefined) ledger.set("linearUser", body.linearUser)
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
    const actor = Result.getOrUndefined(ledger.get("actor")) ?? actorOf("")
    const linearUser = Result.getOrUndefined(ledger.get("linearUser"))
    const draft = inboxFor(
      linearUser === undefined ? { event, actor } : { event, actor, linearUser },
    )
    if (Result.isSuccess(draft)) {
      const batch = Result.getOrUndefined(ledger.get("batchMs"))
      const batchMs = batch === undefined ? 30_000 : Number(batch)
      ledger.enqueueInbox({ ...draft.success, at: now, holdUntil: now + batchMs })
    }
    const watch = Result.getOrUndefined(ledger.get("label"))
    const addressed = watch === undefined ? { event, actor } : { event, actor, label: watch }
    const queued =
      (event.kind === "review.requested" || event.kind === "pr.ready") &&
      shouldReview(addressed) &&
      ledger.enqueue(reviewJob({ event, room: ledger.room, now }))
    return json({ body: { event: event.kind, accepted: true, queued } })
  }

  if (request.method === "PUT" && path === "/session") {
    const body = Result.getOrUndefined(Schema.decodeUnknownResult(IdBody)(await rawBody(request)))
    if (body === undefined) return json({ body: { error: "id is required" }, status: 400 })
    ledger.set("session", body.id)
    ledger.set("session_at", String(body.at === undefined ? now : body.at))
    return json({ body: { ok: true, session: body.id } })
  }

  if (request.method === "GET" && path === "/session") {
    const id = Result.getOrUndefined(ledger.get("session"))
    const raw = Result.getOrUndefined(ledger.get("session_at"))
    const at = raw === undefined ? 0 : Number(raw)
    return json({ body: { id: id ?? null, active: at + 60_000 > now, at } })
  }

  if (request.method === "GET" && path === "/inbox") {
    const after = Number(url.searchParams.get("after") ?? "0")
    const limit = Number(url.searchParams.get("limit") ?? "50")
    const items = ledger.inbox(
      Number.isFinite(after) ? after : 0,
      now,
      Number.isFinite(limit) ? limit : 50,
    )
    const next = items.length === 0 ? after : (items.at(-1)?.seq ?? after)
    return json({ body: { items, next } })
  }

  if (request.method === "POST" && path === "/inbox/ack") {
    const body = Result.getOrUndefined(Schema.decodeUnknownResult(AckBody)(await rawBody(request)))
    if (body === undefined) return json({ body: { error: "seqs is required" }, status: 400 })
    return json({ body: { ok: true, changed: ledger.ackInbox(body.seqs, now) } })
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
      ttl: body.ttl,
    })
    return json({ body: { ok: true } })
  }

  if (request.method === "POST" && path === "/jobs/claim") {
    const body = Result.getOrUndefined(
      Schema.decodeUnknownResult(ClaimBody)(await rawBody(request)),
    )
    if (body === undefined) return json({ body: { error: "host is required" }, status: 400 })
    const job = Result.getOrUndefined(ledger.claimJob(body.host, now))
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

  if (request.method === "PUT" && path === "/workers") {
    const body = Result.getOrUndefined(
      Schema.decodeUnknownResult(WorkerBody)(await rawBody(request)),
    )
    if (body === undefined)
      return json({ body: { error: "name and address are required" }, status: 400 })
    const worker = Object.assign(
      {
        name: body.name,
        room: ledger.room,
        kind: body.kind,
        address: body.address,
        worktree: body.worktree,
        state: "live",
        startedAt: now,
        updatedAt: now,
      },
      body.pr === undefined ? {} : { pr: body.pr },
    )
    ledger.putWorker(worker)
    return json({ body: { ok: true } })
  }

  if (request.method === "GET" && path === "/workers") {
    return json({ body: { workers: ledger.workers() } })
  }

  if (request.method === "GET" && path === "/jobs") {
    return json({ body: { jobs: ledger.jobs() } })
  }

  if (request.method === "GET" && path === "/receipts") {
    return json({ body: { receipts: ledger.receipts(100) } })
  }

  return json({ body: { error: "not found", path }, status: 404 })
}
