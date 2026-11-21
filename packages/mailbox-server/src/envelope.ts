import { Aes128Gcm, CipherSuite, DhkemP256HkdfSha256, HkdfSha256 } from "@hpke/core"

export interface Aad {
  readonly senderDid: string
  readonly recipientDid: string
  readonly messageId: string
  readonly recipientKeyId: string
  readonly expiresAt: string
}

export interface EncryptedEnvelope {
  readonly version: 1
  readonly suite: { readonly kemId: 16; readonly kdfId: 1; readonly aeadId: 1 }
  readonly enc: { readonly $bytes: string }
  readonly ciphertext: { readonly $bytes: string }
  readonly aad: Aad
}

const suite = () =>
  new CipherSuite({ kem: new DhkemP256HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes128Gcm() })

const bytes = (value: ArrayBuffer | Uint8Array): string =>
  Buffer.from(value instanceof Uint8Array ? value : new Uint8Array(value)).toString("base64")
const fromBytes = (value: string): Uint8Array => new Uint8Array(Buffer.from(value, "base64"))
const aadBytes = (aad: Aad): Uint8Array => new TextEncoder().encode(JSON.stringify(aad))

/** Sign-then-encrypt: the caller signs the plaintext; this seals the signed bytes. */
export const sealEnvelope = async (input: {
  readonly recipientPublicKey: any
  readonly plaintext: string
  readonly aad: Aad
}): Promise<EncryptedEnvelope> => {
  const s = await suite().createSenderContext({ recipientPublicKey: input.recipientPublicKey })
  const ciphertext = await s.seal(new TextEncoder().encode(input.plaintext), aadBytes(input.aad))
  return {
    version: 1,
    suite: { kemId: 16, kdfId: 1, aeadId: 1 },
    enc: { $bytes: bytes(s.enc) },
    ciphertext: { $bytes: bytes(ciphertext) },
    aad: input.aad,
  }
}

/** Open an envelope with the recipient's private key; a foreign key fails, never guesses. */
export const openEnvelope = async (input: {
  readonly recipientPrivateKey: any
  readonly envelope: EncryptedEnvelope
}): Promise<string> => {
  const r = await suite().createRecipientContext({
    recipientKey: input.recipientPrivateKey,
    enc: fromBytes(input.envelope.enc.$bytes),
  })
  const plaintext = await r.open(
    fromBytes(input.envelope.ciphertext.$bytes),
    aadBytes(input.envelope.aad),
  )
  return new TextDecoder().decode(plaintext)
}
