import { policy } from "./policy.ts"
import {
  canonicalRegion,
  prepareUnit,
  stableId,
  type PreparedUnit,
} from "./identity.ts"
import { isRecord, type Unit } from "./workspace.ts"

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
 */
const FRAGMENT_KINDS = new Set([
  "ArrayExpression",
  "ArrowFunctionExpression",
  "AssignmentExpression",
  "AwaitExpression",
  "BlockStatement",
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
  const program = prepared.program
  if (program === undefined) return []
  const found: Array<{ start: number; end: number }> = []
  const stack: Array<unknown> = [program]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
      continue
    }
    if (!isRecord(current)) continue
    const kind = current["type"]
    const start = current["start"]
    const end = current["end"]
    if (
      typeof kind === "string" &&
      FRAGMENT_KINDS.has(kind) &&
      typeof start === "number" &&
      typeof end === "number" &&
      start - prepared.shift >= 0 &&
      end - prepared.shift <= prepared.text.length &&
      // The declaration itself is not a piece of itself.
      !(start - prepared.shift === 0 && end - prepared.shift === prepared.text.length) &&
      end - start > 1
    ) {
      found.push({ start: start - prepared.shift, end: end - prepared.shift })
    }
    for (const value of Object.values(current)) {
      if (value !== null && typeof value === "object") stack.push(value)
    }
  }
  return found
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
export const fragmentsOf = (unit: Unit): Fragments => {
  const prepared = prepareUnit(unit)
  const ids: Array<string> = []
  const seen = new Set<string>()
  let cut = false
  for (const region of regionsOf(prepared)) {
    const id = stableId(
      canonicalRegion({ prepared, region, reference: (name) => "%" + name }),
    )
    if (seen.has(id)) continue
    if (ids.length >= policy.identity.maxFragments) {
      cut = true
      break
    }
    seen.add(id)
    ids.push(id)
  }
  return { ids, cut }
}
