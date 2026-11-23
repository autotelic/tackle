import { join } from "node:path"
import * as Schema from "effect/Schema"

/**
 * One port a room holds.
 *
 * The room's file is the record: a lease that is not written down next to the room it belongs to
 * is a suggestion, not an ownership claim. `leasedAt` is epoch milliseconds, the clock every
 * other room timestamp uses, so a lease can be compared with the room's own history.
 */
export const PortLease = Schema.Struct({
  number: Schema.Int,
  leasedAt: Schema.Int,
})
export type PortLease = typeof PortLease.Type

/**
 * The exclusive claim file for one port.
 *
 * Allocation needs one atomic step, and the file system already has one: create the claim with
 * `wx`. Two `up`s racing for the same range therefore cannot both believe they own a port,
 * without this package growing a lock of its own. A claim is only live while the room it names
 * still leases that number; otherwise it is the debris of a crash and is reclaimed.
 */
export const PortClaim = Schema.Struct({
  room: Schema.String,
  at: Schema.Int,
})
export type PortClaim = typeof PortClaim.Type

/**
 * The ports a room may lease.
 *
 * A contiguous block keeps the projection readable and stays below the board's own 4780, so the
 * shop and its rooms never compete for one number by default. The range is per root: the root is
 * the shop, its board lock and its rooms share one world, and a second root is a second shop.
 */
export const portRange = { first: 4400, last: 4499 } as const

/** The directory holding one claim file per leased port. */
export const portsDir = (root: string): string => join(root, "ports")

/** The claim file for one port. */
export const portClaimFile = (input: { readonly root: string; readonly port: number }): string =>
  join(portsDir(input.root), input.port + ".json")
