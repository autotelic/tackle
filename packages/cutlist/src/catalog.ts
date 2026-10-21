import { createHash } from "node:crypto"
import { Effect, FileSystem, Order, Path } from "effect"
import {
  lexiconRef,
  similarityOf,
  type Catalog,
  type CatalogComponent,
  type CatalogHealth,
  type CutlistConfig,
  type DuplicateCandidate,
  type DuplicateCluster,
  type PartRole,
} from "@autotelic/protocol"
import { listSources, readModules, type SourceModule } from "./crawl.ts"
import { dirOf, featuresOf } from "./features.ts"
import {
  dirnamePosix,
  normalizePosix,
  isEntryPoint,
  isRouteEntry,
  stripSourceExtension,
  underAnyRoot,
} from "./paths.ts"
import { ownersOf } from "./owners.ts"
import { kindOf, rolesOf } from "./roles.ts"
import { comparableSignatureOf, skeletonOf } from "./signature.ts"
import { tierOf } from "./tier.ts"
import { extractTokens } from "./tokens.ts"

/*
 * Passes 2, 5 and 7 — the use-graph, the candidate join, and the model itself.
 *
 * One function computes the whole model so every rendering is a projection of the same
 * object and none can drift from another. The content hash is computed over everything
 * except the hash, so `--check` can tell "the tree moved and the catalog did not" from
 * "the catalog is current".
 */

/** Re-derived from real pairs, not guessed: the known `Combobox`/`ComboBoxV2` sits near 1.0. */
export const DUPLICATE_THRESHOLD = 0.7

/** A component's name: its file, or the directory for `index`/`route` conventions. */
const nameOfModule = (path: string): string => {
  const file = path.slice(path.lastIndexOf("/") + 1).replace(/\.(tsx?|jsx?)$/u, "")
  if (file !== "index" && file !== "route") return file
  const dirName = dirnamePosix(path).slice(dirnamePosix(path).lastIndexOf("/") + 1)
  return dirName === "" ? file : dirName
}

/**
 * A part's stable identity: the path without its source extension, flattened for a
 * filename. Names collide (`Comments`, `types`), paths do not; the menu's authored half
 * is joined by this id so one part's summary can never land on another.
 */
export const idOfModule = (path: string): string =>
  stripSourceExtension(path)
    .replace(/^\.?\//u, "")
    .split("/")
    .join("--")

interface AliasRule {
  readonly prefix: string
  readonly replacements: ReadonlyArray<string>
  /** `@/*` style: the specifier continues past the prefix. Exact aliases stop at it. */
  readonly wildcard: boolean
}

const aliasRules = (
  alias: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyArray<AliasRule> => {
  const rules: Array<AliasRule> = []
  for (const [pattern, targets] of Object.entries(alias)) {
    if (pattern.endsWith("/*")) {
      const replacements = targets
        .filter((target) => target.endsWith("/*"))
        .map((target) => target.slice(0, -1))
      if (replacements.length > 0) {
        rules.push({ prefix: pattern.slice(0, -1), replacements, wildcard: true })
      }
    } else if (targets.length > 0) {
      rules.push({ prefix: pattern, replacements: targets, wildcard: false })
    }
  }
  return rules
}

/** A source extension, written the way an import specifier spells it (`./Button.tsx`). */
const SOURCE_EXTENSION = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/u

/** What `resolveSpecifier` needs: the three values travel as one so a swap cannot compile. */
interface SpecifierQuery {
  readonly specifier: string
  readonly importerDir: string
  readonly rules: ReadonlyArray<AliasRule>
}

/**
 * Resolve an import specifier to candidate module base paths, or none if external.
 *
 * The result is extension-less because the graph keys a module by its base however a caller
 * spells it; readers here import WITH an extension (`allowImportingTsExtensions`), so dropping
 * it is the difference between a real use-graph and one where every component is an orphan.
 */
const resolveSpecifier = ({
  specifier,
  importerDir,
  rules,
}: SpecifierQuery): ReadonlyArray<string> => {
  if (specifier.startsWith(".")) {
    return [normalizePosix(`${importerDir}/${specifier}`).replace(SOURCE_EXTENSION, "")]
  }
  for (const rule of rules) {
    const matches = rule.wildcard ? specifier.startsWith(rule.prefix) : specifier === rule.prefix
    if (!matches) continue
    const tail = rule.wildcard ? specifier.slice(rule.prefix.length) : ""
    // A `paths` entry is an array for a reason: one alias can point at several apps.
    // Keep the order, and let the graph pick the candidate that names a real module.
    return rule.replacements.map((replacement) =>
      normalizePosix(replacement + tail).replace(SOURCE_EXTENSION, ""),
    )
  }
  return []
}

/** Pass 2 — for each module, the modules that import it. Exported for the graph's own test. */
export const importerGraph = (
  modules: ReadonlyArray<SourceModule>,
  alias: Readonly<Record<string, ReadonlyArray<string>>>,
  roots: ReadonlyArray<string> = [],
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const byBase = new Map<string, string>()
  for (const module of modules) {
    const base = stripSourceExtension(module.path)
    byBase.set(base, module.path)
    if (base.endsWith("/index")) byBase.set(base.slice(0, -"/index".length), module.path)
  }
  const rules = aliasRules(alias)
  const importers = new Map<string, Set<string>>()
  for (const module of modules) {
    const dir = dirnamePosix(module.path)
    // An alias target is global, but a monorepo has one `components/Button` per app. Read
    // the aliased import from the importer's own root first; a target under another root is
    // still a candidate, which is what lets a shared package alias out of the app.
    const importerRoot = roots
      .filter((root) => module.path === root || module.path.startsWith(`${root}/`))
      .sort((left, right) => right.length - left.length)[0]
    for (const specifier of module.imports) {
      const resolved = resolveSpecifier({ specifier, importerDir: dir, rules })
      const ordered =
        importerRoot === undefined || resolved.length < 2
          ? resolved
          : [...resolved].sort((left, right) => {
              const leftSame = left === importerRoot || left.startsWith(`${importerRoot}/`) ? 1 : 0
              const rightSame =
                right === importerRoot || right.startsWith(`${importerRoot}/`) ? 1 : 0
              return rightSame - leftSame
            })
      for (const candidate of ordered) {
        const target = byBase.get(candidate)
        if (target === undefined || target === module.path) continue
        const set = importers.get(target) ?? new Set<string>()
        set.add(module.path)
        importers.set(target, set)
        break
      }
    }
  }
  return new Map([...importers].map(([key, value]) => [key, [...value].sort(Order.String)]))
}

/** A route or entry module — an entry point, not a component. */
const isRouteModule = ({
  path,
  roots,
  routeDir,
  entries,
}: {
  readonly path: string
  readonly roots: ReadonlyArray<string>
  readonly routeDir: string
  readonly entries: ReadonlyArray<string>
}): boolean =>
  isRouteEntry({ modulePath: path, roots, routeDir }) ||
  isEntryPoint({ modulePath: path, roots, entries })

/**
 * A signature must carry more than one fact to be worth comparing.
 *
 * Two components that both render a `Dialog` are not thereby duplicates, and every
 * `useContext` wrapper would match every other one. A single shared feature is the
 * weakest possible evidence, and at Jaccard 1.0 it sorts above the real pairs. The count
 * runs over the COMPARABLE signature, so a component whose only facts are React's own
 * hooks has nothing to compare.
 */
const MIN_COMPARABLE_SIGNATURE = 2

/**
 * Pass 5b — the all-pairs candidate join. High recall; a judge in `joggle` decides.
 *
 * The join is scoped by kind. A hook and a component are never the same concept however
 * perfectly their skeletons align, and letting them compete is what put `useEffect`-only
 * pairs above real component duplicates. Two parts of different kinds are not compared,
 * so the ranking never has to correct for a category error.
 */
export const duplicateCandidates = (
  components: ReadonlyArray<CatalogComponent>,
  roots: ReadonlyArray<string>,
  routeDir: string,
  entries: ReadonlyArray<string>,
): ReadonlyArray<DuplicateCandidate> => {
  const candidates: Array<DuplicateCandidate> = []
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    const left = components[leftIndex]
    if (left === undefined) continue
    const leftSignature = comparableSignatureOf(left.signature)
    if (leftSignature.size < MIN_COMPARABLE_SIGNATURE) continue
    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex += 1) {
      const right = components[rightIndex]
      if (right === undefined) continue
      const rightSignature = comparableSignatureOf(right.signature)
      if (rightSignature.size < MIN_COMPARABLE_SIGNATURE) continue
      const leftRoute = isRouteModule({ path: left.path, roots, routeDir, entries })
      const rightRoute = isRouteModule({ path: right.path, roots, routeDir, entries })
      // Two route files rendering the same shared component are not duplicates; they
      // are two pages. Route-vs-component IS kept: a page that inlined a copy is a smell.
      if (leftRoute && rightRoute) continue
      if (
        left.kind !== right.kind &&
        !((leftRoute && right.kind === "component") || (rightRoute && left.kind === "component"))
      ) {
        continue
      }
      const score = similarityOf(leftSignature, rightSignature)
      if (score < DUPLICATE_THRESHOLD) continue
      candidates.push({ left: left.path, right: right.path, score, basis: "skeleton" })
    }
  }
  /*
   * A component pair and a hook pair are never compared, but they still share one
   * list, and the menu shows its head. Put components first: they are the parts a UI
   * review acts on, and a hook pair should not fill the first screen. Within a kind,
   * score decides; paths make the order deterministic.
   */
  const kindByPath = new Map(components.map((component) => [component.path, component.kind]))
  const rank = (path: string): number => KIND_RANK[kindByPath.get(path) ?? "module"]
  return candidates.sort(
    (left, right) =>
      rank(left.left) - rank(right.left) ||
      right.score - left.score ||
      left.left.localeCompare(right.left) ||
      left.right.localeCompare(right.right),
  )
}

const KIND_RANK = {
  component: 0,
  provider: 1,
  hook: 2,
  context: 3,
  barrel: 4,
  route: 5,
  module: 6,
} as const satisfies Readonly<Record<PartRole, number>>

/**
 * Group candidate pairs into connected clusters and pick a canonical by adoption.
 *
 * A pair list is a set of edges; readers think in components. Finding the connected
 * components is what turns "A≈B, B≈C" into "there are three versions of one thing". The
 * canonical is the most-imported member because that is the version already in use, and
 * a migration that keeps anything else makes every existing call site move.
 */
export const duplicateClusters = (
  components: ReadonlyArray<CatalogComponent>,
  duplicates: ReadonlyArray<DuplicateCandidate>,
): ReadonlyArray<DuplicateCluster> => {
  const byPath = new Map(components.map((component) => [component.path, component]))
  const parent = new Map<string, string>()
  const find = (path: string): string => {
    let root = path
    while (parent.get(root) !== undefined && parent.get(root) !== root) {
      root = parent.get(root) ?? root
    }
    let current = path
    while (current !== root) {
      const next = parent.get(current) ?? root
      parent.set(current, root)
      current = next
    }
    return root
  }
  const union = (left: string, right: string): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parent.set(rightRoot, leftRoot)
  }
  for (const duplicate of duplicates) {
    parent.set(duplicate.left, find(duplicate.left))
    parent.set(duplicate.right, find(duplicate.right))
    union(duplicate.left, duplicate.right)
  }

  const groups = new Map<string, Array<string>>()
  for (const path of parent.keys()) {
    const root = find(path)
    const group = groups.get(root)
    if (group === undefined) groups.set(root, [path])
    else group.push(path)
  }

  const clusters: Array<DuplicateCluster> = []
  for (const members of groups.values()) {
    if (members.length < 2) continue
    const ordered = [...members].sort((left, right) => {
      const usage = (byPath.get(right)?.usedBy ?? 0) - (byPath.get(left)?.usedBy ?? 0)
      return usage !== 0 ? usage : left.localeCompare(right)
    })
    const canonical = ordered[0]
    if (canonical === undefined) continue
    const memberSet = new Set(members)
    const scores = duplicates
      .filter((duplicate) => memberSet.has(duplicate.left) && memberSet.has(duplicate.right))
      .map((duplicate) => duplicate.score)
    clusters.push({
      canonical,
      name: byPath.get(canonical)?.name ?? canonical,
      members: ordered,
      score: Math.max(0, ...scores),
      usedBy: members.reduce((total, path) => total + (byPath.get(path)?.usedBy ?? 0), 0),
    })
  }

  return clusters.sort(
    (left, right) =>
      right.usedBy - left.usedBy ||
      right.score - left.score ||
      left.canonical.localeCompare(right.canonical),
  )
}

/**
 * Adoption, from the reverse import graph.
 *
 * A module "reaches the system" when at least one of its imports resolves to a part that
 * lives in the shared layer — the primitive or shared roots. The test is by LOCATION, not
 * by the tier a file acquired: a component used by one route today is still shared material
 * that route reached for, and counting only multi-owner parts made a well-composed app look
 * unattached.
 *
 * The denominator is UI modules OUTSIDE the shared layer. A primitive importing a utility
 * is the system, not an adopter of the system; counting the library made adoption read as
 * a failure of the library. Type modules stay out for the same reason: documenting a repo
 * should not lower its adoption score.
 */
export const healthOf = ({
  components,
  graph,
  roots,
  primitiveRoots,
  sharedRoots,
  entries,
}: {
  readonly components: ReadonlyArray<CatalogComponent>
  readonly graph: ReadonlyMap<string, ReadonlyArray<string>>
  readonly roots: ReadonlyArray<string>
  readonly primitiveRoots: ReadonlyArray<string>
  readonly sharedRoots: ReadonlyArray<string>
  readonly entries: ReadonlyArray<string>
}): CatalogHealth => {
  const shared = new Set(
    components
      .filter((component) =>
        underAnyRoot({
          modulePath: component.path,
          roots,
          targets: [...primitiveRoots, ...sharedRoots],
        }),
      )
      .map((component) => component.path),
  )
  const ui = components.filter(
    (component) =>
      component.kind === "component" || component.kind === "hook" || component.kind === "route",
  )
  const adopters = ui.filter(
    (component) =>
      !shared.has(component.path) && !isEntryPoint({ modulePath: component.path, roots, entries }),
  )
  const importsByPath = new Map<string, Set<string>>()
  for (const [target, importers] of graph) {
    for (const importer of importers) {
      const set = importsByPath.get(importer) ?? new Set<string>()
      set.add(target)
      importsByPath.set(importer, set)
    }
  }
  const consumers = adopters.filter((component) =>
    [...(importsByPath.get(component.path) ?? [])].some((target) => shared.has(target)),
  ).length
  return {
    parts: components.length,
    sharedReach: adopters.length === 0 ? 0 : consumers / adopters.length,
    localOnly: adopters.length - consumers,
    duplicateClusters: 0,
  }
}

/** Build the whole model. */
export const buildCatalog = (
  root: string,
  config: CutlistConfig,
): Effect.Effect<Catalog, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const files = yield* listSources(root, config.roots)
    const modules = yield* readModules(root, files)
    const graph = importerGraph(modules, config.alias ?? {}, config.roots)

    const routeDir = config.tiers.local[0] ?? "routes"
    const entries = config.ownership.entries ?? []
    const ownerOptions = {
      roots: config.roots,
      routeDir,
      sharedRoots: config.tiers.shared,
      routeOwner: config.ownership.routeOwner,
      transitive: config.ownership.transitive,
    }
    const tierOptions = {
      roots: config.roots,
      primitiveRoots: config.tiers.primitive,
      sharedRoots: config.tiers.shared,
      localRoots: config.tiers.local,
    }
    const roleOptions = {
      ...(config.patterns?.composition === undefined
        ? {}
        : { composition: config.patterns.composition }),
      roots: config.roots,
      routeDir,
      entries,
    }
    const rolesByPath = new Map(
      modules.map((module) => [module.path, rolesOf(module, roleOptions)]),
    )
    // Features are a join over the same parts, computed before the parts are shaped so a
    // part can carry its feature directory rather than a reader re-querying the graph.
    const features = featuresOf(modules, roleOptions, graph)
    const featureDirs = new Set(features.map((feature) => feature.dir))

    const components: ReadonlyArray<CatalogComponent> = modules
      .map((module) => {
        const owners = ownersOf(graph.get(module.path) ?? [], ownerOptions, graph)
        const roles = rolesByPath.get(module.path) ?? ["module"]
        const dir = dirOf(module.path)
        // A type is part of the module's surface but not something a consumer imports
        // to render. The value exports are the API an agent can actually reach for.
        const typeNames = new Set(
          module.declarations
            .filter((declaration) => declaration.kind === "type")
            .map((declaration) => declaration.name),
        )
        const exports = module.exports.filter((name) => !typeNames.has(name))
        const usedBy = graph.get(module.path)?.length ?? 0
        return {
          id: idOfModule(module.path),
          path: module.path,
          name: nameOfModule(module.path),
          tier: tierOf(module.path, owners, tierOptions),
          owners,
          props: module.props,
          tags: module.tags,
          signature: skeletonOf(module),
          documented: module.documented,
          kind: kindOf(roles),
          roles,
          ...(featureDirs.has(dir) ? { feature: dir } : {}),
          ...(exports.length === 0 ? {} : { exports }),
          ...(usedBy === 0 ? {} : { usedBy }),
          // The declarations are raw material: a rule can read them instead of parsing
          // the file again, and the artifact stays the one place the model lives.
          declarations: module.declarations,
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))

    const tokens = yield* extractTokens(root, config.tokens)
    // An orphan is "nothing imports it". A route is an entry point — nothing imports
    // it BY DESIGN, so counting it would drown the real signal (unused primitives and
    // flattened copies) in page files.
    const orphans = components
      .filter(
        (component) =>
          component.owners.length === 0 &&
          !isRouteModule({ path: component.path, roots: config.roots, routeDir, entries }),
      )
      .map((component) => component.path)

    const duplicates = duplicateCandidates(components, config.roots, routeDir, entries)
    const clusters = duplicateClusters(components, duplicates)
    const health = {
      ...healthOf({
        components,
        graph,
        roots: config.roots,
        primitiveRoots: config.tiers.primitive,
        sharedRoots: config.tiers.shared,
        entries,
      }),
      duplicateClusters: clusters.length,
    }
    const withoutHash = {
      lexicon: lexiconRef("catalog"),
      root,
      tokens,
      tiers: config.tiers,
      sharedRoots: [...config.tiers.shared],
      localRoots: [...config.tiers.local],
      components,
      features,
      health,
      clusters,
      orphans,
      duplicates,
    }
    const hash = createHash("sha256").update(JSON.stringify(withoutHash)).digest("hex")
    return { hash, ...withoutHash }
  })
