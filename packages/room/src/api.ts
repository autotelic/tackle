import { JOB_STATES, actorOf, oneOf } from "@autotelic/board"
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

export interface ApiOptions {
  readonly now: () => number
}

const json = (value: unknown, status = 200): Response =>
  new Response(`${JSON.stringify(value)}\n`, {
    status,
    headers: { "content-type": "application/json" },
  })

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const value: unknown = await request.json()
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

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
      room: ledger.room,
      counts: ledger.counts(),
      presences: ledger.presences(now).length,
      jobs: ledger.jobs().slice(0, 10),
    })
  }

  if (request.method === "PUT" && path === "/config") {
    const body = await readJson(request)
    const actor = typeof body.actor === "string" ? body.actor : ""
    const name = typeof body.name === "string" ? body.name : ""
    if (actor === "") return json({ error: "actor is required" }, 400)
    ledger.set("actor", actor)
    ledger.set("name", name)
    return json({ ok: true, actor })
  }

  if (request.method === "POST" && path === "/ingest") {
    const body: unknown = await request.json().catch(() => undefined)
    const github = request.headers.get("x-github-event")
    const linear =
      request.headers.get("x-linear-delivery") ?? request.headers.get("linear-delivery")
    const delivery = request.headers.get("x-github-delivery") ?? linear ?? `local:${now}`
    const event =
      github !== null
        ? fromGithub({ event: github, delivery, body, now })
        : fromLinear({ delivery, body, now })
    const fresh = ledger.append({
      id: event.id,
      room: ledger.room,
      at: now,
      kind: event.kind,
      payload: { event },
    })
    if (!fresh) return json({ event: event.kind, accepted: false, queued: false })
    const actor = ledger.get("actor") ?? actorOf("")
    const queued =
      shouldReview({ event, actor }) && event.kind === "review.requested"
        ? ledger.enqueue(reviewJob({ event, room: ledger.room, now }))
        : false
    return json({ event: event.kind, accepted: true, queued })
  }

  if (request.method === "POST" && path === "/presence") {
    const body = await readJson(request)
    const host = typeof body.host === "string" ? body.host : ""
    const actor = typeof body.actor === "string" ? body.actor : ""
    if (host === "" || actor === "") return json({ error: "host and actor are required" }, 400)
    ledger.beat({
      host,
      room: ledger.room,
      actor,
      at: now,
      ttl: typeof body.ttl === "number" ? body.ttl : 60_000,
    })
    return json({ ok: true })
  }

  if (request.method === "POST" && path === "/jobs/claim") {
    const body = await readJson(request)
    const host = typeof body.host === "string" ? body.host : ""
    if (host === "") return json({ error: "host is required" }, 400)
    const job = ledger.claimJob(host, now)
    return json({ job: job ?? null })
  }

  if (request.method === "POST" && path === "/jobs/start") {
    const body = await readJson(request)
    const id = typeof body.id === "string" ? body.id : ""
    if (id === "") return json({ error: "id is required" }, 400)
    ledger.startJob(id, now)
    return json({ ok: true })
  }

  if (request.method === "POST" && path === "/jobs/finish") {
    const body = await readJson(request)
    const id = typeof body.id === "string" ? body.id : ""
    const state = oneOf(body.state, JOB_STATES)
    const note = typeof body.note === "string" ? body.note : undefined
    if (id === "" || state === undefined)
      return json({ error: "id and a valid state are required" }, 400)
    ledger.finishJob(id, state, note, now)
    return json({ ok: true })
  }

  if (request.method === "GET" && path === "/jobs") {
    return json({ jobs: ledger.jobs() })
  }

  if (request.method === "GET" && path === "/receipts") {
    return json({ receipts: ledger.receipts(100) })
  }

  return json({ error: "not found", path }, 404)
}
