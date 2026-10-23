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

/** A room's identity: the Linear project and the stage it runs at. */
export type RoomId = string
/** The person a token belongs to. */
export type ActorId = string
/** One daemon on one machine. */
export type HostId = string
/** One dispatch of a machine. */
export type JobId = string
/** One unit of work. */
export type ChitId = string

const bare = (value: string): string => value.trim().toLowerCase()

/**
 * The stage a local room runs at.
 *
 * @param login - The GitHub login the token belongs to.
 * @returns `local/<login>`.
 */
export const stageOf = (login: string): string => `local/${bare(login)}`

/**
 * The identity of the person a token belongs to.
 *
 * @param login - The GitHub login.
 * @returns `github:<login>`.
 */
export const actorOf = (login: string): ActorId => `github:${bare(login)}`

/**
 * One daemon on one machine, acting as one person.
 *
 * @param input - The login and the hostname.
 * @returns `<login>@<hostname>`.
 */
export const hostOf = (input: { readonly login: string; readonly hostname: string }): HostId =>
  `${bare(input.login)}@${bare(input.hostname)}`

/**
 * A room is one Linear project at one stage. The project id is Linear's, not a slug.
 *
 * @param input - The project id and the stage.
 * @returns `linear:<projectId>@<stage>`.
 */
export const roomOf = (input: { readonly projectId: string; readonly stage: string }): RoomId =>
  `linear:${input.projectId.trim()}@${input.stage}`

/**
 * The stable key a review job is deduplicated by.
 *
 * @param input - The pull request number and the head SHA.
 * @returns `pr:<number>:<sha prefix>`.
 */
export const jobOf = (input: { readonly pr: number; readonly sha: string }): JobId =>
  `pr:${input.pr}:${input.sha.slice(0, 12)}`

/**
 * A thread is the work; its anchor is the address a follow-up session can start from.
 *
 * @param input - The ticket, PR, path, and line.
 * @returns `<ticket>@<pr>#<path>:<line>`.
 */
export const chitOf = (input: {
  readonly ticket: string
  readonly pr: number
  readonly path: string
  readonly line: number
}): ChitId => `${bare(input.ticket)}@${input.pr}#${input.path}:${input.line}`

/**
 * Before a thread exists, the ticket itself is the chit.
 *
 * @param ticket - The Linear identifier.
 * @returns `<ticket>@build`.
 */
export const buildChitOf = (ticket: string): ChitId => `${bare(ticket)}@build`

/**
 * The marker a bot review carries.
 *
 * Two rooms watching the same repository must be able to tell whose review this was, and a
 * re-request must be able to tell whether the head SHA was already reviewed. The marker is
 * an HTML comment so it is invisible in the rendered review and exact in the API.
 *
 * @param input - The room and the head SHA.
 * @returns The HTML comment the daemon posts and reads.
 */
export const markerOf = (input: { readonly room: RoomId; readonly sha: string }): string =>
  `<!-- room:${input.room} sha:${input.sha.slice(0, 12)} -->`
