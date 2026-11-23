/*
 * The Rat King mailbox procedures, as plain types and pure decisions.
 *
 * This is the protocol layer: no Effect runtime, no IO, no dependency. The server and
 * the room are free to add their own decoders; the wire shape and the state machine are
 * here so they cannot disagree about either.
 */

export interface Aad {
  readonly senderDid: string
  readonly recipientDid: string
  readonly messageId: string
  readonly recipientKeyId: string
  readonly expiresAt: string
}

export interface Envelope {
  readonly version: 1
  readonly suite: {
    readonly kemId: 16
    readonly kdfId: 1
    readonly aeadId: 1
  }
  readonly enc: { readonly $bytes: string }
  readonly ciphertext: { readonly $bytes: string }
  readonly aad: Aad
}

export interface MessageRef {
  readonly senderDid: string
  readonly messageId: string
}

/** The delivery states Rat King's receipt carries, in order. */
export type DeliveryState = "accepted" | "delivered" | "acked"

export interface Receipt {
  readonly message: MessageRef
  readonly recipientDid: string
  readonly state: DeliveryState
  readonly seq: number
  readonly recordedAt?: string | undefined
  readonly woke?: boolean | undefined
}

/** The harness that holds a lease; known adapters add their ids. */
export interface Harness {
  readonly $type: string
  readonly sessionId?: string | undefined
  readonly paneId?: string | undefined
  readonly executionId?: string | undefined
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
  readonly retiredAt?: string | undefined
  readonly successor?: string | undefined
}

export interface StoredMessage {
  readonly envelope: Envelope
  readonly receipt: Receipt
  readonly state: DeliveryState
}

/** The snapshot shape: maps become arrays so the mailbox can be a file. */
export interface MailboxSnapshot {
  readonly messages: ReadonlyArray<{ readonly key: string; readonly value: StoredMessage }>
  readonly leases: ReadonlyArray<{ readonly key: string; readonly value: Lease }>
  readonly names: ReadonlyArray<{ readonly key: string; readonly value: NameRecord }>
  readonly seq: number
}

export interface MailboxState {
  readonly messages: Map<string, StoredMessage>
  readonly leases: Map<string, Lease>
  readonly names: Map<string, NameRecord>
  seq: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const isString = (value: unknown): value is string => typeof value === "string"
const isNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value)
const isState = (value: unknown): value is DeliveryState =>
  value === "accepted" || value === "delivered" || value === "acked"

/** The shape an admitted send must have; a plaintext body is not a wire envelope. */
export const isEncryptedEnvelope = (value: unknown): value is Envelope => {
  if (!isRecord(value) || value.version !== 1) return false
  const suite = value.suite
  if (!isRecord(suite) || suite.kemId !== 16 || suite.kdfId !== 1 || suite.aeadId !== 1)
    return false
  const enc = value.enc
  const ciphertext = value.ciphertext
  const aad = value.aad
  if (!isRecord(enc) || !isString(enc.$bytes)) return false
  if (!isRecord(ciphertext) || !isString(ciphertext.$bytes)) return false
  if (!isRecord(aad)) return false
  return (
    isString(aad.senderDid) &&
    isString(aad.recipientDid) &&
    isString(aad.messageId) &&
    isString(aad.recipientKeyId) &&
    isString(aad.expiresAt)
  )
}

const isHarness = (value: unknown): value is Harness =>
  isRecord(value) &&
  isString(value.$type) &&
  (value.sessionId === undefined || isString(value.sessionId)) &&
  (value.paneId === undefined || isString(value.paneId)) &&
  (value.executionId === undefined || isString(value.executionId))

const isReceipt = (value: unknown): value is Receipt => {
  if (!isRecord(value) || !isRecord(value.message)) return false
  return (
    isString(value.message.senderDid) &&
    isString(value.message.messageId) &&
    isString(value.recipientDid) &&
    isState(value.state) &&
    isNumber(value.seq) &&
    (value.recordedAt === undefined || isString(value.recordedAt)) &&
    (value.woke === undefined || typeof value.woke === "boolean")
  )
}

const isLease = (value: unknown): value is Lease =>
  isRecord(value) &&
  isString(value.did) &&
  isString(value.leaseId) &&
  isNumber(value.generation) &&
  isString(value.expiresAt) &&
  isHarness(value.harness)

const isNameRecord = (value: unknown): value is NameRecord =>
  isRecord(value) &&
  isString(value.did) &&
  (value.retiredAt === undefined || isString(value.retiredAt)) &&
  (value.successor === undefined || isString(value.successor))

const entryOf = <A>(
  value: unknown,
  check: (item: unknown) => item is A,
): { key: string; value: A } | undefined => {
  if (!isRecord(value) || !isString(value.key) || !check(value.value)) return undefined
  return { key: value.key, value: value.value }
}

const entriesOf = <A>(
  value: unknown,
  check: (item: unknown) => item is A,
): ReadonlyArray<{ key: string; value: A }> | undefined => {
  if (!Array.isArray(value)) return undefined
  const entries: Array<{ key: string; value: A }> = []
  for (const item of value) {
    const entry = entryOf(item, check)
    if (entry === undefined) return undefined
    entries.push(entry)
  }
  return entries
}

const isStoredMessage = (value: unknown): value is StoredMessage =>
  isRecord(value) &&
  isEncryptedEnvelope(value.envelope) &&
  isReceipt(value.receipt) &&
  isState(value.state)

/** Decode a snapshot, returning undefined rather than throwing at the boundary. */
export const decodeMailboxSnapshot = (value: unknown): MailboxSnapshot | undefined => {
  if (!isRecord(value) || !isNumber(value.seq)) return undefined
  const messages = entriesOf(value.messages, isStoredMessage)
  const leases = entriesOf(value.leases, isLease)
  const names = entriesOf(value.names, isNameRecord)
  if (messages === undefined || leases === undefined || names === undefined) return undefined
  return { messages, leases, names, seq: value.seq }
}

/** A fresh mailbox with no messages, leases or names. */
export const empty = (): MailboxState => ({
  messages: new Map(),
  leases: new Map(),
  names: new Map(),
  seq: 0,
})

/** Canonical JSON for the envelope equality check: sorted keys, no dependency. */
const stableStringify = (value: unknown): string => {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort)
    if (entry === null || typeof entry !== "object") return entry
    if (!isRecord(entry)) return entry
    return Object.fromEntries(
      Object.entries(entry)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, sort(item)]),
    )
  }
  return JSON.stringify(sort(value)) ?? "undefined"
}

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
}): Failure | undefined => {
  const lease = input.state.leases.get(input.did)
  return live(lease, input.now) &&
    (input.leaseId !== lease.leaseId || input.generation !== lease.generation)
    ? { _tag: "LeaseMismatch" }
    : undefined
}

export interface SendInput {
  readonly envelope: unknown
  readonly leaseId?: string
  readonly generation?: number
  readonly woke?: boolean
  readonly resolvedFrom?: string
}
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
  if (senderError !== undefined) return fail(senderError)

  const key = keyOf({ senderDid: aad.senderDid, messageId: aad.messageId })
  const existing = state.messages.get(key)
  if (existing !== undefined) {
    if (stableStringify(existing.envelope) !== stableStringify(input.envelope))
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
  const fenceError = fence({
    state,
    did: input.recipientDid,
    leaseId: input.leaseId,
    generation: input.generation,
    now,
  })
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
