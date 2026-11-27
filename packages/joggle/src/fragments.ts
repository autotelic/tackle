import { Result } from "effect"
import { policy } from "./policy.ts"
import type { FactStore, StoredFragments } from "./store.ts"
import { canonicalRegion, nodeSpansOf, prepareUnit, stableId, type PreparedUnit } from "./identity.ts"
import type { Unit } from "./workspace.ts"

/*
 * The pieces a declaration is made of, each with its own id.
 *
 * Containment -- "is this declaration already inside that one?" -- cannot be
 * answered by comparing whole bodies: a function that calls an existing helper
 * also contains a run of statements, and the helper's body should match the
 * inner part. The unit of that comparison is a subtree id, and this module
 * produces the set for one declaration.
 *
 * Free names become namespaced markers here rather than resolved ids: a subtree
 * is a fact about one declaration's text, and `fragmentsOf` takes no workspace.
 * The markers are still name-based, so two copies under the same imports agree.
 */

/**
 * Node kinds worth calling a fragment: statements and expressions, not the
 * type annotations and patterns that belong to their parents. A type node's id
 * would change whenever a field is renamed, which is a change to the shape, not
 * a piece of behaviour to find inside another body.
 *
 * A `BlockStatement` is deliberately not one. Its id is a Merkle root of
 * everything it holds, so it duplicates the ids of the statements inside it and
 * adds nothing but noise: every edit inside the block changes the block too,
 * which double-counts the edit and makes containment a whole-body comparison
 * again -- the comparison fragments exist to avoid.
 */
const FRAGMENT_KINDS = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "AwaitExpression",
  "BreakStatement",
  "CallExpression",
  "ConditionalExpression",
  "ContinueStatement",
  "ExpressionStatement",
  "ForInStatement",
  "ForOfStatement",
  "ForStatement",
  "FunctionExpression",
  "IfStatement",
  "NewExpression",
  "ObjectExpression",
  "ReturnStatement",
  "SwitchStatement",
  "TemplateLiteral",
  "ThrowStatement",
  "TryStatement",
  "VariableDeclaration",
  "WhileStatement",
  "YieldExpression",
])

/** The node spans in this unit that are fragments, outermost first. */
const regionsOf = (prepared: PreparedUnit): ReadonlyArray<{ start: number; end: number }> => {
  if (prepared.program === undefined) return []
  return nodeSpansOf(prepared.program, FRAGMENT_KINDS)
    .map(({ start, end }) => ({ start: start - prepared.shift, end: end - prepared.shift }))
    .filter(
      ({ start, end }) =>
        start >= 0 &&
        end <= prepared.text.length &&
        // The declaration itself is not a piece of itself.
        !(start === 0 && end === prepared.text.length) &&
        end - start > 1,
    )
}

export interface Fragments {
  /** Deduplicated subtree ids, in the order the code first presents them. */
  readonly ids: ReadonlyArray<string>
  /** True when the policy bound cut the set, so a caller never reads it as complete. */
  readonly cut: boolean
}

/**
 * The deduplicated subtree ids of one declaration, bounded.
 *
 * The bound is a search bound and the cut is reported: a set that silently
 * stops at `maxFragments` would make containment under-report, and under-reporting
 * reads as "nothing here" rather than "I stopped looking".
 */
export const fragmentsOf = (unit: Unit, store: FactStore | undefined): Fragments => {
  if (store !== undefined) {
    const cached = store.cached(unit)
    if (Result.isSuccess(cached)) return cached.success
  }
  const prepared = prepareUnit(unit)
  const ids: Array<string> = []
  const seen = new Set<string>()
  let cut = false
  for (const region of regionsOf(prepared)) {
    const id = stableId(canonicalRegion({ prepared, region, reference: (name) => "%" + name }))
    if (seen.has(id)) continue
    if (ids.length >= policy.identity.maxFragments) {
      cut = true
      break
    }
    seen.add(id)
    ids.push(id)
  }
  const fragments = { ids, cut }
  // The store is a cache of this exact walk, keyed by the unit's text. A hit
  // returned above; a miss fills it so the next run never parses this unit again.
  store?.store(unit, fragments)
  return fragments
}
