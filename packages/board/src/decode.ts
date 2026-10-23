import type { Chit, Claim, Job, Presence, Receipt } from "./records.ts"
import { CHIT_KINDS, CHIT_STATES, JOB_KINDS, JOB_STATES } from "./records.ts"

/*
 * Readers.
 *
 * A room reads its own SQLite, a JSON file, or a webhook body; any of them may be stale,
 * hand-edited, or from one version earlier. These readers degrade to `undefined` rather than
 * throwing, and a record that says nothing usable is `undefined` — never a half-object that
 * looks authoritative downstream.
 */

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined

export const int = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined

export const oneOf = <T extends string>(
  value: unknown,
  options: ReadonlyArray<T>,
): T | undefined =>
  typeof value === "string" && (options as ReadonlyArray<string>).includes(value)
    ? (value as T)
    : undefined

const anchorOf = (value: unknown): Chit["anchor"] | undefined => {
  if (!isRecord(value)) return undefined
  const pr = int(value.pr)
  const sha = str(value.sha)
  if (pr === undefined || sha === undefined) return undefined
  const path = str(value.path)
  const line = int(value.line)
  const commentId = int(value.commentId)
  return {
    pr,
    sha,
    ...(path === undefined ? {} : { path }),
    ...(line === undefined ? {} : { line }),
    ...(commentId === undefined ? {} : { commentId }),
  }
}

export const decodeChit = (value: unknown): Chit | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const room = str(value.room)
  const ticket = str(value.ticket)
  const kind = oneOf(value.kind, CHIT_KINDS)
  const state = oneOf(value.state, CHIT_STATES)
  if (id === undefined || room === undefined || ticket === undefined) return undefined
  if (kind === undefined || state === undefined) return undefined
  const anchor = anchorOf(value.anchor)
  const layer = int(value.layer)
  const updatedAt = int(value.updatedAt) ?? 0
  return {
    id,
    room,
    ticket,
    kind,
    state,
    updatedAt,
    ...(anchor === undefined ? {} : { anchor }),
    ...(layer === undefined ? {} : { layer }),
  }
}

export const decodeClaim = (value: unknown): Claim | undefined => {
  if (!isRecord(value)) return undefined
  const chit = str(value.chit)
  const room = str(value.room)
  const host = str(value.host)
  const actor = str(value.actor)
  const epoch = int(value.epoch)
  const expiresAt = int(value.expiresAt)
  if (
    chit === undefined ||
    room === undefined ||
    host === undefined ||
    actor === undefined ||
    epoch === undefined ||
    expiresAt === undefined
  ) {
    return undefined
  }
  return { chit, room, host, actor: actor as Claim["actor"], epoch, expiresAt }
}

export const decodeJob = (value: unknown): Job | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const room = str(value.room)
  const kind = oneOf(value.kind, JOB_KINDS)
  const state = oneOf(value.state, JOB_STATES)
  const pr = int(value.pr)
  const sha = str(value.sha)
  if (
    id === undefined ||
    room === undefined ||
    kind === undefined ||
    state === undefined ||
    pr === undefined ||
    sha === undefined
  ) {
    return undefined
  }
  const host = str(value.host)
  const note = str(value.note)
  return {
    id,
    room,
    kind,
    state,
    pr,
    sha,
    attempts: int(value.attempts) ?? 0,
    createdAt: int(value.createdAt) ?? 0,
    updatedAt: int(value.updatedAt) ?? 0,
    ...(host === undefined ? {} : { host }),
    ...(note === undefined ? {} : { note }),
  }
}

export const decodeReceipt = (value: unknown): Receipt | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const room = str(value.room)
  const kind = str(value.kind)
  if (id === undefined || room === undefined || kind === undefined) return undefined
  const chit = str(value.chit)
  const job = str(value.job)
  const actor = str(value.actor)
  const host = str(value.host)
  const payload = isRecord(value.payload) ? value.payload : undefined
  return {
    id,
    room,
    kind,
    at: int(value.at) ?? 0,
    ...(chit === undefined ? {} : { chit }),
    ...(job === undefined ? {} : { job }),
    ...(actor === undefined ? {} : { actor: actor as Exclude<Receipt["actor"], undefined> }),
    ...(host === undefined ? {} : { host }),
    ...(payload === undefined ? {} : { payload }),
  }
}

export const decodePresence = (value: unknown): Presence | undefined => {
  if (!isRecord(value)) return undefined
  const host = str(value.host)
  const room = str(value.room)
  const actor = str(value.actor)
  if (host === undefined || room === undefined || actor === undefined) return undefined
  const session = str(value.session)
  return {
    host,
    room,
    actor: actor as Presence["actor"],
    at: int(value.at) ?? 0,
    ttl: int(value.ttl) ?? 0,
    ...(session === undefined ? {} : { session }),
  }
}
