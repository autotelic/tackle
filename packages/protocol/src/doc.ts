import type { TierName } from "./config.ts"
import type { DuplicateCandidate } from "./catalog.ts"

/*
 * The document seam: the parts of the catalog and the onboarding that a human or an
 * agent reads.
 *
 * Half of a catalog entry is derivable — what a component is composed of is the
 * resolved imports and called hooks. The other half is authored intent — what it is
 * FOR and what you should reach for instead — which no deterministic tool can
 * produce. cutlist's job is to make the authored half cheap: fill the derived half,
 * scaffold the entry, and flag the absence of the intent half.
 */

/** One component's row in the menu. */
export interface MenuEntry {
  readonly name: string
  readonly path: string
  readonly tier: TierName
  /** Authored: one line on when to reach for this. */
  readonly summary?: string
  /** Derived: the primitive/sub-components and hooks this is composed of. */
  readonly composedOf: ReadonlyArray<string>
  /** Authored: what to use instead, when a near-duplicate exists. */
  readonly useInstead?: ReadonlyArray<string>
}

/** `MENU.md`'s model: the parts list an engineer works from. */
export interface Menu {
  readonly protocolVersion: string
  readonly title: string
  readonly hash: string
  readonly entries: ReadonlyArray<MenuEntry>
  readonly orphans: ReadonlyArray<string>
  readonly duplicates: ReadonlyArray<DuplicateCandidate>
}

/**
 * The agent door: a repo-local prompt that is simultaneously the client engineer's
 * documentation, the client agent's system-prompt fragment, and the thing a review
 * surface diffs. One artifact, three readers.
 */
export interface Onboarding {
  readonly protocolVersion: string
  readonly title: string
  readonly prompt: string
}
