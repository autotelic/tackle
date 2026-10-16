import { PROTOCOL_VERSION } from "./version.ts"
import type { Tiers, TierName } from "./config.ts"

/*
 * The catalog: the model `cutlist` computes once and renders many ways.
 *
 * The important property is that every rendering — the machine model, the lint
 * manifest, `MENU.md` — derives from THIS object, so they cannot drift from each
 * other. `plumb-ui` already consumes a manifest of this shape and fails open on a
 * malformed one, which is why `cutlist --check` exists: a stale catalog must be loud,
 * not silent.
 */

/** One component as the crawler classified it. */
export interface CatalogComponent {
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
  readonly protocolVersion: string
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
export interface ManifestComponent {
  readonly path: string
  readonly name: string
  readonly tier: TierName
  readonly owners: ReadonlyArray<string>
  readonly props: ReadonlyArray<string>
  readonly tags: ReadonlyArray<string>
  /** Carried so a reader CAN use the corrected metric; older readers ignore it. */
  readonly signature?: ReadonlyArray<string>
}

/** The manifest `plumb-ui` parses. */
export interface UiManifest {
  readonly colors: ReadonlyArray<string>
  readonly sharedRoots: ReadonlyArray<string>
  readonly localRoots: ReadonlyArray<string>
  readonly components: ReadonlyArray<ManifestComponent>
}

/** Project the catalog onto the lint manifest. One source, one lookup table. */
export const projectManifest = (catalog: Catalog): UiManifest => ({
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
  protocolVersion: PROTOCOL_VERSION,
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
