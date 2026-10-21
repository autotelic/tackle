import type { PartRole } from "@autotelic/protocol"
import type { SourceModule } from "./crawl.ts"

/*
 * A part's roles, read from its declarations rather than its filename.
 *
 * `settings-context.tsx` is not a "component" because it is a file; it is a context
 * because it calls `createContext`, and a hook because it exports `useSettings`. A
 * provider is a component that renders `*.Provider`. The barrel is the object literal a
 * feature exports under one name. Nothing here looks at a directory called `components`.
 *
 * Provider, barrel, and hook are only claimed when the repo declares the composition
 * pattern. An undeclared convention is a guess, and a catalog that guesses is worse than
 * one that stays silent.
 */

/** How the repo spells a composition pattern. Absent means "do not claim it". */
export interface CompositionOptions {
  readonly providerSuffix: string
  readonly hookPrefix: string
  readonly valueKeys?: ReadonlyArray<string>
}

/** Everything role inference is allowed to know beyond the module itself. */
export interface RoleOptions {
  readonly composition?: CompositionOptions
  /** The declared local root, used to recognise a route. */
  readonly routePrefix: string
}

/** A declared hook, spelled with the repo's own prefix and a capitalised head. */
export const isHookName = (definition: CompositionOptions, name: string): boolean =>
  name.length > definition.hookPrefix.length &&
  name.startsWith(definition.hookPrefix) &&
  /[A-Z]/u.test(name.charAt(definition.hookPrefix.length))

/** The name an index-like module is conventionally given. */
const baseOf = (path: string): string => {
  const cut = path.lastIndexOf("/")
  return cut === -1 ? path : path.slice(cut + 1)
}

/** Whether a module exports the feature's dot-notation object. */
const dotExportOf = (
  module: SourceModule,
  definition: CompositionOptions,
): { readonly name: string; readonly keys: ReadonlyArray<string> } | undefined => {
  for (const declaration of module.declarations) {
    if (!declaration.exported || declaration.objectKeys === undefined) continue
    if (declaration.objectKeys.includes(definition.providerSuffix)) {
      return { name: declaration.name, keys: declaration.objectKeys }
    }
  }
  return undefined
}

/** Every role the module actually carries. */
export const rolesOf = (module: SourceModule, options: RoleOptions): ReadonlyArray<PartRole> => {
  const roles = new Set<PartRole>()
  const composition = options.composition

  if (module.declarations.some((declaration) => declaration.exported && declaration.renders)) {
    roles.add("component")
  }
  if (composition !== undefined) {
    if (
      module.declarations.some(
        (declaration) => declaration.exported && isHookName(composition, declaration.name),
      )
    ) {
      roles.add("hook")
    }
    if (module.createsContext) roles.add("context")
    if (module.tags.some((tag) => tag.endsWith(`.${composition.providerSuffix}`))) {
      roles.add("provider")
    }
    if (dotExportOf(module, composition) !== undefined) roles.add("barrel")
  }
  if (module.path.startsWith(options.routePrefix)) roles.add("route")
  if (roles.size === 0) roles.add("module")

  return [...roles].sort((left, right) => left.localeCompare(right))
}

/** The one role a part is listed under. The rest stay available as facets. */
const KIND_ORDER: ReadonlyArray<PartRole> = [
  "component",
  "hook",
  "context",
  "provider",
  "barrel",
  "route",
  "module",
]

export const kindOf = (roles: ReadonlyArray<PartRole>): PartRole =>
  KIND_ORDER.find((kind) => roles.includes(kind)) ?? "module"

/** The composition pattern's barrel declaration, when the module is one. */
export const barrelNameOf = (
  module: SourceModule,
  definition: CompositionOptions,
): string | undefined => dotExportOf(module, definition)?.name

export { baseOf }
