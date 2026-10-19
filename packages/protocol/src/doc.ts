import type { Catalog } from "./catalog.ts"
import { decodeDuplicate } from "./catalog.ts"
import { arrayOf, isRecord, oneOf, readLexiconRef, str, strings } from "./decode.ts"
import { lexiconRef, type LexiconRef } from "./lexicon.ts"
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
 *
 * So the menu is a MIXED record and says so: `composedOf`, `orphans`, `duplicates` and
 * `hash` are derived and regenerated; `summary` and `useInstead` are authored and are the
 * only reason the menu is not simply a rendering. `MENU.md` is the rendering; this record is
 * the model. The authored half is stored in `intent/<name>.json` and joined in by
 * `projectMenu`, so regenerating the menu can never overwrite a sentence a person wrote.
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

/**
 * The authored half of a menu entry, as it is stored in `intent/<name>.json`.
 *
 * This is the one part of the artifact a tool cannot derive, and the reason the menu is
 * not merely a rendering. It lives in its own file so `cutlist build` can replace the
 * generated menu without ever touching a sentence a person wrote, and so a rename shows
 * up as a stale file instead of silently discarding the intent.
 */
export interface Intent {
  /** One line on when to reach for this part. */
  readonly summary?: string
  /** What to reach for instead, when a near-duplicate exists. */
  readonly useInstead?: ReadonlyArray<string>
}

/** `MENU.md`'s model: the parts list an engineer works from. */
export interface Menu {
  readonly lexicon: LexiconRef
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
  readonly lexicon: LexiconRef
  readonly title: string
  readonly prompt: string
}

/** What a component is made of, from its skeleton: rendered tags and called hooks. */
export const composedOf = (signature: ReadonlyArray<string>): ReadonlyArray<string> => {
  const parts = new Set<string>()
  for (const part of signature) {
    if (part.startsWith("tag:")) parts.add(part.slice(4))
    else if (part.startsWith("hook:")) parts.add(part.slice(5))
  }
  return [...parts]
}

/** What `projectMenu` needs: the derived model, and whatever a person has written about it. */
export interface MenuProjection {
  readonly catalog: Catalog
  /** Authored intent, keyed by the part's name. Absent means every entry is undocumented. */
  readonly intent?: ReadonlyMap<string, Intent>
  readonly title?: string
}

/**
 * The derived half of the menu, joined with the authored half.
 *
 * The join is by `name` — the only identity a component carries today. When stable ids
 * land, this is the single place the key changes, which is why the join lives here and
 * not in a renderer.
 */
export const projectMenu = ({ catalog, intent, title = "UI menu" }: MenuProjection): Menu => ({
  lexicon: lexiconRef("menu"),
  title,
  hash: catalog.hash,
  entries: catalog.components.map((component) => {
    const authored = intent?.get(component.name)
    return {
      name: component.name,
      path: component.path,
      tier: component.tier,
      ...(authored?.summary === undefined ? {} : { summary: authored.summary }),
      composedOf: composedOf(component.signature),
      ...(authored?.useInstead === undefined ? {} : { useInstead: authored.useInstead }),
    }
  }),
  orphans: catalog.orphans,
  duplicates: catalog.duplicates,
})

/*
 * Decoders — untrusted input in, a model or an empty one out.
 *
 * The menu carries authored fields, so a malformed row must not silently drop an author's
 * sentence. `decodeMenu` returns `undefined` for a malformed model rather than an empty
 * menu: "there is no menu" and "this menu is unreadable" are different facts, and the
 * caller decides which is safe.
 */

const TIERS_NAMES: ReadonlyArray<TierName> = ["primitive", "shared", "local"]

/** Read one menu entry, or `undefined` when malformed. */
export const decodeMenuEntry = (value: unknown): MenuEntry | undefined => {
  if (!isRecord(value)) return undefined
  const name = str(value.name)
  const path = str(value.path)
  const tier = oneOf(value.tier, TIERS_NAMES)
  const composedOf = strings(value.composedOf)
  if (name === undefined || path === undefined || tier === undefined || composedOf === undefined) {
    return undefined
  }
  const summary = str(value.summary)
  const useInstead = strings(value.useInstead)
  return {
    name,
    path,
    tier,
    composedOf,
    ...(summary === undefined ? {} : { summary }),
    ...(useInstead === undefined ? {} : { useInstead }),
  }
}

/** Read a menu, or `undefined` when the model is malformed. */
export const decodeMenu = (value: unknown): Menu | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "menu")
  const title = str(value.title)
  const hash = str(value.hash)
  const entries = arrayOf(value.entries, decodeMenuEntry)
  const orphans = strings(value.orphans)
  const duplicates = arrayOf(value.duplicates, decodeDuplicate)
  if (
    lexicon === undefined ||
    title === undefined ||
    hash === undefined ||
    entries === undefined ||
    orphans === undefined ||
    duplicates === undefined
  ) {
    return undefined
  }
  return { lexicon, title, hash, entries, orphans, duplicates }
}

/**
 * Read one intent record, or `undefined` when it says nothing usable.
 *
 * An empty object is a miss, not an empty intent: a file that carries neither a summary
 * nor alternatives is a file someone forgot to fill in, and treating it as authored
 * would hide that from the `_(undocumented)_` flag.
 */
export const decodeIntent = (value: unknown): Intent | undefined => {
  if (!isRecord(value)) return undefined
  const summary = str(value.summary)
  const useInstead = strings(value.useInstead)
  if (summary === undefined && useInstead === undefined) return undefined
  return {
    ...(summary === undefined ? {} : { summary }),
    ...(useInstead === undefined ? {} : { useInstead }),
  }
}

/** Read the onboarding prompt, or `undefined` when malformed. */
export const decodeOnboarding = (value: unknown): Onboarding | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "onboarding")
  const title = str(value.title)
  const prompt = str(value.prompt)
  if (lexicon === undefined || title === undefined || prompt === undefined) return undefined
  return { lexicon, title, prompt }
}
