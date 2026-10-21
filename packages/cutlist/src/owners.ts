import { Order } from "effect"
import { afterRouteDir, underAnyRoot } from "./paths.ts"

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
  /** The source roots, repository-relative. A monorepo has one per app. */
  readonly roots: ReadonlyArray<string>
  /** Where routes live, relative to a source root (e.g. "routes" or "app"). */
  readonly routeDir: string
  /** Roots whose importers all read as the single "shared" owner. */
  readonly sharedRoots: ReadonlyArray<string>
  readonly routeOwner: "first-segment" | "full"
  /** Whether an importer's own importers count toward ownership transitively. */
  readonly transitive: boolean
}

/** The owner an importing module contributes to the component it imports. */
export const ownerOf = (modulePath: string, options: OwnerOptions): string | undefined => {
  if (
    underAnyRoot({
      modulePath,
      roots: options.roots,
      targets: options.sharedRoots,
    })
  ) {
    return "shared"
  }
  const rest = afterRouteDir({
    modulePath,
    roots: options.roots,
    routeDir: options.routeDir,
  })
  if (rest === undefined) return undefined
  const segment = rest.split("/")[0] ?? ""
  if (segment === "") return undefined
  if (options.routeOwner === "full") return segment
  // A flat-file route is dotted (`projects_.$id.sponsors`); its domain is before the dot.
  const beforeDot = segment.split(".")[0] ?? segment
  const trimmed = beforeDot.replace(/_+$/u, "")
  return trimmed === "" ? undefined : trimmed
}

/**
 * The distinct owners a component's importer paths contribute, sorted.
 *
 * Direct importers are the default. With `transitive` on, ownership follows the importers of
 * importers as well: a leaf used by one wrapper that three routes use is shared, and calling it
 * local because only the wrapper imports it directly is the wrong granularity for promotion.
 */
export const ownersOf = (
  importers: ReadonlyArray<string>,
  options: OwnerOptions,
  graph: ReadonlyMap<string, ReadonlyArray<string>> | undefined,
): ReadonlyArray<string> => {
  const owners = new Set<string>()
  const seen = new Set<string>()
  const queue = [...importers]
  while (queue.length > 0) {
    const importer = queue.pop()
    if (importer === undefined || seen.has(importer)) continue
    seen.add(importer)
    const owner = ownerOf(importer, options)
    if (owner !== undefined) owners.add(owner)
    if (options.transitive && graph !== undefined) {
      for (const next of graph.get(importer) ?? []) queue.push(next)
    }
  }
  return [...owners].sort(Order.String)
}
