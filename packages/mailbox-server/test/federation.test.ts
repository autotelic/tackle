import { expect, test } from "vitest"
import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core"
import { Host } from "../src/records.ts"
import { sealEnvelope } from "../src/envelope.ts"

const suite = () =>
  new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() })

const NOW = Date.parse("2026-10-04T00:00:00.000Z")

test("a record gets a real at-uri and dag-cbor CID, and resolves across hosts", () => {
  const a = new Host("did:key:zA")
  const b = new Host("did:key:zB")
  const published = a.publish("dev.autotelic.work.ship", "ship-1", {
    bench: "dev-1575",
    sha: "abc",
  })
  expect(published.uri).toBe("at://did:key:zA/dev.autotelic.work.ship/ship-1")
  expect(published.cid.startsWith("bafy")).toBe(true)
  b.ingest(published)
  expect(b.resolve(published.uri)?.record).toEqual(published.record)
  expect(b.resolve(published.cid)?.uri).toBe(published.uri)
})

test("a message and its receipt cross from one host to the other", async () => {
  const a = new Host("did:key:zA")
  const b = new Host("did:key:zB")
  const keys: any = await suite().kem.generateKeyPair()
  const aad = {
    senderDid: a.did,
    recipientDid: b.did,
    messageId: "3jzfcijpj2z2a",
    recipientKeyId: b.did + "#keyAgreement",
    expiresAt: "2026-10-05T00:00:00.000Z",
  }
  const envelope = await sealEnvelope({
    recipientPublicKey: keys.publicKey,
    plaintext: "review please",
    aad,
  })
  const accepted = b.admit(envelope, a.did, NOW)
  expect(accepted.ok).toBe(true)
  if (!accepted.ok) return
  expect(accepted.value.state).toBe("accepted")
  const lease = b.lease(
    {
      did: b.did,
      harness: { $type: "sh.mschf.ratking.runtime.lease#pi" },
      expiresAt: new Date(NOW + 60_000).toISOString(),
    },
    NOW,
  )
  expect(lease.ok).toBe(true)
  if (!lease.ok) return
  const message = { senderDid: a.did, messageId: aad.messageId }
  const delivered = b.delivered(
    {
      message,
      recipientDid: b.did,
      leaseId: lease.value.leaseId,
      generation: lease.value.generation,
    },
    NOW,
  )
  const acked = b.acked(
    {
      message,
      recipientDid: b.did,
      leaseId: lease.value.leaseId,
      generation: lease.value.generation,
    },
    NOW,
  )
  expect(delivered.ok && delivered.value.state).toBe("delivered")
  expect(acked.ok && acked.value.state).toBe("acked")
  // The sender's copy of the receipt is the same record a real mailbox returns.
  expect(accepted.value.seq).toBe(1)
  expect(acked.ok && acked.value.message).toEqual(message)
})
