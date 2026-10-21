import type {
  Catalog,
  CatalogFeature,
  CatalogHealth,
  DuplicateCluster,
  PartRole,
} from "./catalog.ts"
import {
  decodeDuplicate,
  decodeFeature,
  decodeHealth,
  decodeCluster,
  PART_ROLES,
} from "./catalog.ts"
import { arrayOf, isRecord, num, oneOf, readLexiconRef, str, strings } from "./decode.ts"
import { decodeIntent, hasIntent, type Intent, type PartStatus } from "./intent.ts"
import { lexiconRef, type LexiconRef } from "./lexicon.ts"
import type { TierName } from "./config.ts"
import type { DuplicateCandidate } from "./catalog.ts"

export { decodeIntent, hasIntent, type Intent, type PartStatus } from "./intent.ts"

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
  /** The stable path-derived identity, when the catalog carries one. */
  readonly id?: string
  readonly name: string
  readonly path: string
  readonly tier: TierName
  /** What the part is: component, hook, context, provider, barrel, route, module. */
  readonly kind?: PartRole
  /** Every role it carries; `kind` is the one it is listed under. */
  readonly roles?: ReadonlyArray<PartRole>
  /** The composition feature's directory, when the part belongs to one. */
  readonly feature?: string
  /** The public names a consumer imports from this module, types excluded. */
  readonly exports?: ReadonlyArray<string>
  /** How many modules import it. The adoption signal, beside the inventory one. */
  readonly usedBy?: number
  /** Authored: one line on what this part is for. */
  readonly summary?: string
  /** Authored: the situation this part is the right answer for. */
  readonly whenToUse?: string
  /** Authored: the situation it is the wrong answer for. */
  readonly whenNotToUse?: string
  /** Authored: named states the part handles. */
  readonly states?: ReadonlyArray<string>
  /** Authored: the lifecycle a consumer can rely on. */
  readonly status?: PartStatus
  /** Authored: real call sites or canonical snippets showing approved use. */
  readonly examples?: ReadonlyArray<string>
  /** Derived: the primitive/sub-components and hooks this is composed of. */
  readonly composedOf: ReadonlyArray<string>
  /** Authored: what to use instead, when a near-duplicate or a retirement exists. */
  readonly useInstead?: ReadonlyArray<string>
}

/**
 * The catalog's health, plus the two numbers only authored intent can supply.
 *
 * Inventory is not adoption. A repo can have four hundred parts and almost no UI built
 * from them, and the menu should say so in the same breath as the count.
 */
export interface MenuHealth extends CatalogHealth {
  /** Parts carrying any authored intent. */
  readonly documented: number
  /** Parts marked retired that something still imports. */
  readonly deprecatedInUse: number
}

/** `MENU.md`'s model: the parts list an engineer works from. */
export interface Menu {
  readonly lexicon: LexiconRef
  readonly title: string
  readonly hash: string
  readonly entries: ReadonlyArray<MenuEntry>
  /** Composition features, so a renderer never reaches past the menu into the catalog. */
  readonly features?: ReadonlyArray<CatalogFeature>
  /** Adoption and pressure, in one place a reader can act on. */
  readonly health?: MenuHealth
  /** Near-duplicate clusters, each with the most-used member as its canonical. */
  readonly clusters?: ReadonlyArray<DuplicateCluster>
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
  /**
   * Authored intent, keyed by the part's id (or its name in a catalog that predates ids).
   * Absent means every entry is undocumented.
   */
  readonly intent?: ReadonlyMap<string, Intent>
  readonly title?: string
}

/**
 * The derived half of the menu, joined with the authored half.
 *
 * `id` is the join key: it is derived from the path, so two parts that share a `name`
 * (`Comments`, `types`) do not overwrite each other's intent. The name fallback keeps
 * intent written before ids landed readable; a rebuild only rewrites the generated menu,
 * never a sentence a person wrote.
 */
export const projectMenu = ({ catalog, intent, title = "UI menu" }: MenuProjection): Menu => {
  const entries: ReadonlyArray<MenuEntry> = catalog.components.map((component) => {
    const authored =
      (component.id === undefined ? undefined : intent?.get(component.id)) ??
      intent?.get(component.name)
    return {
      ...(component.id === undefined ? {} : { id: component.id }),
      name: component.name,
      path: component.path,
      tier: component.tier,
      ...(component.kind === undefined ? {} : { kind: component.kind }),
      ...(component.roles === undefined ? {} : { roles: component.roles }),
      ...(component.feature === undefined ? {} : { feature: component.feature }),
      ...(component.exports === undefined ? {} : { exports: component.exports }),
      ...(component.usedBy === undefined ? {} : { usedBy: component.usedBy }),
      ...(authored === undefined ? {} : authored),
      composedOf: composedOf(component.signature),
    }
  })

  const documented = entries.filter((entry) => hasIntent(entry)).length
  const deprecatedInUse = entries.filter(
    (entry) => entry.status === "deprecated" && (entry.usedBy ?? 0) > 0,
  ).length

  return {
    lexicon: lexiconRef("menu"),
    title,
    hash: catalog.hash,
    features: catalog.features ?? [],
    ...(catalog.health === undefined
      ? {}
      : {
          health: {
            ...catalog.health,
            documented,
            deprecatedInUse,
          },
        }),
    ...(catalog.clusters === undefined ? {} : { clusters: catalog.clusters }),
    entries,
    orphans: catalog.orphans,
    duplicates: catalog.duplicates,
  }
}

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
  const id = str(value.id)
  const kind = oneOf(value.kind, PART_ROLES)
  const roles = arrayOf(value.roles, (role) => oneOf(role, PART_ROLES))
  const feature = str(value.feature)
  const exports = strings(value.exports)
  const usedBy = num(value.usedBy)
  const name = str(value.name)
  const path = str(value.path)
  const tier = oneOf(value.tier, TIERS_NAMES)
  const composedOf = strings(value.composedOf)
  if (name === undefined || path === undefined || tier === undefined || composedOf === undefined) {
    return undefined
  }
  return {
    ...(id === undefined ? {} : { id }),
    ...(kind === undefined ? {} : { kind }),
    ...(roles === undefined ? {} : { roles }),
    ...(feature === undefined ? {} : { feature }),
    ...(exports === undefined ? {} : { exports }),
    ...(usedBy === undefined ? {} : { usedBy }),
    ...decodeIntent(value),
    name,
    path,
    tier,
    composedOf,
  }
}

const decodeMenuHealth = (value: unknown): MenuHealth | undefined => {
  const base = decodeHealth(value)
  if (base === undefined || !isRecord(value)) return undefined
  const documented = num(value.documented)
  const deprecatedInUse = num(value.deprecatedInUse)
  if (documented === undefined || deprecatedInUse === undefined) return undefined
  return { ...base, documented, deprecatedInUse }
}

/** Read a menu, or `undefined` when the model is malformed. */
export const decodeMenu = (value: unknown): Menu | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "menu")
  const title = str(value.title)
  const hash = str(value.hash)
  const entries = arrayOf(value.entries, decodeMenuEntry)
  const features = arrayOf(value.features, decodeFeature)
  const health = decodeMenuHealth(value.health)
  const clusters = arrayOf(value.clusters, decodeCluster)
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
  return {
    lexicon,
    title,
    hash,
    entries,
    ...(features === undefined ? {} : { features }),
    ...(health === undefined ? {} : { health }),
    ...(clusters === undefined ? {} : { clusters }),
    orphans,
    duplicates,
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
