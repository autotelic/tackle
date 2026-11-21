import { Data } from "effect"
import { dirname, join, resolve } from "node:path"

/** What the walk-up needs; injected so tests do not touch a real tree. */
export interface ProjectBinSearch {
  readonly cwd: string
  readonly name: string
  readonly exists: (path: string) => boolean
}

/** A found path or a reason to fall through; a tagged union, not an overloaded absence. */
export type ProjectBin = Data.TaggedEnum<{
  readonly Found: { readonly path: string }
  readonly Missing: {}
}>

const ProjectBin = Data.taggedEnum<ProjectBin>()

/**
 * The project's own bin for `name`, walking up like Node.
 *
 * A pnpm workspace keeps one `node_modules/.bin` at the root, so a package directory must
 * find it. The nearest `.git` is the boundary: a nested repository may not borrow its
 * host's binary, because that is a different project's version with no way to tell from
 * the output. With no `.git` anywhere, only `cwd` is checked — walking to `/` would let a
 * scratch directory pick up `$HOME/node_modules/.bin`.
 */
export const findProjectBin = ({ cwd, name, exists }: ProjectBinSearch): ProjectBin => {
  const start = resolve(cwd)
  const chain: Array<string> = [start]
  let dir = start
  let atRepository = false
  for (;;) {
    if (exists(join(dir, ".git"))) {
      atRepository = true
      break
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
    chain.push(dir)
  }
  for (const entry of atRepository ? chain : [start]) {
    const candidate = join(entry, "node_modules", ".bin", name)
    if (exists(candidate)) return ProjectBin.Found({ path: candidate })
  }
  return ProjectBin.Missing()
}
