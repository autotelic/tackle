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
 * The directory every configured root lives under.
 *
 * Tiers, owners and routes are written relative to the source root (`src`, `app`, or the
 * repository root), not relative to whichever root happens to be listed first. A config
 * that lists `components` before `app` used to make `components/ui` invisible as a
 * primitive root and every component look local, which turned adoption into a coin flip.
 * The common ancestor is the only root that is true for every root list.
 */
export const commonRootOf = (roots: ReadonlyArray<string>): string => {
  const split = roots.map((root) =>
    normalizePosix(root)
      .split("/")
      .filter((part) => part !== ""),
  )
  const first = split[0]
  if (first === undefined) return ""
  let length = first.length
  for (const parts of split.slice(1)) {
    while (length > 0 && parts.slice(0, length).join("/") !== first.slice(0, length).join("/")) {
      length -= 1
    }
  }
  return first.slice(0, length).join("/")
}
