import { encode } from "@ipld/dag-cbor"
import { Option } from "effect"
import { createHash } from "node:crypto"
import {
  ack,
  acquire,
  deliver,
  empty,
  send,
  type Envelope,
  type MailboxState,
  type Receipt,
} from "@autotelic/mailbox-domain/procedures"

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567"

const base32 = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31]!
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31]!
  return out
}

/** A DAG-CBOR value: the record shape AT repositories carry. */
export type DagValue =
  | string
  | number
  | boolean
  | null
  | ReadonlyArray<DagValue>
  | { readonly [key: string]: DagValue }

/** A CIDv1 in dag-cbor, sha2-256, base32: the same bytes as IPFS/AT use. */
export const recordCid = (record: DagValue): string => {
  const digest = createHash("sha256").update(encode(record)).digest()
  const bytes = Uint8Array.from([0x01, 0x71, 0x12, 0x20, ...digest])
  return "b" + base32(bytes)
}

export interface Published {
  readonly uri: string
  readonly cid: string
  readonly record: DagValue
}

export class Host {
  readonly state: MailboxState = empty()
  readonly records = new Map<string, Published>()
  readonly byCid = new Map<string, Published>()

  readonly did: string

  constructor(did: string) {
    this.did = did
  }

  publish(collection: string, rkey: string, record: DagValue): Published {
    const published: Published = {
      uri: `at://${this.did}/${collection}/${rkey}`,
      cid: recordCid({ record, did: this.did, collection, rkey }),
      record,
    }
    this.records.set(published.uri, published)
    this.byCid.set(published.cid, published)
    return published
  }

  /** A record received from another host; resolution is by the same URI and CID. */
  ingest(published: Published): void {
    this.records.set(published.uri, published)
    this.byCid.set(published.cid, published)
  }

  lookup(key: string): Option.Option<Published> {
    const found = this.records.get(key) ?? this.byCid.get(key)
    return found === undefined ? Option.none() : Option.some(found)
  }

  admit(envelope: Envelope, actorDid: string, now: number): ReturnType<typeof send> {
    return send(this.state, { envelope }, actorDid, now)
  }

  delivered(input: Parameters<typeof deliver>[1], now: number) {
    return deliver(this.state, input, now)
  }

  acked(input: Parameters<typeof ack>[1], now: number): ReturnType<typeof ack> {
    return ack(this.state, input, now)
  }

  lease(input: Parameters<typeof acquire>[1], now: number) {
    return acquire(this.state, input, now)
  }
}

export type { Receipt }
