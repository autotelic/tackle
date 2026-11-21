import { Option, Schema } from "effect"
import stringify from "safe-stable-stringify"

const AadSchema = Schema.Struct({
  senderDid: Schema.String,
  recipientDid: Schema.String,
  messageId: Schema.String,
  recipientKeyId: Schema.String,
  expiresAt: Schema.String,
})

const EnvelopeSchema = Schema.Struct({
  version: Schema.Literal(1),
  suite: Schema.Struct({
    kemId: Schema.Literal(16),
    kdfId: Schema.Literal(1),
    aeadId: Schema.Literal(1),
  }),
  enc: Schema.Struct({ $bytes: Schema.String }),
  ciphertext: Schema.Struct({ $bytes: Schema.String }),
  aad: AadSchema,
})

export type Aad = typeof AadSchema.Type
export type Envelope = typeof EnvelopeSchema.Type

export interface MessageRef {
  readonly senderDid: string
  readonly messageId: string
}

/** The delivery states Rat King's receipt carries, in order. */
// The wire state is a string in the receipt, not a local dispatch discriminant.
// oxlint-disable-next-line plumb-effect/prefer-tagged-enum
export type DeliveryState = "accepted" | "delivered" | "acked"

export interface Receipt {
  readonly message: MessageRef
  readonly recipientDid: string
  readonly state: DeliveryState
  readonly seq: number
  readonly recordedAt?: string
  readonly woke?: boolean
}

/** The harness that holds a lease; known adapters add their ids. */
export interface Harness {
  readonly $type: string
  readonly sessionId?: string
  readonly paneId?: string
  readonly executionId?: string
}

export interface Lease {
  readonly did: string
  readonly leaseId: string
  readonly generation: number
  readonly expiresAt: string
  readonly harness: Harness
}

export interface NameRecord {
  readonly did: string
  readonly retiredAt?: string
  readonly successor?: string
}

export interface StoredMessage {
  readonly envelope: Envelope
  readonly receipt: Receipt
  readonly state: DeliveryState
}

export interface MailboxState {
  readonly messages: Map<string, StoredMessage>
  readonly leases: Map<string, Lease>
  readonly names: Map<string, NameRecord>
  seq: number
}

/** A fresh mailbox with no messages, leases or names. */
export const empty = (): MailboxState => ({
  messages: new Map(),
  leases: new Map(),
  names: new Map(),
  seq: 0,
})

/** The admission key: one sender DID plus one TID. */
export const keyOf = (ref: MessageRef): string => ref.senderDid + "\u0000" + ref.messageId

export type Failure =
  | { readonly _tag: "Conflict" }
  | { readonly _tag: "LeaseMismatch" }
  | { readonly _tag: "LeaseHeld" }
  | { readonly _tag: "Retired"; readonly detail: string }
  | { readonly _tag: "RoleUnresolved" }
  | { readonly _tag: "MessageNotFound" }
  | { readonly _tag: "InvalidTransition"; readonly from: DeliveryState; readonly to: DeliveryState }
  | { readonly _tag: "UnsupportedEnvelope" }

export type Result<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly error: Failure }

const ok = <A>(value: A): Result<A> => ({ ok: true, value })
const fail = <A>(error: Failure): Result<A> => ({ ok: false, error })

/** Lease expiry is the only clock in the procedures; callers pass it. */
const live = (lease: Lease | undefined, now: number): lease is Lease =>
  lease !== undefined && Date.parse(lease.expiresAt) > now

const fence = (input: {
  readonly state: MailboxState
  readonly did: string
  readonly leaseId: string | undefined
  readonly generation: number | undefined
  readonly now: number
}): Option.Option<Failure> => {
  const lease = input.state.leases.get(input.did)
  return live(lease, input.now) &&
    (input.leaseId !== lease.leaseId || input.generation !== lease.generation)
    ? Option.some({ _tag: "LeaseMismatch" })
    : Option.none()
}

export interface SendInput {
  readonly envelope: unknown
  readonly leaseId?: string
  readonly generation?: number
  readonly woke?: boolean
  readonly resolvedFrom?: string
}

/** The shape an admitted send must have; a plaintext body is not a wire envelope. */
export const isEncryptedEnvelope: (value: unknown) => value is Envelope = Schema.is(EnvelopeSchema)

/** Admit a send, idempotently on the sender DID plus TID. */
export const send = (
  state: MailboxState,
  input: SendInput,
  actorDid: string,
  now: number,
): Result<Receipt> => {
  if (!isEncryptedEnvelope(input.envelope)) return fail({ _tag: "UnsupportedEnvelope" })
  const aad = input.envelope.aad
  if (aad.senderDid !== actorDid) return fail({ _tag: "RoleUnresolved" })

  if (input.resolvedFrom !== undefined) {
    const record = state.names.get(input.resolvedFrom)
    if (record === undefined) return fail({ _tag: "RoleUnresolved" })
    if (record.retiredAt !== undefined)
      return fail({
        _tag: "Retired",
        detail: `${input.resolvedFrom} was retired at ${record.retiredAt}; current row is ${record.successor ?? "none"}`,
      })
    if (record.did !== aad.recipientDid) return fail({ _tag: "RoleUnresolved" })
  }

  const senderError = fence({
    state,
    did: actorDid,
    leaseId: input.leaseId,
    generation: input.generation,
    now,
  })
  if (Option.isSome(senderError)) return fail(senderError.value)

  const key = keyOf({ senderDid: aad.senderDid, messageId: aad.messageId })
  const existing = state.messages.get(key)
  if (existing !== undefined) {
    if (stringify(existing.envelope) !== stringify(input.envelope))
      return fail({ _tag: "Conflict" })
    return ok(existing.receipt)
  }

  state.seq += 1
  const receipt: Receipt = {
    message: { senderDid: aad.senderDid, messageId: aad.messageId },
    recipientDid: aad.recipientDid,
    state: "accepted",
    seq: state.seq,
    recordedAt: new Date(now).toISOString(),
    woke: input.woke === undefined ? false : input.woke,
  }
  state.messages.set(key, { envelope: input.envelope, receipt, state: "accepted" })
  return ok(receipt)
}

export interface DeliverInput {
  readonly message: MessageRef
  readonly recipientDid: string
  readonly leaseId: string
  readonly generation: number
}

/** Move an accepted message to delivered under the recipient's fence. */
export const deliver = (state: MailboxState, input: DeliverInput, now: number): Result<Receipt> => {
  const fenceError = fence({
    state,
    did: input.recipientDid,
    leaseId: input.leaseId,
    generation: input.generation,
    now,
  })
  if (Option.isSome(fenceError)) return fail(fenceError.value)
  const key = keyOf(input.message)
  const stored = state.messages.get(key)
  if (stored === undefined) return fail({ _tag: "MessageNotFound" })
  if (stored.state === "acked")
    return fail({ _tag: "InvalidTransition", from: "acked", to: "delivered" })
  if (stored.state === "delivered") return ok(stored.receipt)
  state.seq += 1
  const receipt: Receipt = { ...stored.receipt, state: "delivered", seq: state.seq }
  state.messages.set(key, { ...stored, receipt, state: "delivered" })
  return ok(receipt)
}

export interface AckInput {
  readonly message: MessageRef
  readonly recipientDid: string
  readonly leaseId: string
  readonly generation: number
}

/** Move a delivered message to acked; an ack before deliver is InvalidTransition. */
export const ack = (state: MailboxState, input: AckInput, now: number): Result<Receipt> => {
  const fenceError = fence({
    state,
    did: input.recipientDid,
    leaseId: input.leaseId,
    generation: input.generation,
    now,
  })
  if (Option.isSome(fenceError)) return fail(fenceError.value)
  const key = keyOf(input.message)
  const stored = state.messages.get(key)
  if (stored === undefined) return fail({ _tag: "MessageNotFound" })
  if (stored.state === "acked") return ok(stored.receipt)
  if (stored.state !== "delivered")
    return fail({ _tag: "InvalidTransition", from: stored.state, to: "acked" })
  state.seq += 1
  const receipt: Receipt = { ...stored.receipt, state: "acked", seq: state.seq }
  state.messages.set(key, { ...stored, receipt, state: "acked" })
  return ok(receipt)
}

export interface AcquireInput {
  readonly did: string
  readonly harness: Harness
  readonly expiresAt: string
  readonly leaseId?: string
  readonly generation?: number
}

const FIVE_MINUTES = 5 * 60 * 1000

/** Acquire or hand over the per-DID lease; expiresAt is clamped to five minutes. */
export const acquire = (state: MailboxState, input: AcquireInput, now: number): Result<Lease> => {
  const current = state.leases.get(input.did)
  if (live(current, now)) {
    const handover = input.leaseId === current.leaseId && input.generation === current.generation
    if (!handover) return fail({ _tag: "LeaseHeld" })
  }
  const generation = current === undefined ? 1 : current.generation + 1
  const expiresAt = new Date(
    Math.min(Date.parse(input.expiresAt), now + FIVE_MINUTES),
  ).toISOString()
  const lease: Lease = {
    did: input.did,
    leaseId: `${input.did.split(":").at(-1) ?? "lease"}-${generation}`,
    generation,
    expiresAt,
    harness: input.harness,
  }
  state.leases.set(input.did, lease)
  return ok(lease)
}

/** Release a lease only with its current fence. */
export const release = (
  state: MailboxState,
  input: { readonly did: string; readonly leaseId: string; readonly generation: number },
  now: number,
): Result<void> => {
  const fenceError = fence({
    state,
    did: input.did,
    leaseId: input.leaseId,
    generation: input.generation,
    now,
  })
  if (Option.isSome(fenceError)) return fail(fenceError.value)
  state.leases.delete(input.did)
  return ok(undefined)
}

/** One page of a recipient's log after a sequence number. */
export const list = (state: MailboxState, input: { recipientDid: string; afterSeq: number }) => {
  const events = [...state.messages.values()]
    .filter((m) => m.receipt.recipientDid === input.recipientDid && m.receipt.seq > input.afterSeq)
    .sort((a, b) => a.receipt.seq - b.receipt.seq)
    .map((m) => ({
      $type: "sh.mschf.ratking.defs#receiptEvent",
      seq: m.receipt.seq,
      receipt: m.receipt,
    }))
  return { events, throughSeq: state.seq }
}
