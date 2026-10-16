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
export const relativeToRoot = (modulePath: string, root: string): string =>
  modulePath === root
    ? ""
    : modulePath.startsWith(`${root}/`)
      ? modulePath.slice(root.length + 1)
      : modulePath

/** Whether a path is a root or lives under one. */
export const underAny = (path: string, roots: ReadonlyArray<string>): boolean =>
  roots.some((root) => path === root || path.startsWith(`${root}/`))
