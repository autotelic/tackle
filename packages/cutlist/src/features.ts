import type { CatalogFeature, PartRole } from "@autotelic/protocol"
import type { SourceModule } from "./crawl.ts"
import {
  barrelNameOf,
  isHookName,
  rolesOf,
  type CompositionOptions,
  type RoleOptions,
} from "./roles.ts"

/*
 * The composition pattern as a QUERY over parts, not a pass with its own fields.
 *
 * A feature exists where the tree attempts the pattern: a module creates a context, and
 * the same directory either supplies it or exports the dot-notation barrel. Everything
 * else — which files are blocks, which hook belongs to it, which keys the provider
 * supplies — is a join over the same declaration facts the rest of the catalog uses.
 *
 * The declared vocabulary (`providerSuffix`, `hookPrefix`, `valueKeys`) is the only
 * pattern-specific input. A tree that spells the pattern differently unlocks it by
 * changing that config, not by changing this file.
 */

/** The pattern's canonical value shape. A repo may override it in its config. */
export const DEFAULT_VALUE_KEYS: ReadonlyArray<string> = ["state", "actions", "meta"]

/** One key is a coincidence; two is a shape. */
const MIN_VALUE_KEYS = 2

/** `components/settings-dialog` -> `SettingsDialog`. */
const nameOfDir = (dir: string): string => {
  const base = dir.slice(dir.lastIndexOf("/") + 1)
  return base
    .split(/[-_.]/u)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

/** The directory of a forward-slashed module path, or `.` at the top level. */
export const dirOf = (path: string): string => {
  const cut = path.lastIndexOf("/")
  return cut === -1 ? "." : path.slice(0, cut)
}

/**
 * The provider's supplied value, by the keys the repo declares.
 *
 * The best object literal wins rather than the first: a provider may build the value
 * into a variable before passing it, and a nested object with one matching key is not
 * the value. Two hits is the floor, or every declared key when the repo declares fewer.
 */
const valueKeysOf = (
  provider: SourceModule,
  declared: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  if (declared.length === 0) return []
  const floor = Math.min(MIN_VALUE_KEYS, declared.length)
  let best: ReadonlyArray<string> | undefined
  let score = 0
  for (const object of provider.objects) {
    const hits = declared.filter((key) => object.keys.includes(key)).length
    if (hits > score) {
      score = hits
      best = object.keys
    }
  }
  return score >= floor && best !== undefined ? best : []
}

/** Every composition feature the tree attempts, sorted by directory. */
export const featuresOf = (
  modules: ReadonlyArray<SourceModule>,
  options: RoleOptions,
  graph: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlyArray<CatalogFeature> => {
  const composition = options.composition
  if (composition === undefined) return []

  const byDir = new Map<string, Array<SourceModule>>()
  for (const module of modules) {
    const dir = dirOf(module.path)
    const existing = byDir.get(dir)
    if (existing === undefined) byDir.set(dir, [module])
    else existing.push(module)
  }

  const features: Array<CatalogFeature> = []
  for (const [dir, group] of byDir) {
    const roles = new Map(group.map((module) => [module.path, rolesOf(module, options)]))
    const has = (module: SourceModule, role: PartRole): boolean =>
      roles.get(module.path)?.includes(role) === true

    const context = group.find((module) => has(module, "context"))
    if (context === undefined) continue
    const provider = group.find((module) => has(module, "provider"))
    const barrel = group.find((module) => has(module, "barrel"))
    // The pattern must be ATTEMPTED. A plugin that happens to call `createContext` is
    // not a feature, and measuring it as one would report parts it never wanted.
    if (provider === undefined && barrel === undefined) continue

    const excluded = new Set([context, provider, barrel])
    // A block is a component that CONSUMES the composition, not merely a file that
    // happens to sit in the same directory. At a shared root, that difference is a
    // 60-block "feature" made of unrelated components that never touch the context.
    const consumers = new Set(graph.get(context.path) ?? [])
    const blocks = group
      .filter(
        (module) => !excluded.has(module) && has(module, "component") && consumers.has(module.path),
      )
      .map((module) => module.path)
      .sort((left, right) => left.localeCompare(right))
    const hooks = [
      ...new Set(
        group.flatMap((module) =>
          module.declarations
            .filter(
              (declaration) => declaration.exported && isHookName(composition, declaration.name),
            )
            .map((declaration) => declaration.name),
        ),
      ),
    ].sort((left, right) => left.localeCompare(right))
    const valueKeys =
      provider === undefined
        ? []
        : valueKeysOf(provider, composition.valueKeys ?? DEFAULT_VALUE_KEYS)

    features.push({
      dir,
      name:
        barrel === undefined
          ? nameOfDir(dir)
          : (barrelNameOf(barrel, composition) ?? nameOfDir(dir)),
      context: context.path,
      ...(provider === undefined ? {} : { provider: provider.path }),
      ...(barrel === undefined ? {} : { barrel: barrel.path }),
      blocks,
      hooks,
      valueKeys,
    })
  }

  return features.sort((left, right) => left.dir.localeCompare(right.dir))
}

export type { CompositionOptions }
