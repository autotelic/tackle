import type { RunContext } from "./rule.ts"
import type { SourceFile, Unit } from "./workspace.ts"

/**
 * The checker's type at each recorded `return` of a declaration.
 *
 * The declaration-level trace joins a NAME to its type. This joins a RETURN
 * EXPRESSION to its type through the node-type layer, by byte offset, which is
 * the one fact a candidate filter can read before a judgement is paid for: a
 * helper that returns `number` cannot be the single path for a string, and a
 * function that returns `boolean` does not shorten the data its caller reads.
 *
 * Empty when the type layer did not run, or when the declaration records no
 * `return`. An empty answer is UNKNOWN, not "no".
 */
export const returnTypesOf = (
  unit: Unit,
  file: SourceFile | undefined,
  nodeTypes: RunContext["nodeTypes"],
): ReadonlyArray<string | undefined> => {
  if (nodeTypes === undefined || file === undefined) return []
  return file.facts.returns
    .filter((site) => site.start >= unit.start && site.end <= unit.end)
    .map((site) => nodeTypes(unit.file, site.start))
}

/**
 * Whether a declaration can produce a value outside `excluded`.
 *
 * True when the answer is unknown -- no type layer, no recorded return, or a
 * return the checker could not type -- because a filter must never lose a real
 * candidate to save a judgement. Only a declaration whose every recorded return
 * is one of `excluded` is dropped.
 */
export const mayYield = (
  types: ReadonlyArray<string | undefined>,
  excluded: ReadonlySet<string>,
): boolean => types.length === 0 || types.some((type) => type === undefined || !excluded.has(type))
