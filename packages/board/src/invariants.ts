import type { Claim } from "./records.ts"

/*
 * The invariants.
 *
 * These are pure so the same bytes decide the room's fate in a test, in the daemon, and in
 * the SQLite transaction. The hard one is the claim: a process that is merely paused never
 * learns its lease expired, so the room must refuse its writes by epoch rather than asking
 * it to stop. Everything else follows from that.
 */

/** A claim is live until its expiry. `now` is milliseconds, from one clock. */
export const isLive = (claim: Claim, now: number): boolean => claim.expiresAt > now

export const liveClaims = (claims: ReadonlyArray<Claim>, now: number): ReadonlyArray<Claim> =>
  claims.filter((claim) => isLive(claim, now))

/** Claims grouped by chit. Used by the conflict check and by the daemon's view. */
export const byChit = (claims: ReadonlyArray<Claim>): ReadonlyMap<string, ReadonlyArray<Claim>> => {
  const groups = new Map<string, Array<Claim>>()
  for (const claim of claims) {
    const list = groups.get(claim.chit)
    if (list === undefined) groups.set(claim.chit, [claim])
    else list.push(claim)
  }
  return groups
}

/** A chit may have exactly one live claimant. More than one is a bug, never a tie-break. */
export const conflicts = (claims: ReadonlyArray<Claim>, now: number): ReadonlyArray<string> =>
  [...byChit(liveClaims(claims, now))].filter(([, group]) => group.length > 1).map(([chit]) => chit)

/** The next epoch is one past every epoch ever seen, including expired ones. */
export const nextEpoch = (claims: ReadonlyArray<Claim>): number =>
  claims.reduce((highest, claim) => Math.max(highest, claim.epoch), 0) + 1

export type AcquireResult =
  | { readonly ok: true; readonly epoch: number }
  | { readonly ok: false; readonly reason: "held"; readonly holder: Claim }

/**
 * Decide whether a host may take a chit.
 *
 * The holder wins while its claim is live. An expired claim is not a holder, but it still
 * counts toward the epoch, so the returning process can never out-write the new owner.
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
