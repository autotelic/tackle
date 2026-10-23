import { Schema } from "effect"

/*
 * The records, as schemas.
 *
 * These are the bytes. A room, a daemon, or a second client can decode them without sharing
 * a runtime: `Schema` is the contract, and the TypeScript types are derived from it so the
 * two cannot drift.
 *
 * Five nouns and one rule. A **chit** is a unit of work (a review thread, a build, an
 * external change). A **claim** is the right to act on it, carrying a fencing epoch. A
 * **job** is one dispatch of a machine. A **receipt** is a fact that happened, appended
 * after the effect. A **presence** is a heartbeat with a TTL.
 *
 * The rule: no effect without an older intent, no claim without a live epoch, no chit
 * without exactly one owner.
 */

/** Where a chit is. The first nine are the happy path; the rest are why the ledger exists. */
export const CHIT_STATES = [
  "open",
  "claimed",
  "working",
  "blocked",
  "proposed",
  "in_review",
  "changes",
  "approved",
  "merged",
  "deployed",
  "closed",
  "orphaned",
  "abandoned",
] as const

/** A chit's state. */
export type ChitState = (typeof CHIT_STATES)[number]

/** A chit in one of these has stopped moving, and may only be reopened by a human. */
export const TERMINAL_STATES = ["closed", "abandoned"] as const

/** What a chit is. A build precedes a thread; an external change may arrive with neither. */
export const CHIT_KINDS = ["build", "thread", "review", "external"] as const

/** A chit's kind. */
export type ChitKind = (typeof CHIT_KINDS)[number]

/** The address a chit can be picked up from. A build has none; a thread has all of it. */
export const Anchor = Schema.Struct({
  pr: Schema.Finite,
  sha: Schema.String,
  path: Schema.optionalKey(Schema.String),
  line: Schema.optionalKey(Schema.Finite),
  commentId: Schema.optionalKey(Schema.Finite),
})

/** A chit. */
export const Chit = Schema.Struct({
  id: Schema.String,
  room: Schema.String,
  ticket: Schema.String,
  kind: Schema.Literals(CHIT_KINDS),
  state: Schema.Literals(CHIT_STATES),
  anchor: Schema.optionalKey(Anchor),
  layer: Schema.optionalKey(Schema.Finite),
  updatedAt: Schema.Finite,
})

/** The address a chit can be picked up from. */
export type Anchor = typeof Anchor.Type

/** A unit of work. */
export type Chit = typeof Chit.Type

/** The right to act on a chit, with a fencing epoch and an expiry. */
export const Claim = Schema.Struct({
  chit: Schema.String,
  room: Schema.String,
  host: Schema.String,
  actor: Schema.String,
  epoch: Schema.Finite,
  expiresAt: Schema.Finite,
})

/** A claim. */
export type Claim = typeof Claim.Type

/** What a job is. */
export const JOB_KINDS = ["review", "fix", "build"] as const

/** A job's kind. */
export type JobKind = (typeof JOB_KINDS)[number]

/** Where a job is. */
export const JOB_STATES = ["queued", "claimed", "running", "done", "failed", "skipped"] as const

/** A job's state. */
export type JobState = (typeof JOB_STATES)[number]

/** One dispatch of a machine. */
export const Job = Schema.Struct({
  id: Schema.String,
  room: Schema.String,
  kind: Schema.Literals(JOB_KINDS),
  pr: Schema.Finite,
  sha: Schema.String,
  state: Schema.Literals(JOB_STATES),
  host: Schema.optionalKey(Schema.String),
  attempts: Schema.Finite,
  createdAt: Schema.Finite,
  updatedAt: Schema.Finite,
  note: Schema.optionalKey(Schema.String),
})

/** A job. */
export type Job = typeof Job.Type

/** A fact that happened, appended after the effect. `kind` is dotted, like `review.posted`. */
export const Receipt = Schema.Struct({
  id: Schema.String,
  room: Schema.String,
  at: Schema.Finite,
  kind: Schema.String,
  chit: Schema.optionalKey(Schema.String),
  job: Schema.optionalKey(Schema.String),
  actor: Schema.optionalKey(Schema.String),
  host: Schema.optionalKey(Schema.String),
  payload: Schema.optionalKey(Schema.Json),
})

/** A receipt. */
export type Receipt = typeof Receipt.Type

/** A heartbeat. The TTL is the only thing that makes a host unreachable without a goodbye. */
export const Presence = Schema.Struct({
  host: Schema.String,
  room: Schema.String,
  actor: Schema.String,
  at: Schema.Finite,
  ttl: Schema.Finite,
  session: Schema.optionalKey(Schema.String),
})

/** A presence. */
export type Presence = typeof Presence.Type
