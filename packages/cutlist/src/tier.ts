import { Predicate } from "effect"
import type { TierName } from "@autotelic/protocol"
import { underAnyRoot } from "./paths.ts"

/*
 * Pass 4 — tier.
 *
 * Trivial GIVEN the graph, which is the point: the hard part is the owner attribution
 * in owners.ts, not this. A component under a primitive root is a primitive whatever
 * imports it. Otherwise two or more route owners make it shared, one makes it local, and
 * a component under a shared root with no route owners is shared (it is where shared
 * things live). Zero owners is an orphan, computed separately — an orphan is a fact
 * about the graph, not a tier.
 */

export interface TierOptions {
  readonly roots: ReadonlyArray<string>
  readonly primitiveRoots: ReadonlyArray<string>
  readonly sharedRoots: ReadonlyArray<string>
  readonly localRoots: ReadonlyArray<string>
}

/** The tier a component sits in, given its owners. */
export const tierOf = (
  modulePath: string,
  owners: ReadonlyArray<string>,
  options: TierOptions,
): TierName => {
  if (
    underAnyRoot({
      modulePath,
      roots: options.roots,
      targets: options.primitiveRoots,
    })
  ) {
    return "primitive"
  }
  const routeOwners = owners.filter((owner) => owner !== "shared")
  if (routeOwners.length >= 2) return "shared"
  if (routeOwners.length === 1) return "local"
  if (
    underAnyRoot({
      modulePath,
      roots: options.roots,
      targets: options.sharedRoots,
    })
  ) {
    return "shared"
  }
  return "local"
}

/** A component nothing imports. Often a flattened copy of a shared one. */
export const isOrphan: Predicate.Predicate<ReadonlyArray<string>> = (owners) => owners.length === 0
