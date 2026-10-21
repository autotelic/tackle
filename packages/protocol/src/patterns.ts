import type { LexiconRef } from "./lexicon.ts"
import { PART_ROLES, type PartRole } from "./catalog.ts"
import { arrayOf, isRecord, num, oneOf, readLexiconRef, str, strings } from "./decode.ts"
import { PART_STATUSES, type PartStatus } from "./intent.ts"
import type { TierName } from "./config.ts"

/*
 * The pattern-language view.
 *
 * This is a derived record, not a second model: every field is a catalog fact or an authored
 * intent field. It exists as a lexicon because `jig` reads it from outside cutlist; the seam
 * is the bytes, not an import.
 */

export type PatternKind = "composition" | "primitive" | "shared" | "family"

export interface PatternRelation {
  readonly kind:
    | "uses"
    | "part-of"
    | "variant-of"
    | "replaces"
    | "block"
    | "hook"
    | "context"
    | "provider"
    | "barrel"
  readonly target: string
}

export interface StabilityFactors {
  readonly tier: number
  readonly adoption: number
  readonly ownership: number
  readonly variant: number
  readonly documented: number
}

export interface Pattern {
  readonly id: string
  readonly name: string
  readonly kind: PatternKind
  readonly role?: PartRole
  readonly path: string
  readonly tier: TierName
  readonly feature?: string
  readonly summary?: string
  readonly whenToUse?: string
  readonly whenNotToUse?: string
  readonly states?: ReadonlyArray<string>
  readonly status?: PartStatus
  readonly examples?: ReadonlyArray<string>
  readonly useInstead?: ReadonlyArray<string>
  readonly usedBy: number
  readonly owners: ReadonlyArray<string>
  readonly exports: ReadonlyArray<string>
  readonly composedOf: ReadonlyArray<string>
  readonly blocks?: ReadonlyArray<string>
  readonly hooks?: ReadonlyArray<string>
  readonly valueKeys?: ReadonlyArray<string>
  readonly relations: ReadonlyArray<PatternRelation>
  readonly stability: number
  readonly factors: StabilityFactors
}

export interface Compression {
  readonly orphans: ReadonlyArray<string>
  readonly variants: ReadonlyArray<{
    readonly canonical: string
    readonly members: ReadonlyArray<string>
  }>
  readonly deprecated: ReadonlyArray<string>
}

export interface PatternView {
  readonly lexicon: LexiconRef
  readonly hash: string
  readonly stable: ReadonlyArray<Pattern>
  readonly compositions: ReadonlyArray<Pattern>
  readonly primitives: ReadonlyArray<Pattern>
  readonly shared: ReadonlyArray<Pattern>
  readonly families: ReadonlyArray<Pattern>
  readonly compression: Compression
}

const PATTERN_KINDS: ReadonlyArray<PatternKind> = ["composition", "primitive", "shared", "family"]

const RELATION_KINDS: ReadonlyArray<PatternRelation["kind"]> = [
  "uses",
  "part-of",
  "variant-of",
  "replaces",
  "block",
  "hook",
  "context",
  "provider",
  "barrel",
]

const decodeRelation = (value: unknown): PatternRelation | undefined => {
  if (!isRecord(value)) return undefined
  const kind = oneOf(value.kind, RELATION_KINDS)
  const target = str(value.target)
  if (kind === undefined || target === undefined) return undefined
  return { kind, target }
}

const decodeFactors = (value: unknown): StabilityFactors | undefined => {
  if (!isRecord(value)) return undefined
  const tier = num(value.tier)
  const adoption = num(value.adoption)
  const ownership = num(value.ownership)
  const variant = num(value.variant)
  const documented = num(value.documented)
  if (
    tier === undefined ||
    adoption === undefined ||
    ownership === undefined ||
    variant === undefined ||
    documented === undefined
  ) {
    return undefined
  }
  return { tier, adoption, ownership, variant, documented }
}

/** Read one pattern record, or `undefined` when it is not one. */
export const decodePattern = (value: unknown): Pattern | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const name = str(value.name)
  const kind = oneOf(value.kind, PATTERN_KINDS)
  const path = str(value.path)
  const tier = oneOf(value.tier, ["primitive", "shared", "local"] as const)
  const usedBy = num(value.usedBy)
  const owners = strings(value.owners)
  const exports = strings(value.exports)
  const composedOf = strings(value.composedOf)
  const relations = arrayOf(value.relations, decodeRelation)
  const stability = num(value.stability)
  const factors = decodeFactors(value.factors)
  if (
    id === undefined ||
    name === undefined ||
    kind === undefined ||
    path === undefined ||
    tier === undefined ||
    usedBy === undefined ||
    owners === undefined ||
    exports === undefined ||
    composedOf === undefined ||
    relations === undefined ||
    stability === undefined ||
    factors === undefined
  ) {
    return undefined
  }
  const role = "role" in value ? oneOf(value.role, PART_ROLES) : undefined
  if ("role" in value && role === undefined) return undefined
  const status = "status" in value ? oneOf(value.status, PART_STATUSES) : undefined
  if ("status" in value && status === undefined) return undefined
  const blocks = "blocks" in value ? strings(value.blocks) : undefined
  const hooks = "hooks" in value ? strings(value.hooks) : undefined
  const valueKeys = "valueKeys" in value ? strings(value.valueKeys) : undefined
  const states = "states" in value ? strings(value.states) : undefined
  const examples = "examples" in value ? strings(value.examples) : undefined
  const useInstead = "useInstead" in value ? strings(value.useInstead) : undefined
  const feature = str(value.feature)
  const summary = str(value.summary)
  const whenToUse = str(value.whenToUse)
  const whenNotToUse = str(value.whenNotToUse)
  return {
    id,
    name,
    kind,
    path,
    tier,
    usedBy,
    owners,
    exports,
    composedOf,
    relations,
    stability,
    factors,
    ...(role === undefined ? {} : { role }),
    ...(status === undefined ? {} : { status }),
    ...(blocks === undefined ? {} : { blocks }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(valueKeys === undefined ? {} : { valueKeys }),
    ...(states === undefined ? {} : { states }),
    ...(examples === undefined ? {} : { examples }),
    ...(useInstead === undefined ? {} : { useInstead }),
    ...(feature === undefined ? {} : { feature }),
    ...(summary === undefined ? {} : { summary }),
    ...(whenToUse === undefined ? {} : { whenToUse }),
    ...(whenNotToUse === undefined ? {} : { whenNotToUse }),
  }
}

const decodeCompression = (value: unknown): Compression | undefined => {
  if (!isRecord(value)) return undefined
  const orphans = strings(value.orphans)
  const deprecated = strings(value.deprecated)
  const variants = arrayOf(value.variants, (entry) => {
    if (!isRecord(entry)) return undefined
    const canonical = str(entry.canonical)
    const members = strings(entry.members)
    if (canonical === undefined || members === undefined) return undefined
    return { canonical, members }
  })
  if (orphans === undefined || deprecated === undefined || variants === undefined) return undefined
  return { orphans, variants, deprecated }
}

/** Read a pattern-language view, or `undefined` when the bytes are not one. */
export const decodePatternView = (value: unknown): PatternView | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "patterns")
  const hash = str(value.hash)
  const stable = arrayOf(value.stable, decodePattern)
  const compositions = arrayOf(value.compositions, decodePattern)
  const primitives = arrayOf(value.primitives, decodePattern)
  const shared = arrayOf(value.shared, decodePattern)
  const families = arrayOf(value.families, decodePattern)
  const compression = decodeCompression(value.compression)
  if (
    lexicon === undefined ||
    hash === undefined ||
    stable === undefined ||
    compositions === undefined ||
    primitives === undefined ||
    shared === undefined ||
    families === undefined ||
    compression === undefined
  ) {
    return undefined
  }
  return {
    lexicon,
    hash,
    stable,
    compositions,
    primitives,
    shared,
    families,
    compression,
  }
}
