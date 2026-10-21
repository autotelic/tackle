import { arrayOf, bool, isRecord, num, oneOf, readLexiconRef, str, strings } from "./decode.ts"
import { lexiconRef, type LexiconRef } from "./lexicon.ts"
import { decodeTiers, type Tiers, type TierName } from "./config.ts"
import { PART_STATUSES, type Intent, type PartStatus } from "./intent.ts"

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

/**
 * What a part IS, as opposed to where it sits.
 *
 * A file is not one thing: a context module can also export the hook that reads it, and a
 * provider is a component that supplies a context. `kind` is the one a list puts it under;
 * `roles` is every fact that holds. Both are derived from declarations, not filenames.
 */
export type PartRole = "component" | "hook" | "context" | "provider" | "barrel" | "route" | "module"

/** One top-level declaration, the unit a role is read from. Raw material for rules. */
export interface CatalogDeclaration {
  readonly name: string
  readonly kind: "function" | "class" | "variable" | "type"
  readonly exported: boolean
  readonly renders: boolean
  readonly calls: ReadonlyArray<string>
  readonly objectKeys?: ReadonlyArray<string>
}

/**
 * One composition feature: the provider/context/hook pattern as the tree attempts it.
 *
 * This is a derived view over parts — a context in a directory plus a provider or a
 * dot-notation barrel — not a stored classification. It exists so a consumer can read a
 * feature as one thing without re-joining the declarations itself.
 */
export interface CatalogFeature {
  /** Repository-relative directory the parts share. */
  readonly dir: string
  /** The public name: the barrel's object name, else a PascalCase directory. */
  readonly name: string
  /** The module that calls `createContext`. */
  readonly context: string
  readonly provider?: string
  readonly barrel?: string
  /** Component modules in the feature that are not the context, provider, or barrel. */
  readonly blocks: ReadonlyArray<string>
  readonly hooks: ReadonlyArray<string>
  /** Keys of the provider's supplied value; `state/actions/meta` when tripartite. */
  readonly valueKeys: ReadonlyArray<string>
}

/** One component as the crawler classified it. */
export interface CatalogComponent extends ComponentFields {
  /**
   * The part's stable identity: its repository-relative path without the source
   * extension, with `/` flattened to `--`. `name` is for reading; this is for joining.
   *
   * Optional because catalogs written before ids landed carry none. A reader falls back
   * to `name` — the old join — so a stale artifact degrades rather than disappears.
   */
  readonly id?: string
  /** The role a list puts this part under. Optional: older catalogs called everything a component. */
  readonly kind?: PartRole
  /** Every role the part carries, of which `kind` is the first by convention. */
  readonly roles?: ReadonlyArray<PartRole>
  /** The directory of the composition feature this part belongs to, when it is in one. */
  readonly feature?: string
  /** The public names a consumer imports from this module, types excluded. */
  readonly exports?: ReadonlyArray<string>
  /** How many modules import it. Inventory says it exists; this says it is used. */
  readonly usedBy?: number
  /** Top-level declarations. The raw material a rule reads instead of re-parsing source. */
  readonly declarations?: ReadonlyArray<CatalogDeclaration>
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

/**
 * A connected group of near-duplicates, with the most-used member as the canonical.
 *
 * A pair is a finding; a cluster is a decision. When three variants of one dialog exist,
 * the useful question is not "are these two the same?" but "which one is the system, and
 * why were the others written?" The canonical is chosen by adoption rather than by file
 * order, because the version people already import is the one a migration should keep.
 */
export interface DuplicateCluster {
  /** The path of the member with the most importers. */
  readonly canonical: string
  /** The canonical's name, for a heading a person can read. */
  readonly name: string
  readonly members: ReadonlyArray<string>
  /** The strongest pair in the cluster. */
  readonly score: number
  /** Summed importers across every member; the size of the workaround. */
  readonly usedBy: number
}

/**
 * The adoption facts a catalog can know without reading authored intent.
 *
 * `sharedReach` is a ratio rather than a count because the denominator is the thing that
 * grows: a repo with a thousand local pages and ten shared imports is not healthier than
 * a smaller one, and a count would reward the wrong direction.
 */
export interface CatalogHealth {
  readonly parts: number
  /** Share of component/hook/route modules that import at least one shared or primitive part. */
  readonly sharedReach: number
  /** UI modules that import no shared or primitive part. */
  readonly localOnly: number
  readonly duplicateClusters: number
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
  /** Composition features, derived from parts. Absent in catalogs that predate them. */
  readonly features?: ReadonlyArray<CatalogFeature>
  /** Adoption and duplication pressure. Absent in catalogs that predate them. */
  readonly health?: CatalogHealth
  /** Near-duplicate clusters, derived from the candidate pairs. */
  readonly clusters?: ReadonlyArray<DuplicateCluster>
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
  /** What it is. A rule can scope itself to components without re-deriving the role. */
  readonly kind?: PartRole
  readonly roles?: ReadonlyArray<PartRole>
  /** The composition feature's directory, when it belongs to one. */
  readonly feature?: string
  /** The names a consumer imports, so a rule can match an import binding to a part. */
  readonly exports?: ReadonlyArray<string>
  readonly usedBy?: number
  /** Authored lifecycle. A rule can refuse a direct import of a deprecated part. */
  readonly status?: PartStatus
  /** Authored migration target, carried to the rule that reports the import. */
  readonly useInstead?: ReadonlyArray<string>
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

/**
 * Project the catalog onto the lint manifest. One source, one lookup table.
 *
 * Intent is optional because the catalog is derived and the manifest is a projection:
 * a caller that has not read `intent/` still gets a valid manifest, just one whose rules
 * cannot see a deprecation. The caller that HAS read it passes the same map the menu uses,
 * so a rule and a person never disagree about which part is deprecated.
 */
export const projectManifest = (
  catalog: Catalog,
  intent?: ReadonlyMap<string, Intent>,
): UiManifest => ({
  lexicon: lexiconRef("manifest"),
  colors: catalog.tokens.colors,
  sharedRoots: catalog.sharedRoots,
  localRoots: catalog.localRoots,
  components: catalog.components.map((component) => {
    const authored =
      (component.id === undefined ? undefined : intent?.get(component.id)) ??
      intent?.get(component.name)
    return {
      path: component.path,
      name: component.name,
      tier: component.tier,
      owners: component.owners,
      props: component.props,
      tags: component.tags,
      ...(component.kind === undefined ? {} : { kind: component.kind }),
      ...(component.roles === undefined ? {} : { roles: component.roles }),
      ...(component.feature === undefined ? {} : { feature: component.feature }),
      ...(component.exports === undefined ? {} : { exports: component.exports }),
      ...(component.usedBy === undefined ? {} : { usedBy: component.usedBy }),
      ...(authored?.status === undefined ? {} : { status: authored.status }),
      ...(authored?.useInstead === undefined ? {} : { useInstead: authored.useInstead }),
      signature: component.signature,
    }
  }),
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

export const PART_ROLES: ReadonlyArray<PartRole> = [
  "component",
  "hook",
  "context",
  "provider",
  "barrel",
  "route",
  "module",
]

const DECLARATION_KINDS: ReadonlyArray<CatalogDeclaration["kind"]> = [
  "function",
  "class",
  "variable",
  "type",
]

const decodeDeclaration = (value: unknown): CatalogDeclaration | undefined => {
  if (!isRecord(value)) return undefined
  const name = str(value.name)
  const kind = oneOf(value.kind, DECLARATION_KINDS)
  const exported = bool(value.exported)
  const renders = bool(value.renders)
  const calls = strings(value.calls)
  if (
    name === undefined ||
    kind === undefined ||
    exported === undefined ||
    renders === undefined ||
    calls === undefined
  ) {
    return undefined
  }
  const objectKeys = strings(value.objectKeys)
  return {
    name,
    kind,
    exported,
    renders,
    calls,
    ...(objectKeys === undefined ? {} : { objectKeys }),
  }
}

export const decodeFeature = (value: unknown): CatalogFeature | undefined => {
  if (!isRecord(value)) return undefined
  const dir = str(value.dir)
  const name = str(value.name)
  const context = str(value.context)
  const blocks = strings(value.blocks)
  const hooks = strings(value.hooks)
  const valueKeys = strings(value.valueKeys)
  if (
    dir === undefined ||
    name === undefined ||
    context === undefined ||
    blocks === undefined ||
    hooks === undefined ||
    valueKeys === undefined
  ) {
    return undefined
  }
  const provider = str(value.provider)
  const barrel = str(value.barrel)
  return {
    dir,
    name,
    context,
    ...(provider === undefined ? {} : { provider }),
    ...(barrel === undefined ? {} : { barrel }),
    blocks,
    hooks,
    valueKeys,
  }
}

/** Read a health block, or `undefined` when malformed. */
export const decodeHealth = (value: unknown): CatalogHealth | undefined => {
  if (!isRecord(value)) return undefined
  const parts = num(value.parts)
  const sharedReach = num(value.sharedReach)
  const localOnly = num(value.localOnly)
  const duplicateClusters = num(value.duplicateClusters)
  if (
    parts === undefined ||
    sharedReach === undefined ||
    localOnly === undefined ||
    duplicateClusters === undefined
  ) {
    return undefined
  }
  return { parts, sharedReach, localOnly, duplicateClusters }
}

/** Read one duplicate cluster, or `undefined` when malformed. */
export const decodeCluster = (value: unknown): DuplicateCluster | undefined => {
  if (!isRecord(value)) return undefined
  const canonical = str(value.canonical)
  const name = str(value.name)
  const members = strings(value.members)
  const score = num(value.score)
  const usedBy = num(value.usedBy)
  if (
    canonical === undefined ||
    name === undefined ||
    members === undefined ||
    score === undefined ||
    usedBy === undefined
  ) {
    return undefined
  }
  return { canonical, name, members, score, usedBy }
}

/** Read one component, or `undefined` when malformed. */
export const decodeCatalogComponent = (value: unknown): CatalogComponent | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const kind = oneOf(value.kind, PART_ROLES)
  const roles = arrayOf(value.roles, (role) => oneOf(role, PART_ROLES))
  const feature = str(value.feature)
  const exports = strings(value.exports)
  const usedBy = num(value.usedBy)
  const declarations = arrayOf(value.declarations, decodeDeclaration)
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
  return {
    ...(id === undefined ? {} : { id }),
    ...(kind === undefined ? {} : { kind }),
    ...(roles === undefined ? {} : { roles }),
    ...(feature === undefined ? {} : { feature }),
    ...(exports === undefined ? {} : { exports }),
    ...(usedBy === undefined ? {} : { usedBy }),
    ...(declarations === undefined ? {} : { declarations }),
    path,
    name,
    tier,
    owners,
    props,
    tags,
    signature,
    documented,
  }
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
  const features = arrayOf(value.features, decodeFeature)
  const health = decodeHealth(value.health)
  const clusters = arrayOf(value.clusters, decodeCluster)
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
    ...(features === undefined ? {} : { features }),
    ...(health === undefined ? {} : { health }),
    ...(clusters === undefined ? {} : { clusters }),
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
  const kind = oneOf(value.kind, PART_ROLES)
  const roles = arrayOf(value.roles, (role) => oneOf(role, PART_ROLES))
  const feature = str(value.feature)
  const exports = strings(value.exports)
  const usedBy = num(value.usedBy)
  const status = oneOf(value.status, PART_STATUSES)
  const useInstead = strings(value.useInstead)
  return {
    path,
    name,
    tier,
    owners,
    props,
    tags,
    ...(kind === undefined ? {} : { kind }),
    ...(roles === undefined ? {} : { roles }),
    ...(feature === undefined ? {} : { feature }),
    ...(exports === undefined ? {} : { exports }),
    ...(usedBy === undefined ? {} : { usedBy }),
    ...(status === undefined ? {} : { status }),
    ...(useInstead === undefined ? {} : { useInstead }),
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
