/*
 * Identities.
 *
 * Every id in a room is derived from something a provider already owns, so two machines can
 * compute the same one without asking each other:
 *
 *   room   linear:<projectId>@<stage>      the project is Linear's; the stage is where it runs
 *   actor  github:<login>                  the token that will post, not `git config`
 *   host   <login>@<hostname>              one daemon instance
 *   job    pr:<number>:<headSha>           exactly-once by identity, not by retry
 *   chit   <ticket>@<pr>#<path>:<line>     the review thread is the unit of work
 *
 * The ids are strings on purpose. A room may be a SQLite file today and a Durable Object
 * tomorrow; nothing in the wire format needs to know which.
 */

export type RoomId = string
export type ActorId = string
export type HostId = string
export type JobId = string
export type ChitId = string

/** Lowercase and trim; ids are compared, never displayed as-is. */
const bare = (value: string): string => value.trim().toLowerCase()

/** A stage is where a room runs: `local/<login>` now, `prod` when it is shared. */
export const stageOf = (login: string): string => `local/${bare(login)}`

/** The identity of the person a token belongs to. */
export const actorOf = (login: string): ActorId => `github:${bare(login)}`

/** One daemon on one machine, acting as one person. */
export const hostOf = (login: string, hostname: string): HostId =>
  `${bare(login)}@${bare(hostname)}`

/** A room is one Linear project at one stage. The project id is Linear's, not a slug. */
export const roomOf = (projectId: string, stage: string): RoomId =>
  `linear:${projectId.trim()}@${stage}`

/** The stable key a review job is deduplicated by. */
export const jobOf = (pr: number, sha: string): JobId => `pr:${pr}:${sha.slice(0, 12)}`

/** A thread is the work; its anchor is the address a follow-up session can start from. */
export const chitOf = (ticket: string, pr: number, path: string, line: number): ChitId =>
  `${bare(ticket)}@${pr}#${path}:${line}`

/** Before a thread exists, the ticket itself is the chit. */
export const buildChitOf = (ticket: string): ChitId => `${bare(ticket)}@build`

/**
 * The marker a bot review carries.
 *
 * Two rooms watching the same repository must be able to tell whose review this was, and a
 * re-request must be able to tell whether the head SHA was already reviewed. The marker is
 * an HTML comment so it is invisible in the rendered review and exact in the API.
 */
export const markerOf = (room: RoomId, sha: string): string =>
  `<!-- room:${room} sha:${sha.slice(0, 12)} -->`

/** A short, stable fingerprint for a directory name. Not security; just a namespace. */
export const fingerprintOf = (value: string): string => {
  let hash = 0
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0
  }
  return (hash >>> 0).toString(36)
}
