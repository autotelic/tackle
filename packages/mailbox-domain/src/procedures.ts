export interface Envelope {
  readonly version: number
  readonly suite: { readonly kemId: number; readonly kdfId: number; readonly aeadId: number }
  readonly enc: { readonly $bytes: string }
  readonly ciphertext: { readonly $bytes: string }
  readonly aad: {
    readonly senderDid: string
    readonly recipientDid: string
    readonly messageId: string
    readonly recipientKeyId: string
    readonly expiresAt: string
  }
}

export interface MessageRef {
  readonly senderDid: string
  readonly messageId: string
}

export interface Receipt {
  readonly message: MessageRef
  readonly recipientDid: string
  readonly state: DeliveryState
  readonly seq: number
  readonly recordedAt?: string
  readonly woke?: boolean
}

export type DeliveryState = "accepted" | "delivered" | "acked"

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

const stable = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(stable).join(",") + "]"
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + stable((value as Record<string, unknown>)[k]))
        .join(",") +
      "}"
    )
  return JSON.stringify(value)
}

const ok = <A>(value: A): Result<A> => ({ ok: true, value })
const fail = <A>(error: Failure): Result<A> => ({ ok: false, error })

/** Lease expiry is the only clock in the procedures; callers pass it. */
const live = (lease: Lease | undefined, now: number): lease is Lease =>
  lease !== undefined && Date.parse(lease.expiresAt) > now

const fence = (
  state: MailboxState,
  did: string,
  leaseId?: string,
  generation?: number,
  now = 0,
): Failure | undefined => {
  const lease = state.leases.get(did)
  if (!live(lease, now)) return undefined
  if (leaseId !== lease.leaseId || generation !== lease.generation) return { _tag: "LeaseMismatch" }
  return undefined
}

const senderFence = (
  state: MailboxState,
  input: SendInput,
  actorDid: string,
  now: number,
): Failure | undefined => {
  const lease = state.leases.get(actorDid)
  if (!live(lease, now)) return undefined
  if (input.leaseId !== lease.leaseId || input.generation !== lease.generation)
    return { _tag: "LeaseMismatch" }
  return undefined
}

export interface SendInput {
  readonly envelope: unknown
  readonly leaseId?: string
  readonly generation?: number
  readonly woke?: boolean
  readonly resolvedFrom?: string
}

/** Admit a send, idempotently on the sender DID plus TID. */
/** The shape an admitted send must have; a plaintext body is not a wire envelope. */
export const isEncryptedEnvelope = (value: unknown): value is Envelope => {
  if (value === null || typeof value !== "object") return false
  const candidate = value as Partial<Envelope>
  return (
    candidate.version === 1 &&
    candidate.suite !== undefined &&
    candidate.enc !== undefined &&
    candidate.ciphertext !== undefined &&
    candidate.aad !== undefined
  )
}

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

  const fenceError = senderFence(state, input, actorDid, now)
  if (fenceError !== undefined) return fail(fenceError)

  const key = keyOf({ senderDid: aad.senderDid, messageId: aad.messageId })
  const existing = state.messages.get(key)
  if (existing !== undefined) {
    if (stable(existing.envelope) !== stable(input.envelope)) return fail({ _tag: "Conflict" })
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
  const fenceError = fence(state, input.recipientDid, input.leaseId, input.generation, now)
  if (fenceError !== undefined) return fail(fenceError)
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
  const fenceError = fence(state, input.recipientDid, input.leaseId, input.generation, now)
  if (fenceError !== undefined) return fail(fenceError)
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
  input: { did: string; leaseId: string; generation: number },
  now: number,
): Result<void> => {
  const fenceError = fence(state, input.did, input.leaseId, input.generation, now)
  if (fenceError !== undefined) return fail(fenceError)
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
