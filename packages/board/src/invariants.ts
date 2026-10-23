import { Predicate } from "effect"
import { TERMINAL_STATES, type ChitState, type Claim } from "./records.ts"

/*
 * The invariants.
 *
 * These are pure so the same bytes decide the room's fate in a test, in the daemon, and in
 * the SQLite transaction. The hard one is the claim: a process that is merely paused never
 * learns its lease expired, so the room refuses its writes by epoch rather than asking it to
 * stop. Everything else follows from that.
 */

/**
 * Whether a claim is live.
 *
 * @param claim - The claim to test.
 * @param now - Milliseconds, from the room's clock.
 * @returns True while the claim's expiry is in the future.
 */
export const isLive = (claim: Claim, now: number): boolean => claim.expiresAt > now

/**
 * The live claims, in expiry order.
 *
 * @param claims - Every claim known for the room.
 * @param now - Milliseconds, from the room's clock.
 * @returns The claims whose expiry is still in the future.
 */
export const liveClaims = (claims: ReadonlyArray<Claim>, now: number): ReadonlyArray<Claim> =>
  claims.filter((claim) => isLive(claim, now))

/**
 * The chits with more than one live claimant. A non-empty result is a bug, never a tie-break.
 *
 * @param claims - Every claim known for the room.
 * @param now - Milliseconds, from the room's clock.
 * @returns The chit ids with more than one live owner.
 */
export const conflicts = (claims: ReadonlyArray<Claim>, now: number): ReadonlyArray<string> => {
  const groups = new Map<string, number>()
  for (const claim of liveClaims(claims, now)) {
    groups.set(claim.chit, (groups.get(claim.chit) ?? 0) + 1)
  }
  return [...groups].flatMap(([chit, count]) => (count > 1 ? [chit] : []))
}

/**
 * The next epoch: one past every epoch ever seen, including expired ones.
 *
 * @param claims - Every claim known for the chit.
 * @returns The epoch a new claim must carry.
 */
export const nextEpoch = (claims: ReadonlyArray<Claim>): number =>
  claims.reduce((highest, claim) => Math.max(highest, claim.epoch), 0) + 1

/** What an acquisition decided. */
export type AcquireResult =
  | { readonly ok: true; readonly epoch: number }
  | { readonly ok: false; readonly reason: "held"; readonly holder: Claim }

/**
 * Decide whether a host may take a chit.
 *
 * The holder wins while its claim is live. An expired claim is not a holder, but it still
 * counts toward the epoch, so the returning process can never out-write the new owner.
 *
 * @param input - The claims, the room's clock, and the host asking.
 * @returns The epoch granted, or the live holder that refused it.
 */
export const acquire = ({
  claims,
  now,
  host,
}: {
  readonly claims: ReadonlyArray<Claim>
  readonly now: number
  readonly host: string
}): AcquireResult => {
  const live = liveClaims(claims, now)
  const held = live.find((claim) => claim.host !== host)
  if (held !== undefined) return { ok: false, reason: "held", holder: held }
  return { ok: true, epoch: nextEpoch(claims) }
}

/**
 * Whether a chit has stopped moving.
 *
 * @param state - The chit's state.
 * @returns True for a terminal state.
 */
export const isTerminal: Predicate.Predicate<ChitState> = (state) =>
  TERMINAL_STATES.some((terminal) => terminal === state)
