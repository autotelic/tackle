import type { ActorId, ChitId, HostId, JobId, RoomId } from "./ids.ts"

/*
 * The records.
 *
 * Five nouns and one rule. A **chit** is a unit of work (a review thread, a build, an
 * external change). A **claim** is the right to act on it, carrying a fencing epoch. A
 * **job** is one dispatch of a machine (a review, a fix). A **receipt** is a fact that
 * happened, appended after the effect. A **presence** is a heartbeat with a TTL.
 *
 * The rule: no effect without an older intent, no claim without a live epoch, no chit
 * without exactly one owner.
 */

/** Where a chit is. The happy path is the first nine; the rest are why the ledger exists. */
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

export type ChitState = (typeof CHIT_STATES)[number]

/** A chit in one of these has stopped moving, and may only be reopened by a human. */
export const TERMINAL_STATES: ReadonlyArray<ChitState> = ["closed", "abandoned"]

export const isTerminal = (state: ChitState): boolean => TERMINAL_STATES.includes(state)

/** What a chit is. A build precedes a thread; an external change may arrive with neither. */
export const CHIT_KINDS = ["build", "thread", "review", "external"] as const
export type ChitKind = (typeof CHIT_KINDS)[number]

/** The address a chit can be picked up from. A build has none; a thread has all of it. */
export interface Anchor {
  readonly pr: number
  readonly sha: string
  readonly path?: string
  readonly line?: number
  readonly commentId?: number
}

export interface Chit {
  readonly id: ChitId
  readonly room: RoomId
  readonly ticket: string
  readonly kind: ChitKind
  readonly state: ChitState
  readonly anchor?: Anchor
  /** The topological rank of the PR in its base chain. The review queue is a layer. */
  readonly layer?: number
  readonly updatedAt: number
}

export interface Claim {
  readonly chit: ChitId
  readonly room: RoomId
  readonly host: HostId
  readonly actor: ActorId
  /** Monotonic per chit. A write carrying an older epoch is refused, never merged. */
  readonly epoch: number
  readonly expiresAt: number
}

export const JOB_KINDS = ["review", "fix", "build"] as const
export type JobKind = (typeof JOB_KINDS)[number]

export const JOB_STATES = ["queued", "claimed", "running", "done", "failed", "skipped"] as const
export type JobState = (typeof JOB_STATES)[number]

export interface Job {
  readonly id: JobId
  readonly room: RoomId
  readonly kind: JobKind
  readonly pr: number
  readonly sha: string
  readonly state: JobState
  readonly host?: HostId
  readonly attempts: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly note?: string
}

/** A receipt is what a replay reads. `kind` is dotted, like `review.posted`. */
export interface Receipt {
  readonly id: string
  readonly room: RoomId
  readonly at: number
  readonly kind: string
  readonly chit?: ChitId
  readonly job?: JobId
  readonly actor?: ActorId
  readonly host?: HostId
  readonly payload?: Readonly<Record<string, unknown>>
}

/** A heartbeat. The TTL is the only thing that makes a host unreachable without a goodbye. */
export interface Presence {
  readonly host: HostId
  readonly room: RoomId
  readonly actor: ActorId
  readonly at: number
  readonly ttl: number
  readonly session?: string
}
