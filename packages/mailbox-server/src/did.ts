import { Data, Schema } from "effect"

// A did:key is a multicodec tag and a raw public key in base58btc. Only Ed25519 is used for
// signatures here; the encryption key travels as recipientKeyId, not as the signing DID.
const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
const ED25519 = [0xed, 0x01] as const

/** A malformed DID or document is a named failure, not prose. */
export class DidError extends Data.TaggedError("DidError")<{ readonly detail: string }> {}

const fail = (detail: string): never => {
  throw new DidError({ detail })
}

const encodeBase58 = (bytes: Uint8Array): string => {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  let out = ""
  while (value > 0n) {
    out = BASE58[Number(value % 58n)]! + out
    value /= 58n
  }
  for (const byte of bytes) {
    if (byte !== 0) break
    out = "1" + out
  }
  return out
}

const decodeBase58 = (text: string): Uint8Array => {
  let value = 0n
  for (const char of text) {
    const digit = BASE58.indexOf(char)
    if (digit < 0) return fail("invalid base58")
    value = value * 58n + BigInt(digit)
  }
  const bytes: number[] = []
  while (value > 0n) {
    bytes.unshift(Number(value & 0xffn))
    value >>= 8n
  }
  for (const char of text) {
    if (char !== "1") break
    bytes.unshift(0)
  }
  return Uint8Array.from(bytes)
}

/** Encode a raw Ed25519 public key as a did:key. */
export const didKeyFromEd25519 = (raw: Uint8Array): string =>
  "did:key:z" + encodeBase58(Uint8Array.from([...ED25519, ...raw]))

/** Decode a did:key to its raw Ed25519 public key. */
export const ed25519FromDidKey = (did: string): Uint8Array => {
  if (!did.startsWith("did:key:z")) return fail("did:key with base58btc required")
  const bytes = decodeBase58(did.slice("did:key:z".length))
  if (bytes[0] !== ED25519[0] || bytes[1] !== ED25519[1]) return fail("not an Ed25519 did:key")
  const raw = bytes.slice(2)
  if (raw.length !== 32) return fail("Ed25519 key must be 32 bytes")
  return raw
}

// SAFETY: WebCrypto keys are opaque; the caller generated them with the Ed25519 algorithm.
/** Sign bytes with an Ed25519 key. */
export const signDetached = async (input: {
  readonly privateKey: any
  readonly data: Uint8Array
}): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.sign("Ed25519", input.privateKey, input.data))

/** Verify bytes against a raw Ed25519 public key from a did:key. */
export const verifyDetached = async (input: {
  readonly did: string
  readonly data: Uint8Array
  readonly signature: Uint8Array
}): Promise<boolean> => {
  const raw = ed25519FromDidKey(input.did)
  const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"])
  return crypto.subtle.verify("Ed25519", key, input.signature, input.data)
}

/** The URL a did:web document lives at; a port is percent-encoded in the DID. */
export const didWebUrl = (did: string): string => {
  if (!did.startsWith("did:web:")) return fail("not a did:web")
  const parts = did.slice("did:web:".length).split(":")
  const host = decodeURIComponent(parts[0] ?? "")
  const path = parts.slice(1).map(decodeURIComponent).join("/")
  // Loopback tests serve plain HTTP; a real did:web is HTTPS only.
  const scheme = host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https"
  return `${scheme}://${host}/${path === "" ? "" : path + "/"}did.json`
}

/** The multibase form of an Ed25519 key, as a DID document carries it. */
export const multibaseFromEd25519 = (raw: Uint8Array): string =>
  "z" + encodeBase58(Uint8Array.from([...ED25519, ...raw]))

const DidDocument = Schema.Struct({
  verificationMethod: Schema.optional(
    Schema.Array(Schema.Struct({ publicKeyMultibase: Schema.optional(Schema.String) })),
  ),
})

/** Resolve a did:web document and return its Ed25519 verification key. */
export const resolveDidWeb = async (did: string): Promise<Uint8Array> => {
  const response = await fetch(didWebUrl(did))
  if (!response.ok) return fail(`did:web ${did}: HTTP ${response.status}`)
  const document = Schema.decodeUnknownSync(DidDocument)(await response.json())
  const multibase = document.verificationMethod?.[0]?.publicKeyMultibase
  if (multibase === undefined || !multibase.startsWith("z"))
    return fail("did:web: no multibase key")
  const bytes = decodeBase58(multibase.slice(1))
  if (bytes[0] !== ED25519[0] || bytes[1] !== ED25519[1]) return fail("did:web: not Ed25519")
  return bytes.slice(2)
}

/** Verify with either identity method; the signature check does not branch on trust. */
export const verifyDid = async (input: {
  readonly did: string
  readonly data: Uint8Array
  readonly signature: Uint8Array
}): Promise<boolean> => {
  const raw = input.did.startsWith("did:web:")
    ? await resolveDidWeb(input.did)
    : ed25519FromDidKey(input.did)
  const key = await crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"])
  return crypto.subtle.verify("Ed25519", key, input.signature, input.data)
}
