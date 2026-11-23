import { expect, test } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ack, acquire, deliver, empty, release, send } from "@autotelic/protocol"

const fixture = (name: string) =>
  JSON.parse(
    readFileSync(join(import.meta.dirname, "mailbox-fixtures", "v0", name + ".json"), "utf8"),
  )
const NOW = Date.parse("2026-10-04T00:00:00.000Z")
const sender = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
const recipient = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"

const accepted = (state = empty()) => {
  const input = fixture("send.input")
  const result = send(state, input, sender, NOW)
  if (!result.ok) throw new Error("expected admit, got " + result.error._tag)
  return { state, receipt: result.value, envelope: input.envelope }
}

test("send admits the fixture envelope and returns its receipt", () => {
  const { receipt } = accepted()
  expect(receipt).toEqual(fixture("send.output").receipt)
})

test("replay returns the original receipt; different bytes are Conflict", () => {
  const { state, receipt, envelope } = accepted()
  const replay = send(state, fixture("send.input"), sender, NOW)
  expect(replay.ok && replay.value).toEqual(receipt)
  const changed = { ...envelope, ciphertext: { $bytes: "BQYHCA==" } }
  const conflict = send(state, { envelope: changed }, sender, NOW)
  expect(conflict.ok).toBe(false)
  if (!conflict.ok) expect(conflict.error._tag).toBe("Conflict")
})

test("a live sender lease without its fence is LeaseMismatch", () => {
  const input = fixture("fenced-send.input")
  const state = empty()
  const lease = acquire(
    state,
    {
      did: input.envelope.aad.senderDid,
      harness: { $type: "sh.mschf.ratking.runtime.lease#pi", sessionId: "s" },
      expiresAt: new Date(NOW + 60_000).toISOString(),
    },
    NOW,
  )
  expect(lease.ok).toBe(true)
  if (!lease.ok) return
  const unfenced = send(state, { envelope: input.envelope }, input.envelope.aad.senderDid, NOW)
  expect(unfenced.ok).toBe(false)
  if (!unfenced.ok) expect(unfenced.error._tag).toBe("LeaseMismatch")
  const fenced = send(
    state,
    { envelope: input.envelope, leaseId: lease.value.leaseId, generation: lease.value.generation },
    input.envelope.aad.senderDid,
    NOW,
  )
  expect(fenced.ok).toBe(true)
})

test("deliver and ack follow the state machine, and ack before deliver is refused", () => {
  const { state } = accepted()
  const lease = acquire(
    state,
    {
      did: recipient,
      harness: { $type: "sh.mschf.ratking.runtime.lease#pi", sessionId: "s" },
      expiresAt: new Date(NOW + 60_000).toISOString(),
    },
    NOW,
  )
  expect(lease.ok).toBe(true)
  if (!lease.ok) return
  const message = { senderDid: sender, messageId: "3jzfcijpj2z2a" }
  const early = ack(
    state,
    {
      message,
      recipientDid: recipient,
      leaseId: lease.value.leaseId,
      generation: lease.value.generation,
    },
    NOW,
  )
  expect(early.ok).toBe(false)
  if (!early.ok) expect(early.error._tag).toBe("InvalidTransition")
  const delivered = deliver(
    state,
    {
      message,
      recipientDid: recipient,
      leaseId: lease.value.leaseId,
      generation: lease.value.generation,
    },
    NOW,
  )
  expect(delivered.ok && delivered.value.state).toBe("delivered")
  const acked = ack(
    state,
    {
      message,
      recipientDid: recipient,
      leaseId: lease.value.leaseId,
      generation: lease.value.generation,
    },
    NOW,
  )
  expect(acked.ok && acked.value.state).toBe("acked")
})

test("a stale generation on deliver is LeaseMismatch", () => {
  const { state } = accepted()
  const lease = acquire(
    state,
    {
      did: recipient,
      harness: { $type: "sh.mschf.ratking.runtime.lease#pi", sessionId: "s" },
      expiresAt: new Date(NOW + 60_000).toISOString(),
    },
    NOW,
  )
  if (!lease.ok) throw new Error("lease")
  const stale = deliver(
    state,
    {
      message: { senderDid: sender, messageId: "3jzfcijpj2z2a" },
      recipientDid: recipient,
      leaseId: lease.value.leaseId,
      generation: lease.value.generation + 1,
    },
    NOW,
  )
  expect(stale.ok).toBe(false)
  if (!stale.ok) expect(stale.error._tag).toBe("LeaseMismatch")
})

test("lease acquisition is per DID, clamped, and handed over only with the current fence", () => {
  const state = empty()
  const input = fixture("acquire-lease.input")
  const first = acquire(state, input, NOW)
  expect(first.ok).toBe(true)
  if (!first.ok) return
  expect(first.value.did).toBe(input.did)
  expect(first.value.generation).toBe(1)
  expect(Date.parse(first.value.expiresAt)).toBeLessThanOrEqual(NOW + 5 * 60_000)
  const held = acquire(state, input, NOW)
  expect(held.ok).toBe(false)
  if (!held.ok) expect(held.error._tag).toBe("LeaseHeld")
  const handover = acquire(
    state,
    { ...input, leaseId: first.value.leaseId, generation: first.value.generation },
    NOW,
  )
  expect(handover.ok && handover.value.generation).toBe(2)
  const badRelease = release(state, { did: input.did, leaseId: "stale", generation: 1 }, NOW)
  expect(badRelease.ok).toBe(false)
  if (!badRelease.ok) expect(badRelease.error._tag).toBe("LeaseMismatch")
})

test("retired and unresolved names produce his names, not a generic failure", () => {
  const state = empty()
  const envelope = fixture("send.input").envelope
  state.names.set("old", {
    did: recipient,
    retiredAt: "2026-10-01T00:00:00.000Z",
    successor: "new",
  })
  const retired = send(state, { envelope, resolvedFrom: "old" }, sender, NOW)
  expect(retired.ok).toBe(false)
  if (!retired.ok) expect(retired.error._tag).toBe("Retired")
  const unresolved = send(state, { envelope, resolvedFrom: "missing" }, sender, NOW)
  expect(unresolved.ok).toBe(false)
  if (!unresolved.ok) expect(unresolved.error._tag).toBe("RoleUnresolved")
})
