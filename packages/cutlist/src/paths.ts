import { Predicate } from "effect"

/*
 * Small path helpers, kept in one place so owners, tiers, and the use-graph agree on
 * what "a path" means. Everything is repository-relative and forward-slashed by the
 * time it reaches here; the crawler normalizes at the boundary.
 */

/** Collapse `.`/`..` and repeated slashes in a forward-slashed path. */
export const normalizePosix = (path: string): string => {
  const parts: Array<string> = []
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

/** The directory of a forward-slashed path. */
export const dirnamePosix = (path: string): string => {
  const index = path.lastIndexOf("/")
  return index < 0 ? "" : path.slice(0, index)
}

/** Drop the app root from a repository-relative module path. */
export const relativeToRoot = ({
  modulePath,
  root,
}: {
  readonly modulePath: string
  readonly root: string
}): string =>
  modulePath === root
    ? ""
    : modulePath.startsWith(`${root}/`)
      ? modulePath.slice(root.length + 1)
      : modulePath

/** Whether a path is a root or lives under one. */
export const underAny = (path: string, roots: ReadonlyArray<string>): boolean =>
  roots.some((root) => path === root || path.startsWith(`${root}/`))

/**
 * The spellings a module path has under a multi-root config: itself, plus each root-relative
 * view that actually changes it.
 *
 * A tier root is written once (`components/ui`) but a monorepo has one `components/ui` per
 * app. Matching only the common ancestor made `apps/shop/ui/app/components/ui` invisible;
 * matching only the containing root made `components/ui` invisible when the roots themselves
 * were `components`, `app`, and `lib`. Both spellings are true, so both are tried.
 */
const pathCandidates = (
  modulePath: string,
  roots: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const candidates = [modulePath]
  for (const root of roots) {
    const relative = relativeToRoot({ modulePath, root })
    if (relative !== modulePath) candidates.push(relative)
  }
  return candidates
}

/** Whether a module is under one of the targets, seen from itself or any configured root. */
export const underAnyRoot: Predicate.Predicate<{
  readonly modulePath: string
  readonly roots: ReadonlyArray<string>
  readonly targets: ReadonlyArray<string>
}> = ({ modulePath, roots, targets }) =>
  pathCandidates(modulePath, roots).some((path) => underAny(path, targets))

/**
 * The first segment of a route path, when the module sits under `routeDir` from itself or a
 * configured root.
 *
 * The first segment of this remainder is the owner. Returning `undefined` rather than `""`
 * is the difference between "not a route" and "the route directory itself".
 */
export const afterRouteDir = ({
  modulePath,
  roots,
  routeDir,
}: {
  readonly modulePath: string
  readonly roots: ReadonlyArray<string>
  readonly routeDir: string
}): string | undefined => {
  for (const path of pathCandidates(modulePath, roots)) {
    if (path === routeDir) return ""
    if (path.startsWith(`${routeDir}/`)) return path.slice(routeDir.length + 1)
  }
  return undefined
}

/**
 * The files that name a route entry inside a route directory.
 *
 * Remix writes flat route files and `<route>/route.tsx`; Next writes `page`, `layout`, and
 * friends. A component under `<route>/components/` is not a route, even though its owner is
 * the route. Keeping the two facts apart is what keeps the route list honest.
 */
const ROUTE_FILE =
  /^(?:route|page|layout|template|default|error|global-error|loading|not-found|404|500)\.(?:[cm]?[jt]sx?)$/u

/** Whether a module is a route entry, as opposed to a component owned by a route. */
export const isRouteEntry: Predicate.Predicate<{
  readonly modulePath: string
  readonly roots: ReadonlyArray<string>
  readonly routeDir: string
}> = ({ modulePath, roots, routeDir }) => {
  const tail = afterRouteDir({ modulePath, roots, routeDir })
  if (tail === undefined || tail === "") return false
  const segments = tail.split("/").filter((segment) => segment !== "")
  if (segments.length === 1) return true
  const last = segments[segments.length - 1]
  return segments.length === 2 && last !== undefined && ROUTE_FILE.test(last)
}

/**
 * Whether a module is a declared entry point.
 *
 * An entry point is the same kind of fact as a route: nothing imports it by design. Frameworks
 * spell it differently (`entry.client.tsx`, `root.tsx`, `main.tsx`), so the repository declares
 * the names rather than cutlist guessing them. A suffix matches inside any configured root.
 */
export const isEntryPoint: Predicate.Predicate<{
  readonly modulePath: string
  readonly roots: ReadonlyArray<string>
  readonly entries: ReadonlyArray<string>
}> = ({ modulePath, roots, entries }) =>
  entries.some((entry) =>
    pathCandidates(modulePath, roots).some((path) => path === entry || path.endsWith(`/${entry}`)),
  )
