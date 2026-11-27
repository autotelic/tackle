import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import * as Schema from "effect/Schema"
import { expect, test } from "vitest"
import { startMailboxService } from "../src/mailbox/service.ts"

/* oxlint-disable plumb/prefer-property-tests -- this is a protocol conversation over one live socket. */

const fixture = (name: string): Schema.Json =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL("./mailbox-fixtures/v0/" + name, import.meta.url)), "utf8"),
  )

const EnvelopeFixture = Schema.Struct({ envelope: Schema.Json })

const Aad = Schema.Struct({
  aad: Schema.Struct({
    senderDid: Schema.String,
    recipientDid: Schema.String,
    messageId: Schema.String,
  }),
})

const LeaseReply = Schema.Struct({
  value: Schema.Struct({ leaseId: Schema.String, generation: Schema.Finite }),
})
const StateReply = Schema.Struct({ value: Schema.Struct({ state: Schema.String }) })

const start = (statePath?: string) =>
  // Port 0: the kernel owns the collision check. A random port can land on another process's
  // listener (or another test's) and turn an unrelated test into EADDRINUSE.
  startMailboxService({ host: "127.0.0.1", port: 0, statePath })

const post = async (
  url: string,
  route: string,
  body: Schema.Json,
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(url + "/xrpc/dev.autotelic.mailbox." + route, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}

test("the mailbox admits, delivers and lists over HTTP", async () => {
  const service = await start()
  try {
    const source = Schema.decodeUnknownSync(EnvelopeFixture)(fixture("send.input.json"))
    const envelope = source.envelope
    const aad = Schema.decodeUnknownSync(Aad)(envelope).aad

    const sent = await post(service.url, "send", { actorDid: aad.senderDid, envelope })
    expect(sent.status).toBe(200)
    expect(sent.body).toMatchObject({ ok: true, value: { state: "accepted" } })

    const acquired = await post(service.url, "acquire", {
      did: aad.recipientDid,
      harness: { $type: "sh.mschf.ratking.runtime.lease#pi", sessionId: "test" },
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    })
    expect(acquired.status).toBe(200)
    const lease = Schema.decodeUnknownSync(LeaseReply)(acquired.body).value

    const message = { senderDid: aad.senderDid, messageId: aad.messageId }
    const delivered = await post(service.url, "deliver", {
      message,
      recipientDid: aad.recipientDid,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    expect(delivered.status).toBe(200)
    expect(Schema.decodeUnknownSync(StateReply)(delivered.body).value.state).toBe("delivered")

    const listed = await fetch(
      service.url +
        "/xrpc/dev.autotelic.mailbox.list?recipientDid=" +
        encodeURIComponent(aad.recipientDid) +
        "&afterSeq=0",
    )
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({
      throughSeq: 2,
      events: [{ seq: 2, receipt: { state: "delivered" } }],
    })

    const acked = await post(service.url, "ack", {
      message,
      recipientDid: aad.recipientDid,
      leaseId: lease.leaseId,
      generation: lease.generation,
    })
    expect(acked.status).toBe(200)
    expect(Schema.decodeUnknownSync(StateReply)(acked.body).value.state).toBe("acked")
  } finally {
    await service.close()
  }
}, 20_000)

test("a plaintext body is refused as an unsupported envelope", async () => {
  const service = await start()
  try {
    const response = await post(service.url, "send", {
      actorDid: "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa",
      envelope: { body: "hello" },
    })
    expect(response.status).toBe(422)
    expect(response.body).toMatchObject({
      ok: false,
      error: { _tag: "UnsupportedEnvelope" },
    })
  } finally {
    await service.close()
  }
})

test("a restart keeps the admitted message", async () => {
  const root = mkdtempSync(join(tmpdir(), "mailbox-state-"))
  const statePath = join(root, "state.json")
  const source = Schema.decodeUnknownSync(EnvelopeFixture)(fixture("send.input.json"))
  const aad = Schema.decodeUnknownSync(Aad)(source.envelope).aad
  try {
    const first = await start(statePath)
    try {
      const sent = await post(first.url, "send", {
        actorDid: aad.senderDid,
        envelope: source.envelope,
      })
      expect(sent.status).toBe(200)
    } finally {
      await first.close()
    }

    const second = await start(statePath)
    try {
      const listed = await fetch(
        second.url +
          "/xrpc/dev.autotelic.mailbox.list?recipientDid=" +
          encodeURIComponent(aad.recipientDid) +
          "&afterSeq=0",
      )
      expect(await listed.json()).toMatchObject({
        throughSeq: 1,
        events: [{ seq: 1, receipt: { state: "accepted" } }],
      })
    } finally {
      await second.close()
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}, 20_000)
