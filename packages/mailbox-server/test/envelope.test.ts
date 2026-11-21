import { expect, test } from "vitest"
import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core"
import {
  didKeyFromEd25519,
  ed25519FromDidKey,
  multibaseFromEd25519,
  signDetached,
  verifyDetached,
  verifyDid,
} from "../src/did.ts"
import { openEnvelope, sealEnvelope } from "../src/envelope.ts"
import { empty, send } from "@autotelic/mailbox-domain/procedures"

const suite = () =>
  new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() })

const aad = {
  senderDid: "did:key:zSender",
  recipientDid: "did:key:zRecipient",
  messageId: "3jzfcijpj2z2a",
  recipientKeyId: "did:key:zRecipient#keyAgreement",
  expiresAt: "2026-10-05T00:00:00.000Z",
}

test("HPKE seals and opens; a foreign key fails", async () => {
  const keys: any = await suite().kem.generateKeyPair()
  const other: any = await suite().kem.generateKeyPair()
  const envelope = await sealEnvelope({
    recipientPublicKey: keys.publicKey,
    plaintext: "hello",
    aad,
  })
  await expect(openEnvelope({ recipientPrivateKey: keys.privateKey, envelope })).resolves.toBe(
    "hello",
  )
  await expect(
    openEnvelope({ recipientPrivateKey: other.privateKey, envelope }),
  ).rejects.toBeDefined()
})

test("did:key round-trips an Ed25519 key and verifies only its own signatures", async () => {
  const keys: any = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const other: any = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))
  const did = didKeyFromEd25519(raw)
  expect(ed25519FromDidKey(did)).toEqual(raw)
  const data = new TextEncoder().encode("a signed turn")
  const signature = await signDetached(keys.privateKey, data)
  await expect(verifyDetached(did, data, signature)).resolves.toBe(true)
  const otherRaw = new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey))
  await expect(verifyDetached(didKeyFromEd25519(otherRaw), data, signature)).resolves.toBe(false)
})

test("a plaintext body is not an envelope and is refused", () => {
  const result = send(
    empty(),
    { envelope: { body: "hello" } },
    "did:key:zSender",
    Date.parse("2026-10-04T00:00:00.000Z"),
  )
  expect(result.ok).toBe(false)
  if (!result.ok) expect(result.error._tag).toBe("UnsupportedEnvelope")
})

test("a did:web document resolves and verifies, and only its key verifies", async () => {
  const keys: any = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const other: any = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey))
  const document = { verificationMethod: [{ publicKeyMultibase: multibaseFromEd25519(raw) }] }
  const server = await import("node:http").then(
    (http) =>
      new Promise<any>((resolve) => {
        const s = http.createServer((_req, res) => {
          res.writeHead(200, { "content-type": "application/json" })
          res.end(JSON.stringify(document))
        })
        s.listen(0, "127.0.0.1", () => resolve(s))
      }),
  )
  try {
    const port = server.address().port
    const did = `did:web:127.0.0.1%3A${port}`
    const data = new TextEncoder().encode("did:web turn")
    const signature = await signDetached(keys.privateKey, data)
    await expect(verifyDid(did, data, signature)).resolves.toBe(true)
    const otherRaw = new Uint8Array(await crypto.subtle.exportKey("raw", other.publicKey))
    expect(otherRaw).not.toEqual(raw)
  } finally {
    server.close()
  }
})
