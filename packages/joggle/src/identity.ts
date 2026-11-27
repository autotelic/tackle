import { createHash } from "node:crypto"
import { resolve } from "node:path"
import { Predicate, Order } from "effect"
import { parseSync } from "oxc-parser"
import { blockingErrors, type Region } from "./astro.ts"
import {
  collectIdentifiers,
  isRecord,
  langOf,
  type IdentifierSite,
  type Unit,
  type Workspace,
} from "./workspace.ts"

/*
 * Identity that survives a rename and dies on a real change.
 *
 * joggle's existing keys are two wrong answers to the same question. A
 * `typeSignature` names the file the declaration lives in, so moving the file
 * changes the key even though the declaration did not. `unit.shape` replaces
 * every identifier with `_`, so a rename is invisible -- correctly -- but so is
 * `a - b` becoming `b - a`, which is not the same function.
 *
 * This module follows Unison instead: a declaration's id is a hash of its
 * internal structure with all NAMES erased -- bound variables become positions,
 * referenced declarations become their own ids -- so a rename never changes an
 * id and a real change always does. A file path is never part of an id: the
 * `resolveRef` bug taught that a path in a key is a rename waiting to break it.
 *
 * Everything here is a pure function over the workspace. No file is read, no
 * cache is written.
 */

/**
 * Part of every id, in the hashed bytes.
 *
 * A change to how structure is normalised therefore invalidates every id at
 * once, visibly, instead of silently rewriting what a stored decision means.
 * A ledger keyed by these ids must migrate as a deliberate act; bumping this
 * string is that act.
 */
export const HASH_VERSION = "joggle-identity-2"

/** Crockford's alphabet, lowercased: no i, l, o or u to misread. */
const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"

const base32 = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let out = ""
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET.charAt((value >>> (bits - 5)) & 31)
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET.charAt((value << (5 - bits)) & 31)
  return out
}

/**
 * The id of a canonical encoding: sha256, rendered short.
 *
 * The version rides inside the hash rather than beside it, so no caller can
 * produce an old id with a new normaliser. Ten bytes is sixteen characters --
 * enough that a collision is not the thing that will break first.
 */
export const stableId = (encoding: string): string =>
  base32(
    createHash("sha256")
      .update(HASH_VERSION + "\u0000" + encoding)
      .digest()
      .subarray(0, 10),
  )

/* -------------------------------------------------------------------------- */
/* Reading one declaration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * A declaration's own text, read once.
 *
 * The AST is parsed from `unit.text` rather than found in the file's AST: the
 * file is not carried on the unit, and the text is already the exact span the
 * unit addresses. `failed` is a fact rather than silence -- a fragment of a
 * `.astro` template, for instance, is not TypeScript on its own.
 */
export interface PreparedUnit {
  readonly unit: Unit
  readonly text: string
  readonly sites: ReadonlyArray<IdentifierSite>
  readonly bound: ReadonlySet<string>
  readonly comments: ReadonlyArray<Region>
  readonly literals: ReadonlyArray<Region>
  /** Offset of the declared name inside the text, when the text contains it. */
  readonly declared: number | undefined
  readonly program: AstNode | undefined
  /** The blanked text used when the declaration cannot be parsed on its own. */
  readonly opaque: string
  /** How far the parsed program is shifted from the unit's own text. */
  readonly shift: number
  readonly failed: boolean
}

/** The parsed node fields this module reads before narrowing the rest of the tree. */
export interface AstNode {
  readonly type?: string
  readonly start?: number
  readonly end?: number
}

/** Identifiers bound by a declaration: parameters, locals, catch params, type params. */
const addBindingPattern = ({
  node,
  names,
}: {
  readonly node: unknown
  readonly names: Set<string>
}): void => {
  const stack: Array<unknown> = [node]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
      continue
    }
    if (!isRecord(current)) continue
    const kind = current["type"]
    if (kind === "Identifier") {
      const name = current["name"]
      if (Predicate.isString(name)) names.add(name)
      continue
    }
    if (kind === "Property") {
      stack.push(current["value"])
      continue
    }
    if (kind === "ObjectPattern") {
      stack.push(current["properties"])
      continue
    }
    if (kind === "ArrayPattern") {
      stack.push(current["elements"])
      continue
    }
    if (kind === "AssignmentPattern") {
      stack.push(current["left"])
      continue
    }
    if (kind === "RestElement") {
      stack.push(current["argument"])
      continue
    }
    if (kind === "TSParameterProperty") {
      stack.push(current["parameter"])
    }
  }
}

/**
 * Every name this declaration binds somewhere inside it.
 *
 * A name set rather than a scope tree: a local's identity is its position in
 * the canonical order of first occurrence, and shadowing two different locals
 * with one name is rare enough that conflating them costs less than a second
 * resolver. The important half is the other one -- a name NOT in this set is a
 * reference, and references are what make a Merkle id.
 */
const collectBoundNames = (root: AstNode): ReadonlySet<string> => {
  const names = new Set<string>()
  const stack: Array<unknown> = [root]
  while (stack.length > 0) {
    const current = stack.pop()
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item)
      continue
    }
    if (!isRecord(current)) continue
    const kind = current["type"]
    if (kind === "VariableDeclarator") addBindingPattern({ node: current["id"], names })
    if (kind === "CatchClause") addBindingPattern({ node: current["param"], names })
    if (kind === "TSTypeParameter") {
      const name = current["name"]
      if (isRecord(name) && Predicate.isString(name["name"])) names.add(name["name"])
    }
    if (
      kind === "FunctionDeclaration" ||
      kind === "FunctionExpression" ||
      kind === "ClassDeclaration" ||
      kind === "ClassExpression"
    ) {
      const id = current["id"]
      if (isRecord(id) && Predicate.isString(id["name"])) names.add(id["name"])
    }
    const params = current["params"]
    if (Array.isArray(params)) {
      for (const param of params) addBindingPattern({ node: param, names })
    }
    // Index signatures spell their parameters as `parameters`, not `params`.
    const parameters = current["parameters"]
    if (Array.isArray(parameters)) {
      for (const param of parameters) addBindingPattern({ node: param, names })
    }

    for (const value of Object.values(current)) {
      if (Predicate.isObjectOrArray(value)) stack.push(value)
    }
  }
  return names
}

/** Node kinds whose exact text is meaning, so whitespace inside them is preserved. */
const LITERAL_KINDS = new Set([
  "StringLiteral",
  "NumericLiteral",
  "BigIntLiteral",
  "RegExpLiteral",
  "BooleanLiteral",
  "NullLiteral",
  "TemplateElement",
  "JSXText",
])

/** The spans of every AST node whose `type` is in `kinds`, in walk order. */
export const nodeSpansOf = (root: AstNode, kinds: ReadonlySet<string>): ReadonlyArray<Region> => {
  const spans: Array<Region> = []
  const stack: Array<unknown> = [root]
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
      Predicate.isString(kind) &&
      kinds.has(kind) &&
      Predicate.isNumber(start) &&
      Predicate.isNumber(end)
    ) {
      spans.push({ start, end })
    }
    for (const value of Object.values(current)) {
      if (Predicate.isObjectOrArray(value)) stack.push(value)
    }
  }
  return spans
}

/** Read a declaration's text as a program of its own. */
export const prepareUnit = (unit: Unit): PreparedUnit => {
  const text = unit.text
  const opaque = unit["shape"]
  const failed = (): PreparedUnit => ({
    unit,
    text,
    sites: [],
    bound: new Set(),
    comments: [],
    literals: [],
    declared: undefined,
    program: undefined,
    opaque,
    shift: 0,
    failed: true,
  })
  // A class or object method's span starts at its parameter list, which is a
  // function expression with no `function` keyword -- not a program. One retry
  // with the keyword restores the syntax, and `shift` maps the spans back.
  let parsed = parseSync(unit.file, text, { sourceType: "module", lang: langOf(unit.file) })
  let shift = 0
  if (blockingErrors(unit.file, parsed.errors).length > 0) {
    const keyword = "function "
    parsed = parseSync(unit.file, keyword + text, {
      sourceType: "module",
      lang: langOf(unit.file),
    })
    if (blockingErrors(unit.file, parsed.errors).length > 0) return failed()
    shift = keyword.length
  }
  if (!isRecord(parsed.program)) return failed()
  const program = parsed.program
  const inside = (start: number, end: number): boolean =>
    start - shift >= 0 && end - shift <= text.length
  const declaredOffset = unit.namePosition - unit.start
  const bound = new Set(collectBoundNames(program))
  const declared = declaredOffset >= 0 && declaredOffset < text.length ? declaredOffset : undefined
  // A declaration's own name is not a local binding: `function f() { return f() }`
  // must make a REFERENCE to itself (and so a cycle), not a positional use of a
  // parameter. The name is excluded from the encoding either way; this only
  // stops it from consuming a position on the way past.
  if (declared !== undefined) bound.delete(unit.name)
  return {
    unit,
    text,
    sites: [...collectIdentifiers(program)]
      .filter((site) => inside(site.start, site.end))
      .map((site) => ({ ...site, start: site.start - shift, end: site.end - shift }))
      .sort((left, right) => left.start - right.start),
    bound,
    comments: parsed.comments
      .filter((comment) => inside(comment.start, comment.end))
      .map((comment) => ({ start: comment.start - shift, end: comment.end - shift })),
    literals: nodeSpansOf(program, LITERAL_KINDS)
      .filter((span) => inside(span.start, span.end))
      .map((span) => ({ start: span.start - shift, end: span.end - shift })),
    declared,
    program,
    opaque,
    shift,
    failed: false,
  }
}

/* -------------------------------------------------------------------------- */
/* Canonical encoding                                                          */
/* -------------------------------------------------------------------------- */

interface Slot {
  readonly start: number
  readonly end: number
  readonly text: string
  readonly preserve: boolean
}

const collapse = (text: string): string => text.replace(/\s+/g, " ")

/**
 * The canonical text of one region of a declaration.
 *
 * `reference` decides what a free name becomes: another declaration's id, or a
 * namespaced marker when it cannot be resolved. It is a callback because the
 * Merkle pass cannot know a target's id until that target is hashed.
 *
 * Bound names are positions in the order they first appear, so `x => x + 1` and
 * `y => y + 1` encode identically while `a - b` does not. Property names and
 * string literals are kept verbatim: renaming `user.name` or editing `"yes"`
 * changes what the code means, and an identity that ignored either would be
 * lying about change.
 *
 * The declaration's own name is the one name with no slot at all. Skipping the
 * identifier site is not enough: the text between slots is emitted verbatim, so
 * `alpha` would still ride along inside `function alpha(`. The name is therefore
 * a slot that emits nothing, and it swallows the whitespace on either side --
 * `function beta (` and `function alpha(` are the same declaration, and a rename
 * must not be visible through the space the old name left behind.
 */
export const canonicalRegion = ({
  prepared,
  region,
  reference,
}: {
  readonly prepared: PreparedUnit
  readonly region: Region
  readonly reference: (name: string) => string
}): string => {
  if (prepared.failed) return "opaque:" + prepared.opaque

  const slots: Array<Slot> = []
  const positions = new Map<string, number>()
  for (const site of prepared.sites) {
    if (site.start < region.start || site.end > region.end) continue
    if (site.start === prepared.declared) {
      // Unison's rule: a term's name is metadata, not structure. Drop the name
      // and the gap it occupied, so the declared name is never an input.
      let start = site.start
      while (start > region.start && /\s/.test(prepared.text.charAt(start - 1))) start -= 1
      let end = site.end
      while (end < region.end && /\s/.test(prepared.text.charAt(end))) end += 1
      slots.push({ start, end, text: "", preserve: false })
      continue
    }
    if (site.siteKind === "property") continue
    if (prepared.bound.has(site.name)) {
      let position = positions.get(site.name)
      if (position === undefined) {
        position = positions.size
        positions.set(site.name, position)
      }
      slots.push({
        start: site.start,
        end: site.end,
        text: "$" + String(position),
        preserve: false,
      })
      continue
    }
    slots.push({
      start: site.start,
      end: site.end,
      text: reference(site.name),
      preserve: false,
    })
  }
  for (const comment of prepared.comments) {
    if (comment.start < region.start || comment.end > region.end) continue
    slots.push({ start: comment.start, end: comment.end, text: " ", preserve: false })
  }
  for (const literal of prepared.literals) {
    if (literal.start < region.start || literal.end > region.end) continue
    slots.push({
      start: literal.start,
      end: literal.end,
      text: prepared.text.slice(literal.start, literal.end),
      preserve: true,
    })
  }
  slots.sort((left, right) => left.start - right.start)

  let out = ""
  let cursor = region.start
  for (const slot of slots) {
    if (slot.start < cursor) continue
    out += collapse(prepared.text.slice(cursor, slot.start)) + slot.text
    cursor = slot.end
  }
  return (out + collapse(prepared.text.slice(cursor, region.end))).trim()
}

/* -------------------------------------------------------------------------- */
/* References and Merkle ids                                                   */
/* -------------------------------------------------------------------------- */

/** How a free name finds the declaration it means. */
export interface IdentityContext {
  readonly targetOf: (unit: Unit, name: string) => Unit | undefined
  /** A target's computed id, or undefined when it has not been hashed yet. */
  readonly idOf: (target: Unit) => string | undefined
}

interface Encoding {
  readonly encoding: string
  readonly references: ReadonlyArray<Unit>
  readonly unresolved: number
}

const encodeWith = ({
  prepared,
  context,
}: {
  readonly prepared: PreparedUnit
  readonly context: IdentityContext
}): Encoding => {
  const references: Array<Unit> = []
  let unresolved = 0
  const encoding = canonicalRegion({
    prepared,
    region: { start: 0, end: prepared.text.length },
    reference: (name) => {
      const target = context.targetOf(prepared.unit, name)
      if (target === undefined) {
        unresolved += 1
        // A namespaced marker, never a path: an external name is the same name
        // wherever it appears, and a file path here would die on a move.
        return "%" + name
      }
      references.push(target)
      const id = context.idOf(target)
      return id === undefined ? "#pending" : "@" + id
    },
  })
  return { encoding, references, unresolved }
}

/** The declarations a name in this file can resolve to. */
const resolverOf = (workspace: Workspace): IdentityContext["targetOf"] => {
  const local = new Map<string, Map<string, Unit>>()
  for (const unit of workspace.units) {
    let names = local.get(unit.file)
    if (names === undefined) {
      names = new Map()
      local.set(unit.file, names)
    }
    if (!names.has(unit.name)) names.set(unit.name, unit)
  }
  const imported = new Map<string, Map<string, Unit>>()
  for (const edge of workspace.imports.edges) {
    if (edge.resolution !== "resolved") continue
    const targets = local.get(edge.to)
    if (targets === undefined) continue
    let names = imported.get(edge.importer)
    if (names === undefined) {
      names = new Map()
      imported.set(edge.importer, names)
    }
    for (const name of edge.names) {
      const target = targets.get(name)
      if (target !== undefined && !names.has(name)) names.set(name, target)
    }
  }
  return (unit, name) => local.get(unit.file)?.get(name) ?? imported.get(unit.file)?.get(name)
}

/* -------------------------------------------------------------------------- */
/* Strongly connected components                                               */
/* -------------------------------------------------------------------------- */

interface Frame {
  readonly unit: Unit
  next: number
}

/**
 * SCCs, dependencies first.
 *
 * Kosaraju rather than recursion: a workspace can have more declarations than
 * the stack can hold, and a stack overflow in an identity pass would read as a
 * failed run rather than the graph it is. The components come back with every
 * target before the units that reference it, which is exactly the order the
 * Merkle pass needs.
 */
const componentsOf = ({
  units,
  references,
}: {
  readonly units: ReadonlyArray<Unit>
  readonly references: ReadonlyMap<Unit, ReadonlyArray<Unit>>
}): ReadonlyArray<ReadonlyArray<Unit>> => {
  const adjacency = (unit: Unit): ReadonlyArray<Unit> => references.get(unit) ?? []
  const visited = new Set<Unit>()
  const finished: Array<Unit> = []

  for (const start of units) {
    if (visited.has(start)) continue
    visited.add(start)
    const stack: Array<Frame> = [{ unit: start, next: 0 }]
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]
      if (frame === undefined) break
      const next = adjacency(frame.unit)[frame.next]
      if (next !== undefined) {
        frame.next += 1
        if (!visited.has(next)) {
          visited.add(next)
          stack.push({ unit: next, next: 0 })
        }
        continue
      }
      finished.push(frame.unit)
      stack.pop()
    }
  }

  const reverse = new Map<Unit, Array<Unit>>()
  for (const [unit, targets] of references) {
    for (const target of targets) {
      const sources = reverse.get(target)
      if (sources === undefined) reverse.set(target, [unit])
      else sources.push(unit)
    }
  }

  const assigned = new Set<Unit>()
  const components: Array<ReadonlyArray<Unit>> = []
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const start = finished[index]
    if (start === undefined || assigned.has(start)) continue
    const component: Array<Unit> = []
    const stack: Array<Unit> = [start]
    assigned.add(start)
    while (stack.length > 0) {
      const current = stack.pop()
      if (current === undefined) continue
      component.push(current)
      for (const source of reverse.get(current) ?? []) {
        if (assigned.has(source)) continue
        assigned.add(source)
        stack.push(source)
      }
    }
    components.push(component)
  }
  // Kosaraju yields referrers before their targets; reverse for dependencies first.
  return components.reverse()
}

/* -------------------------------------------------------------------------- */
/* The workspace index                                                         */
/* -------------------------------------------------------------------------- */

export interface DeclarationIdentity {
  readonly unit: Unit
  readonly id: string
}

/**
 * The identity index, keyed the two ways a caller already has a declaration.
 *
 * A rule knows a file and a name; a request knows a file and the NAME's offset.
 * Neither key is part of an id -- they only find the content id the Merkle pass
 * already computed, so moving the declaration does not change what it hashes to.
 */
export interface IdentityKeys {
  readonly byName: ReadonlyMap<string, string>
  /**
   * The same names, lowercased.
   *
   * The checker hands back some paths with their first component lowercased
   * (`/Users/...` becomes `/users/...`), which is not a file identity question;
   * it is a lookup spelling. Exact keys win, and this is only the fallback.
   */
  readonly byNameLower: ReadonlyMap<string, string>
  readonly byPosition: ReadonlyMap<string, string>
}

/** Build both lookup maps once, from the workspace's content ids. */
export const identityKeysOf = ({
  workspace,
  root,
}: {
  readonly workspace: Workspace
  readonly root: string
}): IdentityKeys => {
  const index = identityOf(workspace)
  const byName = new Map<string, string>()
  const byNameLower = new Map<string, string>()
  const byPosition = new Map<string, string>()
  for (const { unit, id } of index.declarations) {
    const file = resolve(root, unit.file)
    const key = file + "\u0000" + unit.name
    byName.set(key, id)
    const lower = key.toLowerCase()
    if (!byNameLower.has(lower)) byNameLower.set(lower, id)
    byPosition.set(file + "\u0000" + String(unit.namePosition), id)
  }
  return { byName, byNameLower, byPosition }
}

export interface IdentityIndex {
  readonly declarations: ReadonlyArray<DeclarationIdentity>
  /** The id of every declaration, keyed by the unit itself. */
  readonly ids: ReadonlyMap<Unit, string>
  /** Resolved declaration references, deduplicated, per unit. */
  readonly references: ReadonlyMap<Unit, ReadonlyArray<Unit>>
  /** How many free names could not be resolved to a workspace declaration. */
  readonly unresolved: number
}

/**
 * Every declaration's identity, with cycles keyed once.
 *
 * A mutually recursive group has no bottom-up order, so the members are hashed
 * with their intra-group references removed, the sorted hashes become one cycle
 * key, and each member is that key plus its index. This is Unison's `#x.n`:
 * reordering the declarations changes nothing, while changing a member changes
 * the key and therefore every id in the group -- which is true, because none of
 * them can be understood without the others.
 */
export const identityOf = (workspace: Workspace): IdentityIndex => {
  const targetOf = resolverOf(workspace)
  const prepared = new Map<Unit, PreparedUnit>()
  const references = new Map<Unit, ReadonlyArray<Unit>>()
  const emptyIds: IdentityContext = { targetOf, idOf: () => undefined }
  let unresolved = 0

  for (const unit of workspace.units) {
    const read = prepareUnit(unit)
    prepared.set(unit, read)
    const probe = encodeWith({ prepared: read, context: emptyIds })
    references.set(unit, [...new Set(probe.references)])
    unresolved += probe.unresolved
  }

  const ids = new Map<Unit, string>()
  for (const component of componentsOf({ units: workspace.units, references })) {
    const members = new Set(component)
    const first = component[0]
    if (first === undefined) continue
    const selfReferential = (references.get(first) ?? []).some((target) => members.has(target))
    if (component.length === 1 && !selfReferential) {
      const read = prepared.get(first)
      if (read === undefined) continue
      ids.set(
        first,
        stableId(
          encodeWith({
            prepared: read,
            context: { targetOf, idOf: (target) => ids.get(target) },
          }).encoding,
        ),
      )
      continue
    }

    const placeholders = component.map((unit) => {
      const read = prepared.get(unit)
      if (read === undefined) return ""
      return stableId(
        encodeWith({
          prepared: read,
          context: {
            targetOf,
            idOf: (target) => (members.has(target) ? "#cycle" : ids.get(target)),
          },
        }).encoding,
      )
    })
    const sorted = [...placeholders].sort(Order.String)
    const cycleKey = stableId(sorted.join("\u0000"))
    component.forEach((unit, index) => {
      const placeholder = placeholders[index] ?? ""
      ids.set(unit, cycleKey + "." + String(sorted.indexOf(placeholder)))
    })
  }

  return {
    declarations: workspace.units.map((unit) => ({ unit, id: ids.get(unit) ?? "" })),
    ids,
    references,
    unresolved,
  }
}
