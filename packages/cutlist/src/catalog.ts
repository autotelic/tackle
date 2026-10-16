import { createHash } from "node:crypto"
import { Effect, FileSystem, Path } from "effect"
import {
  PROTOCOL_VERSION,
  signatureOf,
  similarityOf,
  type Catalog,
  type CatalogComponent,
  type CutlistConfig,
  type DuplicateCandidate,
} from "@autotelic/protocol"
import { listSources, readModules, type SourceModule } from "./crawl.ts"
import { dirnamePosix, normalizePosix } from "./paths.ts"
import { ownersOf } from "./owners.ts"
import { skeletonOf } from "./signature.ts"
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
export const DUPLICATE_THRESHOLD = 0.6

const stripExtension = (path: string): string => path.replace(/\.(tsx?|jsx?)$/u, "")

/** A component's name: its file, or the directory for `index`/`route` conventions. */
const nameOfModule = (path: string): string => {
  const file = path.slice(path.lastIndexOf("/") + 1).replace(/\.(tsx?|jsx?)$/u, "")
  if (file !== "index" && file !== "route") return file
  const dirName = dirnamePosix(path).slice(dirnamePosix(path).lastIndexOf("/") + 1)
  return dirName === "" ? file : dirName
}

interface AliasRule {
  readonly prefix: string
  readonly replacement: string
}

const aliasRules = (
  alias: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyArray<AliasRule> => {
  const rules: Array<AliasRule> = []
  for (const [pattern, targets] of Object.entries(alias)) {
    const target = targets[0]
    if (target !== undefined && pattern.endsWith("/*")) {
      rules.push({ prefix: pattern.slice(0, -1), replacement: target.slice(0, -1) })
    }
  }
  return rules
}

/** A source extension, written the way an import specifier spells it (`./Button.tsx`). */
const SOURCE_EXTENSION = /\.(tsx?|jsx?|mts|cts|mjs|cjs)$/u

/** Resolve an import specifier to a candidate module base path, or nothing if external. */
const resolveSpecifier = (
  specifier: string,
  importerDir: string,
  rules: ReadonlyArray<AliasRule>,
): string | undefined => {
  let resolved: string | undefined
  if (specifier.startsWith(".")) {
    resolved = normalizePosix(`${importerDir}/${specifier}`)
  } else {
    for (const rule of rules) {
      if (specifier.startsWith(rule.prefix)) {
        resolved = normalizePosix(rule.replacement + specifier.slice(rule.prefix.length))
        break
      }
    }
  }
  // The graph is keyed by the extension-less base, because one module is one module however
  // a caller spells it. Readers in this workspace import WITH an extension
  // (`allowImportingTsExtensions`), so dropping it here is the difference between a real
  // use-graph and one where every component is an orphan.
  return resolved === undefined ? undefined : resolved.replace(SOURCE_EXTENSION, "")
}

/** Pass 2 — for each module, the modules that import it. Exported for the graph's own test. */
export const importerGraph = (
  modules: ReadonlyArray<SourceModule>,
  alias: Readonly<Record<string, ReadonlyArray<string>>>,
): ReadonlyMap<string, ReadonlyArray<string>> => {
  const byBase = new Map<string, string>()
  for (const module of modules) {
    const base = stripExtension(module.path)
    byBase.set(base, module.path)
    if (base.endsWith("/index")) byBase.set(base.slice(0, -"/index".length), module.path)
  }
  const rules = aliasRules(alias)
  const importers = new Map<string, Set<string>>()
  for (const module of modules) {
    const dir = dirnamePosix(module.path)
    for (const specifier of module.imports) {
      const resolved = resolveSpecifier(specifier, dir, rules)
      if (resolved === undefined) continue
      const target = byBase.get(resolved)
      if (target === undefined || target === module.path) continue
      const set = importers.get(target) ?? new Set<string>()
      set.add(module.path)
      importers.set(target, set)
    }
  }
  return new Map([...importers].map(([key, value]) => [key, [...value].sort()]))
}

/** A route/page module — an entry point, not a component. */
const isRouteModule = (path: string, routePrefix: string): boolean => path.startsWith(routePrefix)

/** Pass 5b — the all-pairs candidate join. High recall; a judge in `joggle` decides. */
const duplicateCandidates = (
  components: ReadonlyArray<CatalogComponent>,
  routePrefix: string,
): ReadonlyArray<DuplicateCandidate> => {
  const candidates: Array<DuplicateCandidate> = []
  for (let leftIndex = 0; leftIndex < components.length; leftIndex += 1) {
    const left = components[leftIndex]
    if (left === undefined) continue
    const leftSignature = signatureOf(left)
    if (leftSignature.size === 0) continue
    for (let rightIndex = leftIndex + 1; rightIndex < components.length; rightIndex += 1) {
      const right = components[rightIndex]
      if (right === undefined || right.signature.length === 0) continue
      // Two route files rendering the same shared component are not duplicates; they
      // are two pages. Route-vs-component IS kept: a page that inlined a copy is a smell.
      if (isRouteModule(left.path, routePrefix) && isRouteModule(right.path, routePrefix)) continue
      const score = similarityOf(leftSignature, signatureOf(right))
      if (score < DUPLICATE_THRESHOLD) continue
      candidates.push({ left: left.path, right: right.path, score, basis: "skeleton" })
    }
  }
  return candidates.sort(
    (left, right) =>
      right.score - left.score ||
      left.left.localeCompare(right.left) ||
      left.right.localeCompare(right.right),
  )
}

/** Build the whole model. */
export const buildCatalog = (
  root: string,
  config: CutlistConfig,
): Effect.Effect<Catalog, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const files = yield* listSources(root, config.roots)
    const modules = yield* readModules(root, files)
    const graph = importerGraph(modules, config.alias ?? {})

    const appRoot = config.roots[0] ?? "app"
    const routeDir = config.tiers.local[0] ?? "routes"
    const routePrefix = `${appRoot}/${routeDir}/`
    const ownerOptions = {
      root: appRoot,
      routeDir,
      sharedRoots: config.tiers.shared,
      routeOwner: config.ownership.routeOwner,
    }
    const tierOptions = {
      root: appRoot,
      primitiveRoots: config.tiers.primitive,
      sharedRoots: config.tiers.shared,
      localRoots: config.tiers.local,
    }

    const components: ReadonlyArray<CatalogComponent> = modules
      .map((module) => {
        const owners = ownersOf(graph.get(module.path) ?? [], ownerOptions)
        return {
          path: module.path,
          name: nameOfModule(module.path),
          tier: tierOf(module.path, owners, tierOptions),
          owners,
          props: module.props,
          tags: module.tags,
          signature: skeletonOf(module),
          documented: module.documented,
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))

    const tokens = yield* extractTokens(root, config.tokens)
    // An orphan is "nothing imports it". A route is an entry point — nothing imports
    // it BY DESIGN, so counting it would drown the real signal (unused primitives and
    // flattened copies) in page files.
    const orphans = components
      .filter(
        (component) => component.owners.length === 0 && !isRouteModule(component.path, routePrefix),
      )
      .map((component) => component.path)

    const withoutHash = {
      protocolVersion: PROTOCOL_VERSION,
      root,
      tokens,
      tiers: config.tiers,
      sharedRoots: [...config.tiers.shared],
      localRoots: [...config.tiers.local],
      components,
      orphans,
      duplicates: duplicateCandidates(components, routePrefix),
    }
    const hash = createHash("sha256").update(JSON.stringify(withoutHash)).digest("hex")
    return { hash, ...withoutHash }
  })
