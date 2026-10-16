import { relativeToRoot, underAny } from "./paths.ts"

/*
 * Pass 3 — owner attribution.
 *
 * This is the crux, and it is a DECISION, not a derivation. An importer under
 * `routes/projects_.$id.sponsors/route.tsx` belongs to the domain `projects`, not to
 * that one deep directory. Use the full directory and a component imported by a few
 * `projects_.*` routes reads as "shared"; almost everything becomes shared and the tier
 * stops meaning anything. First-segment gives the granularity a component's owners are
 * actually about. Importers under a shared root all collapse to one `shared` owner.
 */

export interface OwnerOptions {
  /** The app root, repository-relative (e.g. "app"). */
  readonly root: string
  /** Where routes live, relative to the root (e.g. "routes"). */
  readonly routeDir: string
  /** Roots whose importers all read as the single "shared" owner. */
  readonly sharedRoots: ReadonlyArray<string>
  readonly routeOwner: "first-segment" | "full"
}

/** The owner an importing module contributes to the component it imports. */
export const ownerOf = (modulePath: string, options: OwnerOptions): string | undefined => {
  const path = relativeToRoot(modulePath, options.root)
  if (underAny(path, options.sharedRoots)) return "shared"
  const prefix = `${options.routeDir}/`
  if (!path.startsWith(prefix)) return undefined
  const segment = path.slice(prefix.length).split("/")[0] ?? ""
  if (segment === "") return undefined
  if (options.routeOwner === "full") return segment
  // A flat-file route is dotted (`projects_.$id.sponsors`); its domain is before the dot.
  const beforeDot = segment.split(".")[0] ?? segment
  const trimmed = beforeDot.replace(/_+$/u, "")
  return trimmed === "" ? undefined : trimmed
}

/** The distinct owners a component's importer paths contribute, sorted. */
export const ownersOf = (
  importers: ReadonlyArray<string>,
  options: OwnerOptions,
): ReadonlyArray<string> => {
  const owners = new Set<string>()
  for (const importer of importers) {
    const owner = ownerOf(importer, options)
    if (owner !== undefined) owners.add(owner)
  }
  return [...owners].sort()
}
