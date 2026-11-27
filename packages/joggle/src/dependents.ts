import { identityOf } from "./identity.ts"
import type { Unit, Workspace } from "./workspace.ts"

/*
 * Who depends on a declaration, at declaration granularity.
 *
 * joggle has this at file level: `imports.importersOf` answers "which files
 * import this file". That is too coarse for a collapse proposal, which needs to
 * say "these four declarations call the one you want to delete" rather than
 * "seven files import something from that module". The edges here are the same
 * resolved references identity already walks -- calls and type names -- so there
 * is no second graph to disagree with the first.
 */

/**
 * For each declaration id, the declarations that reference it.
 *
 * A unit appears at most once under a given id no matter how many times it names
 * the target: a repeat call is not a second dependent. A self-recursive
 * declaration lists itself, which is the truth and what a delete would break.
 */
export const dependentsOf = (workspace: Workspace): ReadonlyMap<string, ReadonlyArray<Unit>> => {
  const index = identityOf(workspace)
  const byId = new Map<string, Array<Unit>>()
  for (const { unit } of index.declarations) {
    const counted = new Set<string>()
    for (const target of index.references.get(unit) ?? []) {
      const id = index.ids.get(target)
      if (id === undefined || counted.has(id)) continue
      counted.add(id)
      const existing = byId.get(id)
      if (existing === undefined) byId.set(id, [unit])
      else existing.push(unit)
    }
  }
  return byId
}
