import { createServer, type IncomingMessage, type ServerResponse } from "node:http"
import {
  ack,
  acquire,
  deliver,
  empty,
  list,
  release,
  send,
  type Failure,
  type MailboxState,
  type Result as ProcedureResult,
} from "@autotelic/mailbox-domain/procedures"
import { Option } from "effect"
import * as Result from "effect/Result"
import * as Schema from "effect/Schema"

/*
 * The mailbox as a process: the Rat King procedures over HTTP, one in-memory log.
 *
 * Binding is the caller's decision (loopback by default). There is no auth here yet, so the
 * service is a local endpoint, not a federated one; the sender DID is the body's claim until
 * a signed envelope check exists.
 */

const Harness = Schema.Struct({
  $type: Schema.String,
  sessionId: Schema.optional(Schema.String),
  paneId: Schema.optional(Schema.String),
  executionId: Schema.optional(Schema.String),
})

const MessageRef = Schema.Struct({ senderDid: Schema.String, messageId: Schema.String })

const SendBody = Schema.Struct({
  actorDid: Schema.String,
  envelope: Schema.Unknown,
  leaseId: Schema.optional(Schema.String),
  generation: Schema.optional(Schema.Finite),
  woke: Schema.optional(Schema.Boolean),
  resolvedFrom: Schema.optional(Schema.String),
})

const DeliverBody = Schema.Struct({
  message: MessageRef,
  recipientDid: Schema.String,
  leaseId: Schema.String,
  generation: Schema.Finite,
})

const AckBody = DeliverBody

const AcquireBody = Schema.Struct({
  did: Schema.String,
  harness: Harness,
  expiresAt: Schema.String,
  leaseId: Schema.optional(Schema.String),
  generation: Schema.optional(Schema.Finite),
})

const ReleaseBody = Schema.Struct({
  did: Schema.String,
  leaseId: Schema.String,
  generation: Schema.Finite,
})

interface MailboxSendInput {
  readonly envelope: unknown
  leaseId?: string
  generation?: number
  woke?: boolean
  resolvedFrom?: string
}

interface MailboxHarness {
  readonly $type: string
  sessionId?: string
  paneId?: string
  executionId?: string
}

interface MailboxAcquireInput {
  readonly did: string
  readonly harness: MailboxHarness
  readonly expiresAt: string
  leaseId?: string
  generation?: number
}

const failureStatus = (failure: Failure): number => {
  switch (failure._tag) {
    case "Conflict":
    case "LeaseHeld":
    case "InvalidTransition":
      return 409
    case "LeaseMismatch":
    case "RoleUnresolved":
      return 403
    case "Retired":
      return 410
    case "MessageNotFound":
      return 404
    case "UnsupportedEnvelope":
      return 422
  }
}

type Reply = { readonly status: number; readonly body: unknown }

const okay = <A>(result: ProcedureResult<A>): Reply =>
  result.ok ? { status: 200, body: result } : { status: failureStatus(result.error), body: result }

const json = ({
  response,
  status,
  body,
}: {
  readonly response: ServerResponse
  readonly status: number
  readonly body: unknown
}): void => {
  const text = JSON.stringify(body) + "\n"
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(text),
  })
  response.end(text)
}

const readBody = (request: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let text = ""
    request.setEncoding("utf8")
    request.on("data", (chunk: string) => {
      text += chunk
    })
    request.on("end", () => resolve(text))
    request.on("error", reject)
  })

/** Text to an unshaped JSON value; route schemas narrow it next. */
const decodeMailboxJson = (text: string): Option.Option<unknown> => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Schema.Unknown))(text)
  return Result.isSuccess(decoded) ? Option.some(decoded.success) : Option.none()
}

const handleMailboxRequest = async (
  state: MailboxState,
  request: IncomingMessage,
  now: number,
): Promise<Reply> => {
  const url = new URL(request.url ?? "/", "http://mailbox")
  const route = url.pathname
  if (route === "/health" && request.method === "GET")
    return { status: 200, body: { ok: true, seq: state.seq } }
  if (route === "/xrpc/dev.autotelic.mailbox.list" && request.method === "GET") {
    const recipientDid = url.searchParams.get("recipientDid")
    if (recipientDid === null) return { status: 400, body: { error: "recipientDid is required" } }
    const afterSeq = Number(url.searchParams.get("afterSeq") ?? "0")
    if (!Number.isFinite(afterSeq))
      return { status: 400, body: { error: "afterSeq must be a number" } }
    return { status: 200, body: list(state, { recipientDid, afterSeq }) }
  }
  if (request.method !== "POST") return { status: 405, body: { error: "method not allowed" } }
  const text = await readBody(request)
  const decoded = decodeMailboxJson(text)
  if (Option.isNone(decoded)) return { status: 400, body: { error: "invalid JSON" } }
  const value = decoded.value

  if (route === "/xrpc/dev.autotelic.mailbox.send") {
    const body = Schema.decodeUnknownResult(SendBody)(value)
    if (Result.isFailure(body)) return { status: 400, body: { error: "invalid send body" } }
    const input: MailboxSendInput = { envelope: body.success.envelope }
    if (body.success.leaseId !== undefined) input.leaseId = body.success.leaseId
    if (body.success.generation !== undefined) input.generation = body.success.generation
    if (body.success.woke !== undefined) input.woke = body.success.woke
    if (body.success.resolvedFrom !== undefined) input.resolvedFrom = body.success.resolvedFrom
    return okay(send(state, input, body.success.actorDid, now))
  }
  if (route === "/xrpc/dev.autotelic.mailbox.deliver") {
    const body = Schema.decodeUnknownResult(DeliverBody)(value)
    if (Result.isFailure(body)) return { status: 400, body: { error: "invalid deliver body" } }
    return okay(deliver(state, body.success, now))
  }
  if (route === "/xrpc/dev.autotelic.mailbox.ack") {
    const body = Schema.decodeUnknownResult(AckBody)(value)
    if (Result.isFailure(body)) return { status: 400, body: { error: "invalid ack body" } }
    return okay(ack(state, body.success, now))
  }
  if (route === "/xrpc/dev.autotelic.mailbox.acquire") {
    const body = Schema.decodeUnknownResult(AcquireBody)(value)
    if (Result.isFailure(body)) return { status: 400, body: { error: "invalid acquire body" } }
    const harness: MailboxHarness = { $type: body.success.harness.$type }
    if (body.success.harness.sessionId !== undefined)
      harness.sessionId = body.success.harness.sessionId
    if (body.success.harness.paneId !== undefined) harness.paneId = body.success.harness.paneId
    if (body.success.harness.executionId !== undefined)
      harness.executionId = body.success.harness.executionId
    const input: MailboxAcquireInput = {
      did: body.success.did,
      harness,
      expiresAt: body.success.expiresAt,
    }
    if (body.success.leaseId !== undefined) input.leaseId = body.success.leaseId
    if (body.success.generation !== undefined) input.generation = body.success.generation
    return okay(acquire(state, input, now))
  }
  if (route === "/xrpc/dev.autotelic.mailbox.release") {
    const body = Schema.decodeUnknownResult(ReleaseBody)(value)
    if (Result.isFailure(body)) return { status: 400, body: { error: "invalid release body" } }
    return okay(release(state, body.success, now))
  }
  return { status: 404, body: { error: "not found" } }
}

export interface MailboxService {
  readonly url: string
  readonly close: () => Promise<void>
}

/** Start the mailbox on one host and port; the log lives for the process. */
export const startMailboxService = async ({
  host,
  port,
}: {
  readonly host: string
  readonly port: number
}): Promise<MailboxService> => {
  const state = empty()
  const server = createServer((request, response) => {
    void handleMailboxRequest(state, request, Date.now()).then(
      (reply) => json({ response, status: reply.status, body: reply.body }),
      (cause: unknown) =>
        json({
          response,
          status: 500,
          body: { error: cause instanceof Error ? cause.message : String(cause) },
        }),
    )
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, host, resolve)
  })
  return {
    url: "http://" + host + ":" + port,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
