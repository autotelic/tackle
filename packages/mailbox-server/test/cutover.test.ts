import { expect, test } from "vitest"
import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core"
import { Option } from "effect"
import { Host } from "../src/records.ts"
import { sealEnvelope } from "../src/envelope.ts"

const suite = () =>
  new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() })

/** The first exchange that does not use pi-intercom: a ship record, a review request, a receipt. */
test("TAC-14 and TAC-15 coordinate through the mailbox and records, without intercom", async () => {
  const tac14 = new Host("did:key:zTAC14")
  const tac15 = new Host("did:key:zTAC15")
  const NOW = Date.parse("2026-11-21T00:00:00.000Z")

  const ship = tac14.publish("dev.autotelic.work.ship", "ship-1", {
    bench: "dev-1575",
    commit: "ac3070b",
    checks: ["pnpm check"],
  })
  tac15.ingest(ship)

  const keys: any = await suite().kem.generateKeyPair()
  const aad = {
    senderDid: tac14.did,
    recipientDid: tac15.did,
    messageId: "3jzfcijpj2z2b",
    recipientKeyId: tac15.did + "#keyAgreement",
    expiresAt: "2026-11-22T00:00:00.000Z",
  }
  const envelope = await sealEnvelope({
    recipientPublicKey: keys.publicKey,
    plaintext: `review ${ship.uri} ${ship.cid}`,
    aad,
  })
  const accepted = tac15.admit(envelope, tac14.did, NOW)
  expect(accepted.ok).toBe(true)
  if (!accepted.ok) return

  const lease = tac15.lease(
    {
      did: tac15.did,
      harness: { $type: "sh.mschf.ratking.runtime.lease#pi" },
      expiresAt: new Date(NOW + 60_000).toISOString(),
    },
    NOW,
  )
  if (!lease.ok) throw new Error(lease.error._tag)
  const message = { senderDid: tac14.did, messageId: aad.messageId }
  expect(
    tac15.delivered(
      {
        message,
        recipientDid: tac15.did,
        leaseId: lease.value.leaseId,
        generation: lease.value.generation,
      },
      NOW,
    ).ok,
  ).toBe(true)
  expect(
    tac15.acked(
      {
        message,
        recipientDid: tac15.did,
        leaseId: lease.value.leaseId,
        generation: lease.value.generation,
      },
      NOW,
    ).ok,
  ).toBe(true)

  const answer = tac15.publish("dev.autotelic.work.ack", "ack-1", { message, ship: ship.cid })
  tac14.ingest(answer)
  expect(Option.getOrUndefined(tac14.lookup(answer.cid))?.record).toEqual({
    message,
    ship: ship.cid,
  })
  expect(Option.getOrUndefined(tac14.lookup(ship.cid))?.record).toMatchObject({ commit: "ac3070b" })
})
