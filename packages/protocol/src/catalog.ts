import { arrayOf, bool, isRecord, num, oneOf, readLexiconRef, str, strings } from "./decode.ts"
import { lexiconRef, type LexiconRef } from "./lexicon.ts"
import { decodeTiers, type Tiers, type TierName } from "./config.ts"

/*
 * The catalog: the model `cutlist` computes once and renders many ways.
 *
 * The important property is that every rendering — the machine model, the lint
 * manifest, `MENU.md` — derives from THIS object, so they cannot drift from each
 * other. `plumb-ui` already consumes a manifest of this shape and fails open on a
 * malformed one, which is why `cutlist --check` exists: a stale catalog must be loud,
 * not silent.
 */

/** Every field a component carries wherever it is rendered — the catalog's, and the manifest's. */
interface ComponentFields {
  /** Repository-relative, forward-slashed. */
  readonly path: string
  readonly name: string
  readonly tier: TierName
  /** Route owners, first-segment. `shared` for importers under shared roots. */
  readonly owners: ReadonlyArray<string>
  /** Declared prop names. */
  readonly props: ReadonlyArray<string>
  /** Rendered JSX tag names. */
  readonly tags: ReadonlyArray<string>
}

/** One component as the crawler classified it. */
export interface CatalogComponent extends ComponentFields {
  /**
   * The behavioral skeleton: the headless primitive it wraps, the headless
   * sub-components it renders, the hooks it calls, and its token-class categories.
   *
   * This — not props ∪ tags — is the similarity signature. Props are surface area,
   * and two components can share almost none of it while being the same concept (the
   * `Combobox`/`ComboBoxV2` pair scores ~0.18 on props and ~1.0 on skeleton).
   */
  readonly signature: ReadonlyArray<string>
  /** Whether the source carries a documentation block the catalog could read. */
  readonly documented: boolean
}

/** Two components the crawler proposes as near-duplicates, for a judge to confirm. */
export interface DuplicateCandidate {
  readonly left: string
  readonly right: string
  readonly score: number
  readonly basis: "skeleton"
}

/** The token vocabulary, as four closed sets. */
export interface CatalogTokens {
  readonly colors: ReadonlyArray<string>
  readonly type: ReadonlyArray<string>
  readonly shape: ReadonlyArray<string>
  readonly spacing: ReadonlyArray<string>
}

/** The whole model. */
export interface Catalog {
  readonly lexicon: LexiconRef
  /** Content hash of everything below. `--check` compares it against the tree. */
  readonly hash: string
  readonly root: string
  readonly tokens: CatalogTokens
  readonly tiers: Tiers
  readonly sharedRoots: ReadonlyArray<string>
  readonly localRoots: ReadonlyArray<string>
  readonly components: ReadonlyArray<CatalogComponent>
  readonly orphans: ReadonlyArray<string>
  readonly duplicates: ReadonlyArray<DuplicateCandidate>
}

/*
 * The lint-facing projection.
 *
 * Field names match `plumb/src/ui/manifest.ts` exactly, because the rules read this
 * object and must not need to re-derive the graph. If you add a field here, plumb
 * ignores it until its reader learns the field — which is the intended tolerance.
 */

/** A component as the lint manifest carries it. */
export interface ManifestComponent extends ComponentFields {
  /** Carried so a reader CAN use the corrected metric; older readers ignore it. */
  readonly signature?: ReadonlyArray<string>
}

/** The manifest `plumb-ui` parses. */
export interface UiManifest {
  readonly lexicon: LexiconRef
  readonly colors: ReadonlyArray<string>
  readonly sharedRoots: ReadonlyArray<string>
  readonly localRoots: ReadonlyArray<string>
  readonly components: ReadonlyArray<ManifestComponent>
}

/** Project the catalog onto the lint manifest. One source, one lookup table. */
export const projectManifest = (catalog: Catalog): UiManifest => ({
  lexicon: lexiconRef("manifest"),
  colors: catalog.tokens.colors,
  sharedRoots: catalog.sharedRoots,
  localRoots: catalog.localRoots,
  components: catalog.components.map((component) => ({
    path: component.path,
    name: component.name,
    tier: component.tier,
    owners: component.owners,
    props: component.props,
    tags: component.tags,
    signature: component.signature,
  })),
})

/** The signature a component is compared by. */
export const signatureOf = (component: CatalogComponent): ReadonlySet<string> =>
  new Set(component.signature)

/**
 * Jaccard overlap of two signatures.
 *
 * Two empty signatures are NOT similar: an undocumented component with no recognisable
 * skeleton should match nothing, not everything.
 */
export const similarityOf = (left: ReadonlySet<string>, right: ReadonlySet<string>): number => {
  if (left.size === 0 || right.size === 0) return 0
  const [small, large] = left.size <= right.size ? [left, right] : [right, left]
  let shared = 0
  for (const member of small) if (large.has(member)) shared += 1
  return shared / (left.size + right.size - shared)
}

/** The nearest same-or-higher-tier twin of a component, at or above a threshold. */
export const nearestDuplicate = (
  catalog: Catalog,
  subject: CatalogComponent,
  threshold: number,
): DuplicateCandidate | null => {
  const left = signatureOf(subject)
  let best: DuplicateCandidate | null = null
  for (const candidate of catalog.components) {
    if (candidate.path === subject.path) continue
    const score = similarityOf(left, signatureOf(candidate))
    if (score < threshold) continue
    if (best === null || score > best.score) {
      best = { left: subject.path, right: candidate.path, score, basis: "skeleton" }
    }
  }
  return best
}

/** An empty catalog, for a project that generates none. Every consumer degrades to silence. */
export const emptyCatalog = (root: string): Catalog => ({
  lexicon: lexiconRef("catalog"),
  hash: "",
  root,
  tokens: { colors: [], type: [], shape: [], spacing: [] },
  tiers: { primitive: [], shared: [], local: [] },
  sharedRoots: [],
  localRoots: [],
  components: [],
  orphans: [],
  duplicates: [],
})

/*
 * Decoders — the catalog and the manifest, read as untrusted input.
 *
 * `plumb` reading the manifest without importing this package is the proof the format is
 * not merely the TypeScript; these decoders are the TypeScript's own tolerant half, and
 * they exist so a stale catalog written by an older cutlist degrades to an empty view
 * rather than a false finding. Unknown fields are ignored, so a newer catalog still reads.
 */

const TIERS_NAMES: ReadonlyArray<TierName> = ["primitive", "shared", "local"]

/** Read one component, or `undefined` when malformed. */
export const decodeCatalogComponent = (value: unknown): CatalogComponent | undefined => {
  if (!isRecord(value)) return undefined
  const path = str(value.path)
  const name = str(value.name)
  const tier = oneOf(value.tier, TIERS_NAMES)
  const owners = strings(value.owners)
  const props = strings(value.props)
  const tags = strings(value.tags)
  const signature = strings(value.signature)
  const documented = bool(value.documented)
  if (
    path === undefined ||
    name === undefined ||
    tier === undefined ||
    owners === undefined ||
    props === undefined ||
    tags === undefined ||
    signature === undefined ||
    documented === undefined
  ) {
    return undefined
  }
  return { path, name, tier, owners, props, tags, signature, documented }
}

/** Read one duplicate candidate, or `undefined` when malformed. */
export const decodeDuplicate = (value: unknown): DuplicateCandidate | undefined => {
  if (!isRecord(value)) return undefined
  const left = str(value.left)
  const right = str(value.right)
  const score = num(value.score)
  const basis = oneOf(value.basis, ["skeleton"] as const)
  if (left === undefined || right === undefined || score === undefined || basis === undefined) {
    return undefined
  }
  return { left, right, score, basis }
}

const decodeTokens = (value: unknown): CatalogTokens | undefined => {
  if (!isRecord(value)) return undefined
  const colors = strings(value.colors)
  const type = strings(value.type)
  const shape = strings(value.shape)
  const spacing = strings(value.spacing)
  if (colors === undefined || type === undefined || shape === undefined || spacing === undefined) {
    return undefined
  }
  return { colors, type, shape, spacing }
}

/** Read a catalog, or `undefined` when the whole model is malformed. */
export const decodeCatalog = (value: unknown): Catalog | undefined => {
  if (!isRecord(value)) return undefined
  const lexicon = readLexiconRef(value, "catalog")
  const hash = str(value.hash)
  const root = str(value.root)
  const tokens = decodeTokens(value.tokens)
  const tiers = decodeTiers(value.tiers)
  const sharedRoots = strings(value.sharedRoots)
  const localRoots = strings(value.localRoots)
  const components = arrayOf(value.components, decodeCatalogComponent)
  const orphans = strings(value.orphans)
  const duplicates = arrayOf(value.duplicates, decodeDuplicate)
  if (
    lexicon === undefined ||
    hash === undefined ||
    root === undefined ||
    tokens === undefined ||
    tiers === undefined ||
    sharedRoots === undefined ||
    localRoots === undefined ||
    components === undefined ||
    orphans === undefined ||
    duplicates === undefined
  ) {
    return undefined
  }
  return {
    lexicon,
    hash,
    root,
    tokens,
    tiers,
    sharedRoots,
    localRoots,
    components,
    orphans,
    duplicates,
  }
}

/** Read one manifest component, or `undefined` when malformed. */
export const decodeManifestComponent = (value: unknown): ManifestComponent | undefined => {
  if (!isRecord(value)) return undefined
  const path = str(value.path)
  const name = str(value.name)
  const tier = oneOf(value.tier, TIERS_NAMES)
  const owners = strings(value.owners)
  const props = strings(value.props)
  const tags = strings(value.tags)
  if (
    path === undefined ||
    name === undefined ||
    tier === undefined ||
    owners === undefined ||
    props === undefined ||
    tags === undefined
  ) {
    return undefined
  }
  const signature = strings(value.signature)
  return {
    path,
    name,
    tier,
    owners,
    props,
    tags,
    ...(signature === undefined ? {} : { signature }),
  }
}

/** The empty manifest, for a project that generates none. `plumb-ui`'s fail-open value. */
export const EMPTY_MANIFEST: UiManifest = {
  lexicon: lexiconRef("manifest"),
  colors: [],
  sharedRoots: [],
  localRoots: [],
  components: [],
}

/** Read the manifest, degrading to the empty one — the shape `plumb` already reads. */
export const decodeManifest = (value: unknown): UiManifest => {
  if (!isRecord(value)) return EMPTY_MANIFEST
  // Manifest refs are optional in practice: the reader predates versioning and its own
  // empty value has no ref, so a missing ref means "the current manifest", not corrupt.
  const lexicon = "lexicon" in value ? readLexiconRef(value, "manifest") : undefined
  const colors = strings(value.colors)
  const sharedRoots = strings(value.sharedRoots)
  const localRoots = strings(value.localRoots)
  const components = arrayOf(value.components, decodeManifestComponent)
  if (
    (lexicon === undefined && "lexicon" in value) ||
    colors === undefined ||
    sharedRoots === undefined ||
    localRoots === undefined ||
    components === undefined
  ) {
    return EMPTY_MANIFEST
  }
  return { lexicon: lexicon ?? lexiconRef("manifest"), colors, sharedRoots, localRoots, components }
}
