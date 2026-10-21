import {
  hasIntent,
  lexiconRef,
  type Catalog,
  type CatalogComponent,
  type CatalogFeature,
  type DuplicateCluster,
  type Intent,
  type PartRole,
  type Pattern,
  type PatternRelation,
  type PatternView,
  type StabilityFactors,
  type TierName,
} from "@autotelic/protocol"

/*
 * The pattern language, derived from the model and the authored intent.
 *
 * Alexander's patterns are not an inventory: each one has a context, a problem, the forces
 * that keep the problem alive, a solution, and links to the patterns around it. A catalog
 * already carries the context (tier, owners, feature), the forces (adoption, variants,
 * orphans, lifecycle), and the solution (exports, composition); the intent file supplies the
 * sentences a person writes. This module joins them into a view without inventing a second
 * model: every field is either a catalog fact or an authored field.
 *
 * A part is selected as a pattern only when it carries a shape worth naming — a composition,
 * a primitive, a load-bearing shared part, or a variant family. Routes and local plumbing are
 * consumers; they belong in the menu and the recipes, not in the pattern language.
 */

const round = (value: number): number => Math.round(value * 1000) / 1000

/** The roles that describe an interface. A type module is a part, but not a UI pattern. */
const UI_ROLES: ReadonlySet<PartRole> = new Set([
  "barrel",
  "component",
  "context",
  "hook",
  "provider",
  "route",
])

const isUiPattern = (pattern: Pattern): boolean =>
  pattern.role === undefined || UI_ROLES.has(pattern.role)

const intentOf = (
  component: CatalogComponent,
  intent: ReadonlyMap<string, Intent> | undefined,
): Intent | undefined => intent?.get(component.id ?? "") ?? intent?.get(component.name)

const tierScore = (tier: TierName): number => {
  if (tier === "primitive") return 1
  if (tier === "shared") return 0.8
  return 0.2
}

/** The score and the factors a reader can audit. */
interface Stability {
  readonly stability: number
  readonly factors: StabilityFactors
}

const variantScore = (
  path: string,
  clusterByPath: ReadonlyMap<string, DuplicateCluster>,
): number => {
  const cluster = clusterByPath.get(path)
  if (cluster === undefined) return 0.8
  return cluster.canonical === path ? 1 : 0.2
}

/**
 * Stability is a reading of the facts, not a new fact.
 *
 * Tier and adoption carry the most weight because they are what a consumer can rely on; an
 * authored sentence helps; a variant of something else is pressure, not a foundation. The
 * factors are returned with the score so a reader can disagree with one of them.
 */
const stabilityOf = ({
  component,
  maxUsedBy,
  clusterByPath,
  authored,
}: {
  readonly component: CatalogComponent
  readonly maxUsedBy: number
  readonly clusterByPath: ReadonlyMap<string, DuplicateCluster>
  readonly authored: Intent | undefined
}): Stability => {
  const factors: StabilityFactors = {
    tier: tierScore(component.tier),
    adoption: maxUsedBy <= 1 ? 0 : Math.log1p(component.usedBy ?? 0) / Math.log1p(maxUsedBy),
    ownership: Math.min(1, component.owners.filter((owner) => owner !== "shared").length / 3),
    variant: variantScore(component.path, clusterByPath),
    documented: hasIntent(authored) ? 1 : component.documented ? 0.6 : 0.3,
  }
  const weighted =
    0.35 * factors.tier +
    0.3 * factors.adoption +
    0.15 * factors.ownership +
    0.1 * factors.variant +
    0.1 * factors.documented
  return {
    stability: authored?.status === "deprecated" ? 0 : round(weighted),
    factors: {
      tier: round(factors.tier),
      adoption: round(factors.adoption),
      ownership: round(factors.ownership),
      variant: round(factors.variant),
      documented: round(factors.documented),
    },
  }
}

/** The path or name a composed token names, when the catalog has that part. */
const resolveComposed = (
  token: string,
  byExport: ReadonlyMap<string, CatalogComponent>,
  byName: ReadonlyMap<string, CatalogComponent>,
): CatalogComponent | undefined => {
  const [kind, ...rest] = token.split(":")
  const name = rest.join(":")
  if (kind === "tag") return byExport.get(name) ?? byName.get(name.toLowerCase())
  if (kind === "hook") return byExport.get(name) ?? byName.get(name)
  return undefined
}

const relationsOf = ({
  component,
  authored,
  cluster,
  feature,
  byExport,
  byName,
}: {
  readonly component: CatalogComponent
  readonly authored: Intent | undefined
  readonly cluster: DuplicateCluster | undefined
  readonly feature: CatalogFeature | undefined
  readonly byExport: ReadonlyMap<string, CatalogComponent>
  readonly byName: ReadonlyMap<string, CatalogComponent>
}): ReadonlyArray<PatternRelation> => {
  const relations: Array<PatternRelation> = []
  for (const token of component.signature) {
    const target = resolveComposed(token, byExport, byName)
    if (target !== undefined && target.path !== component.path) {
      relations.push({ kind: "uses", target: target.path })
    }
  }
  if (feature !== undefined) relations.push({ kind: "part-of", target: feature.dir })
  if (cluster !== undefined && cluster.canonical !== component.path) {
    relations.push({ kind: "variant-of", target: cluster.canonical })
  }
  for (const name of authored?.useInstead ?? []) {
    relations.push({ kind: "replaces", target: name })
  }
  return relations
}

const patternOf = ({
  component,
  authored,
  cluster,
  feature,
  stable,
  byExport,
  byName,
}: {
  readonly component: CatalogComponent
  readonly authored: Intent | undefined
  readonly cluster: DuplicateCluster | undefined
  readonly feature: CatalogFeature | undefined
  readonly stable: { readonly stability: number; readonly factors: StabilityFactors }
  readonly byExport: ReadonlyMap<string, CatalogComponent>
  readonly byName: ReadonlyMap<string, CatalogComponent>
}): Pattern => ({
  id: component.id ?? component.path,
  name: component.name,
  kind:
    component.tier === "primitive" ? "primitive" : feature !== undefined ? "composition" : "shared",
  ...(component.kind === undefined ? {} : { role: component.kind }),
  path: component.path,
  tier: component.tier,
  ...(component.feature === undefined ? {} : { feature: component.feature }),
  ...(authored?.summary === undefined ? {} : { summary: authored.summary }),
  ...(authored?.whenToUse === undefined ? {} : { whenToUse: authored.whenToUse }),
  ...(authored?.whenNotToUse === undefined ? {} : { whenNotToUse: authored.whenNotToUse }),
  ...(authored?.states === undefined ? {} : { states: authored.states }),
  ...(authored?.status === undefined ? {} : { status: authored.status }),
  ...(authored?.examples === undefined ? {} : { examples: authored.examples }),
  ...(authored?.useInstead === undefined ? {} : { useInstead: authored.useInstead }),
  usedBy: component.usedBy ?? 0,
  owners: component.owners,
  exports: component.exports ?? [],
  composedOf: component.signature,
  relations: relationsOf({
    component,
    authored,
    cluster,
    feature,
    byExport,
    byName,
  }),
  ...stable,
})

/** The whole pattern view, including the stable-shape ranking and the entropy signals. */
export const patternsOf = ({
  catalog,
  intent,
}: {
  readonly catalog: Catalog
  readonly intent: ReadonlyMap<string, Intent> | undefined
}): PatternView => {
  const components = catalog.components
  const byExport = new Map<string, CatalogComponent>()
  const byName = new Map<string, CatalogComponent>()
  for (const component of components) {
    byName.set(component.name, component)
    for (const name of component.exports ?? []) {
      if (name !== "default") byExport.set(name, component)
    }
  }
  const featureByDir = new Map((catalog.features ?? []).map((feature) => [feature.dir, feature]))
  const clusterByPath = new Map<string, DuplicateCluster>()
  for (const cluster of catalog.clusters ?? []) {
    for (const path of cluster.members) clusterByPath.set(path, cluster)
  }
  const maxUsedBy = Math.max(1, ...components.map((component) => component.usedBy ?? 0))

  const patterns = components.map((component) =>
    patternOf({
      component,
      authored: intentOf(component, intent),
      cluster: clusterByPath.get(component.path),
      feature: component.feature === undefined ? undefined : featureByDir.get(component.feature),
      stable: stabilityOf({
        component,
        maxUsedBy,
        clusterByPath,
        authored: intentOf(component, intent),
      }),
      byExport,
      byName,
    }),
  )

  const featurePatterns: Array<Pattern> = (catalog.features ?? []).map((feature) => {
    const anchorPath = feature.barrel ?? feature.provider ?? feature.context
    const anchor = components.find((component) => component.path === anchorPath)
    const blocks = feature.blocks.map(
      (path) => components.find((component) => component.path === path)?.name ?? path,
    )
    const usedBy = anchor?.usedBy ?? 0
    const authored = anchor === undefined ? undefined : intentOf(anchor, intent)
    const stability =
      anchor === undefined
        ? 0
        : stabilityOf({
            component: anchor,
            maxUsedBy,
            clusterByPath,
            authored,
          }).stability
    return {
      id: `feature:${feature.dir}`,
      name: feature.name,
      kind: "composition",
      role: anchor?.kind ?? "component",
      path: feature.dir,
      tier: anchor?.tier ?? "shared",
      feature: feature.dir,
      ...(authored?.summary === undefined ? {} : { summary: authored.summary }),
      ...(authored?.whenToUse === undefined ? {} : { whenToUse: authored.whenToUse }),
      ...(authored?.whenNotToUse === undefined ? {} : { whenNotToUse: authored.whenNotToUse }),
      ...(authored?.states === undefined ? {} : { states: authored.states }),
      ...(authored?.status === undefined ? {} : { status: authored.status }),
      ...(authored?.examples === undefined ? {} : { examples: authored.examples }),
      ...(authored?.useInstead === undefined ? {} : { useInstead: authored.useInstead }),
      usedBy,
      owners: anchor?.owners ?? [],
      exports: anchor?.exports ?? [],
      composedOf: feature.blocks,
      blocks,
      hooks: feature.hooks,
      valueKeys: feature.valueKeys,
      relations: [
        { kind: "context", target: feature.context },
        ...(feature.provider === undefined
          ? []
          : [{ kind: "provider" as const, target: feature.provider }]),
        ...(feature.barrel === undefined
          ? []
          : [{ kind: "barrel" as const, target: feature.barrel }]),
        ...feature.blocks.map((block) => ({ kind: "block" as const, target: block })),
        ...feature.hooks.map((hook) => ({ kind: "hook" as const, target: hook })),
      ],
      stability,
      factors:
        anchor === undefined
          ? { tier: 0.8, adoption: 0, ownership: 0, variant: 0.8, documented: 0.3 }
          : stabilityOf({ component: anchor, maxUsedBy, clusterByPath, authored }).factors,
    }
  })

  const families: Array<Pattern> = (catalog.clusters ?? [])
    .map((cluster): Pattern => {
      const canonical = components.find((component) => component.path === cluster.canonical)
      const authored = canonical === undefined ? undefined : intentOf(canonical, intent)
      const stable =
        canonical === undefined
          ? {
              stability: 0,
              factors: {
                tier: 0.8,
                adoption: 0,
                ownership: 0,
                variant: 1,
                documented: 0.3,
              },
            }
          : stabilityOf({ component: canonical, maxUsedBy, clusterByPath, authored })
      return {
        id: `family:${cluster.name}`,
        name: cluster.name,
        kind: "family",
        role: canonical?.kind ?? "component",
        path: cluster.canonical,
        tier: canonical?.tier ?? "shared",
        ...(canonical?.feature === undefined ? {} : { feature: canonical.feature }),
        ...(authored?.summary === undefined ? {} : { summary: authored.summary }),
        ...(authored?.whenToUse === undefined ? {} : { whenToUse: authored.whenToUse }),
        ...(authored?.status === undefined ? {} : { status: authored.status }),
        ...(authored?.useInstead === undefined ? {} : { useInstead: authored.useInstead }),
        usedBy: cluster.usedBy,
        owners: canonical?.owners ?? [],
        exports: canonical?.exports ?? [],
        composedOf: canonical?.signature ?? [],
        relations: cluster.members
          .filter((member) => member !== cluster.canonical)
          .map((member) => ({ kind: "variant-of" as const, target: member })),
        ...stable,
      }
    })
    .filter(isUiPattern)

  const primitives = patterns.filter(
    (pattern) => pattern.tier === "primitive" && isUiPattern(pattern),
  )
  const compositions = featurePatterns
  const shared = patterns
    .filter(
      (pattern) =>
        pattern.tier === "shared" &&
        pattern.kind !== "family" &&
        isUiPattern(pattern) &&
        (pattern.usedBy > 0 || pattern.summary !== undefined),
    )
    .sort((left, right) => right.stability - left.stability)
    .slice(0, 24)
  const stableByPath = new Map<string, Pattern>()
  for (const pattern of [...primitives, ...compositions, ...shared, ...families]) {
    const existing = stableByPath.get(pattern.path)
    const preferFamily = pattern.kind === "family" && existing?.kind !== "family"
    if (existing === undefined || preferFamily || pattern.stability > existing.stability) {
      stableByPath.set(pattern.path, pattern)
    }
  }
  const stable = [...stableByPath.values()]
    .sort((left, right) => right.stability - left.stability)
    .slice(0, 20)

  const deprecated = patterns
    .filter((pattern) => pattern.status === "deprecated" && pattern.usedBy > 0)
    .map((pattern) => pattern.path)
  const variants = (catalog.clusters ?? []).map((cluster) => ({
    canonical: cluster.canonical,
    members: cluster.members.filter((member) => member !== cluster.canonical),
  }))

  return {
    lexicon: lexiconRef("patterns"),
    hash: catalog.hash,
    stable,
    compositions,
    primitives,
    shared,
    families,
    signals: {
      orphans: catalog.orphans,
      variants,
      deprecated,
    },
  }
}
