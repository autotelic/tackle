/*
 * The lexicon registry: the name and version of every record that crosses a boundary.
 *
 * A record is a JSON document one tool writes and another reads. Its lexicon is the
 * contract — `report`, `baseline`, `catalog` — and the name is what both ends agree on,
 * not the file that happens to hold it. Each lexicon versions on its own line, so
 * `report` can evolve without forcing every reader of `baseline` to re-reason.
 *
 * The evolution rule this registry exists to enforce, in the bytes and not just in prose:
 *
 *   Once a lexicon is in the wild you may ADD AN OPTIONAL FIELD. You may never change
 *   whether a field is optional, never remove one, and never reinterpret existing bytes.
 *   A breaking change is a NEW LEXICON NAME.
 *
 * `fixtures/compat/` holds the frozen records that rule is checked against; the
 * lexicon-compat linter (scripts/lexicon-compat.mjs) fails the build when a schema change
 * would invalidate one. See `compat.ts` for the pure half.
 *
 * Kind is who owns the truth, not who writes the file:
 *   - `authored`  a human or agent writes it; it is the source of truth.
 *   - `derived`   a tool regenerates it; it is never hand-edited.
 *   - `accepted`  derived from a run, then committed as a ratchet (the baseline).
 *
 * This module is pure data and pure predicates. No I/O, no dependencies, no behavior
 * beyond the format's own semantics.
 */

/** Every lexicon name. Adding one is the breaking-change escape hatch. */
export const LEXICON_NAMES = [
  "report",
  "baseline",
  "catalog",
  "manifest",
  "menu",
  "intent",
  "patterns",
  "recipes",
  "onboarding",
  "cutlist.config",
  "jig.config",
] as const

/** The name of a record's contract. */
export type LexiconName = (typeof LEXICON_NAMES)[number]

/** Who owns the truth behind a lexicon. */
export type LexiconKind = "authored" | "derived" | "accepted"

/** One lexicon, as the registry knows it. */
export interface Lexicon {
  readonly name: LexiconName
  /** The schema version, bumped on any published shape change (additive included). */
  readonly version: number
  readonly kind: LexiconKind
  /** The package that is the source of truth for the record's meaning. */
  readonly owner: string
  /** Repository-relative path to the language-neutral JSON Schema. */
  readonly schema: string
  /** Repository-relative directory holding the golden and malformed fixtures. */
  readonly fixture: string
  /** One sentence a stranger can act on. */
  readonly summary: string
}

/**
 * The reference a tool-written record carries: which lexicon, at which version.
 *
 * It lives INSIDE the record rather than in a sidecar so a reader that only has the
 * bytes — a script in another language, a future tool replacing `plumb` — can tell what
 * it is holding without a registry lookup. The registry is how our own readers resolve
 * the name; the bytes are how everyone else does.
 */
export interface LexiconRef {
  readonly name: LexiconName
  readonly version: number
}

const lexicons: Readonly<Record<LexiconName, Lexicon>> = {
  report: {
    name: "report",
    version: 1,
    kind: "derived",
    owner: "@autotelic/jig-cli",
    schema: "schema/report.json",
    fixture: "fixtures/report",
    summary: "One run, across every engine, in one oxlint-shaped diagnostic stream.",
  },
  baseline: {
    name: "baseline",
    version: 1,
    kind: "accepted",
    owner: "@autotelic/jig-cli",
    schema: "schema/baseline.json",
    fixture: "fixtures/baseline",
    summary: "The findings a repository has already accepted, keyed by identity.",
  },
  catalog: {
    name: "catalog",
    version: 1,
    kind: "derived",
    owner: "@autotelic/cutlist",
    schema: "schema/catalog.json",
    fixture: "fixtures/catalog",
    summary: "The model cutlist computes once and renders many ways.",
  },
  manifest: {
    name: "manifest",
    version: 1,
    kind: "derived",
    owner: "@autotelic/cutlist",
    schema: "schema/manifest.json",
    fixture: "fixtures/manifest",
    summary: "The lint-facing projection of the catalog that plumb-ui parses.",
  },
  menu: {
    name: "menu",
    version: 1,
    kind: "derived",
    owner: "@autotelic/cutlist",
    schema: "schema/menu.json",
    fixture: "fixtures/menu",
    summary: "The parts list a reader works from: derived composition, authored intent.",
  },
  intent: {
    name: "intent",
    version: 1,
    kind: "authored",
    owner: "@autotelic/cutlist",
    schema: "schema/intent.json",
    fixture: "fixtures/intent",
    summary: "The authored half of a part: what it is for, when it is wrong, and its lifecycle.",
  },
  patterns: {
    name: "patterns",
    version: 1,
    kind: "derived",
    owner: "@autotelic/cutlist",
    schema: "schema/patterns.json",
    fixture: "fixtures/patterns",
    summary:
      "The pattern-language view: context, forces, solution, relations, and the stable shape.",
  },
  recipes: {
    name: "recipes",
    version: 1,
    kind: "derived",
    owner: "@autotelic/cutlist",
    schema: "schema/recipes.json",
    fixture: "fixtures/recipes",
    summary: "Imports and minimal shapes for the load-bearing parts and every composition.",
  },
  onboarding: {
    name: "onboarding",
    version: 1,
    kind: "authored",
    owner: "@autotelic/jig-cli",
    schema: "schema/onboarding.json",
    fixture: "fixtures/onboarding",
    summary: "The agent door: a repo-local prompt that is also the client engineer's doc.",
  },
  "cutlist.config": {
    name: "cutlist.config",
    version: 1,
    kind: "authored",
    owner: "@autotelic/cutlist",
    schema: "schema/cutlist.config.json",
    fixture: "fixtures/cutlist.config",
    summary: "A repo's vocabulary: roots, tiers, tokens, ownership, patterns, output.",
  },
  "jig.config": {
    name: "jig.config",
    version: 1,
    kind: "authored",
    owner: "@autotelic/jig-cli",
    schema: "schema/jig.config.json",
    fixture: "fixtures/jig.config",
    summary: "Which engines are active, and how a run is gated.",
  },
}

/** The registry, keyed by name. Frozen so a reader cannot mutate the contract. */
export const LEXICONS: Readonly<Record<LexiconName, Lexicon>> = lexicons

/** A record's reference to its lexicon, at the registry's current version. */
export const lexiconRef = (name: LexiconName): LexiconRef => ({
  name,
  version: LEXICONS[name].version,
})

const nameSet: ReadonlySet<string> = new Set(LEXICON_NAMES)

/** Whether an untrusted value is one of the known lexicon names. */
export const isLexiconName = (value: unknown): value is LexiconName =>
  typeof value === "string" && nameSet.has(value)

/**
 * Whether an untrusted value is a well-formed reference — shape only, not a registry
 * lookup, so a record naming a lexicon we have never heard of still parses as a ref and
 * is then rejected by name.
 */
export const isLexiconRef = (value: unknown): value is LexiconRef => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  const version = record.version
  return (
    isLexiconName(record.name) &&
    typeof version === "number" &&
    Number.isInteger(version) &&
    version >= 1
  )
}

/** Whether a reference names the given lexicon (any version). */
export const names = (ref: LexiconRef, name: LexiconName): boolean => ref.name === name

/**
 * Whether a reader that understands `known` at `knownVersion` can read a record written
 * as `seen`: the same name, at a version the reader is not older than. A newer version is
 * readable only because the evolution rule makes every change additive; a record from an
 * older version is always readable.
 */
export const isReadable = (seen: LexiconRef, known: LexiconRef): boolean =>
  seen.name === known.name && seen.version >= known.version
