import { Effect, FileSystem, Path, Predicate, Result, Schema, SchemaParser } from "effect"
import { resolve } from "node:path"
import {
  API,
  SignatureKind,
  TypeFlags,
  type Project,
  type Type,
} from "@typescript/native/unstable/async"
import { shortHash } from "./state.ts"

/**
 * The checker's answer about a declaration, by file and byte offset.
 *
 * Two things live here, and they answer different questions:
 *
 * - `typesAtPositions` answers the type of ONE TOKEN at an offset, which is what
 *   a guard or a returned expression needs. It is hover, in effect.
 * - `resolveDeclarations` answers what a DECLARATION is: its printed type, its
 *   members and their own resolved types, its union variants, its bases, its
 *   alias, its literal value, a member-sorted structural fingerprint, and the
 *   group of declarations the compiler proves structurally identical. That is
 *   the fact layer the type rules read, and it is the one the declaration trace
 *   cannot give: a NAMED interface has no `display` in the trace and no member
 *   list anywhere (docs/type-resolution.md).
 *
 * Both are a REQUEST LIST, not a whole-project dump: a rule only asks about the
 * nodes its candidates are built from, and the output for every file in a
 * repository would be enormous.
 */

/* -------------------------------------------------------------------------- */
/* One token's type (the rules that read expressions)                          */
/* -------------------------------------------------------------------------- */

export interface NodeTypeRequest {
  readonly file: string
  readonly position: number
}

export interface NodeType {
  readonly file: string
  readonly position: number
  /** The checker's printed type: `number`, `{ id: string }`, `string | null`. */
  readonly type: string
}

/** What a rule reads: the checker's type at an offset, or undefined. */
export type NodeTypeIndex = (file: string, position: number) => string | undefined

/**
 * Index node types by file and position.
 *
 * @param entries - what {@link typesAtPositions} returned.
 * @returns a lookup a rule can call.
 */
export const indexOfNodeTypes = (entries: ReadonlyArray<NodeType>): NodeTypeIndex => {
  const byKey = new Map<string, string>()
  for (const entry of entries) byKey.set(entry.file + "\u0000" + String(entry.position), entry.type)
  return (file, position) => byKey.get(file + "\u0000" + String(position))
}

/**
 * The project, its tsconfig, and the positions to resolve types at.
 */
export interface NodeTypeQuery {
  readonly cwd: string
  readonly tsconfig: string
  readonly requests: ReadonlyArray<NodeTypeRequest>
}

/** What the checker resolved, and the positions it had nothing for. */
export interface NodeTypeResult {
  readonly found: ReadonlyArray<NodeType>
  /** Positions with no project or no type: a miss a caller can see, not silence. */
  readonly unresolved: number
}

/** A project root and the tsconfig that defines it. */
interface ProjectSource {
  readonly cwd: string
  readonly tsconfig: string
}

/**
 * One program, one snapshot, closed whatever happens.
 *
 * `.finally`, not `try/finally`: the checker is a child process and it must be
 * closed on the error path too, and `.finally` does not swallow the failure.
 */
const withSnapshot = async <A>(
  source: ProjectSource,
  use: (snapshot: Awaited<ReturnType<API["updateSnapshot"]>>) => Promise<A>,
): Promise<A> => {
  const api = new API({ cwd: source.cwd })
  // The identifier is a PATH, and it must be absolute: a relative one is not found.
  const collect = async (): Promise<A> =>
    use(await api.updateSnapshot({ openProjects: [resolve(source.cwd, source.tsconfig)] }))
  return await collect().finally(() => api.close())
}

/** The project that owns a file, or undefined when no tsconfig covers it. */
const projectOf = async (input: {
  readonly snapshot: Awaited<ReturnType<API["updateSnapshot"]>>
  readonly cwd: string
  readonly file: string
}): Promise<Project | undefined> =>
  input.snapshot.getDefaultProjectForFile(resolve(input.cwd, input.file))

/**
 * Ask the checker for the type at each position, in one program.
 *
 * @param input - The project root, the tsconfig to open, and the positions.
 * @returns The resolved entries, in request order, and how many positions the
 *   checker had no project or no type for.
 */
export const typesAtPositions = async (input: NodeTypeQuery): Promise<NodeTypeResult> => {
  if (input.requests.length === 0) return { found: [], unresolved: 0 }
  return await withSnapshot(input, async (snapshot) => {
    const found: Array<NodeType> = []
    let unresolved = 0
    for (const request of input.requests) {
      const project = await projectOf({ snapshot, cwd: input.cwd, file: request.file })
      const type =
        project === undefined
          ? undefined
          : await project.checker.getTypeAtPosition(
              resolve(input.cwd, request.file),
              request.position,
            )
      if (project === undefined || type === undefined) {
        unresolved += 1
        continue
      }
      found.push({
        file: request.file,
        position: request.position,
        type: await project.checker.typeToString(type),
      })
    }
    return { found, unresolved }
  })
}

/* -------------------------------------------------------------------------- */
/* A declaration's type (the fact layer rules read)                            */
/* -------------------------------------------------------------------------- */

/** One member of a resolved object type, and what the checker resolved it to. */
export const MemberFact = Schema.Struct({
  name: Schema.String,
  type: Schema.String,
  /**
   * The exact values a member allows, when its type is a union of literals.
   *
   * This is what separates one vocabulary written incompletely from two
   * vocabularies that share a field name: `"admin" | "owner"` and
   * `"admin" | "owner" | "viewer"` print alike enough to argue about, and their
   * VALUES do not. Empty when any member is not a literal, because a half-read
   * set is worse than none.
   */
  variants: Schema.Array(Schema.String),
})

export type MemberFact = typeof MemberFact.Type

/**
 * What a declaration is, as the compiler sees it.
 *
 * `structural` is the part that makes identity a fact rather than a comparison of
 * printed names: it is built from the members' OWN resolved types, sorted, so two
 * differently named declarations with the same members have the same fingerprint
 * and an alias never compares equal to its expansion by accident.
 *
 * `identicalGroup` is the proven version of the same statement: two declarations
 * in one group are mutually assignable in both directions AND share the
 * fingerprint. A fingerprint alone is not enough -- every `any` would share one --
 * so a group is only assigned when the type has content and the checker agrees.
 */
export const ResolvedType = Schema.Struct({
  /** The checker's printed form, which keeps alias names. */
  display: Schema.String,
  /** Member-sorted `name:type` fingerprint, complete only when not truncated. */
  structural: Schema.String,
  /**
   * A recursive, parameter-position id: the cheap pre-filter for type identity.
   *
   * `structural` is the checker's printed member types, so two declarations that
   * expand through different aliases can print differently while being one shape.
   * The canonical id resolves each member to its own canonical id, sorts by name,
   * replaces type parameters by their debruijn position, marks a cycle rather than
   * following it, and folds truncation into the hash.
   *
   * It is a PRE-FILTER, not the oracle: `identicalGroup` remains the authoritative
   * proof, because two types can hash alike where mutual assignability fails. The
   * canonical id is what makes the cheap comparison possible; the checker is what
   * makes it true. Neither replaces the other.
   */
  canonical: Schema.String,
  /** The checker's own vocabulary: `Object`, `Union`, `Any`, `Conditional`, ... */
  flags: Schema.Array(Schema.String),
  members: Schema.Array(MemberFact),
  /** Union members, printed, in the checker's order. */
  variants: Schema.Array(Schema.String),
  /** Base types of a class or interface, printed. */
  bases: Schema.Array(Schema.String),
  /** The alias this type was declared through, when the checker attributed one. */
  alias: Schema.NullOr(Schema.String),
  /** The literal's value, printed, when the type is a literal. */
  value: Schema.NullOr(Schema.String),
  /** A group id shared by declarations the compiler proves identical. */
  identicalGroup: Schema.NullOr(Schema.String),
  /** True when the member list was cut to the budget, so `structural` is partial. */
  truncated: Schema.Boolean,
})

export interface ResolvedType extends Schema.Schema.Type<typeof ResolvedType> {}

export interface DeclarationRequest {
  readonly file: string
  /** The byte offset of the declaration's NAME, which is what hover resolves. */
  readonly position: number
}

export interface DeclarationFact {
  readonly file: string
  readonly position: number
  readonly facts: ResolvedType
}

export interface DeclarationResult {
  readonly found: ReadonlyArray<DeclarationFact>
  readonly unresolved: number
  /** Member lists and type strings the budget cut. Reported, never silent. */
  readonly truncated: number
}

export interface DeclarationQuery extends ProjectSource {
  readonly requests: ReadonlyArray<DeclarationRequest>
  /** Members printed per declaration. Past this the fingerprint is partial. */
  readonly maxMembers: number
  /** Total `typeToString` calls for the run, which is the expensive part. */
  readonly maxStrings: number
}

const FLAG_TABLE: ReadonlyArray<readonly [string, number | undefined]> = [
  ["Any", TypeFlags.Any],
  ["Unknown", TypeFlags.Unknown],
  ["Never", TypeFlags.Never],
  ["Void", TypeFlags.Void],
  ["Undefined", TypeFlags.Undefined],
  ["Null", TypeFlags.Null],
  ["String", TypeFlags.String],
  ["Number", TypeFlags.Number],
  ["Boolean", TypeFlags.Boolean],
  ["BigInt", TypeFlags.BigInt],
  ["ESSymbol", TypeFlags.ESSymbol],
  ["StringLiteral", TypeFlags.StringLiteral],
  ["NumberLiteral", TypeFlags.NumberLiteral],
  ["BooleanLiteral", TypeFlags.BooleanLiteral],
  ["BigIntLiteral", TypeFlags.BigIntLiteral],
  ["TypeParameter", TypeFlags.TypeParameter],
  ["Object", TypeFlags.Object],
  ["Union", TypeFlags.Union],
  ["Intersection", TypeFlags.Intersection],
  ["IndexedAccess", TypeFlags.IndexedAccess],
  ["Conditional", TypeFlags.Conditional],
  ["TemplateLiteral", TypeFlags.TemplateLiteral],
  ["NonPrimitive", TypeFlags.NonPrimitive],
]

/**
 * The flags that name one kind of type.
 *
 * A composite flag (`Literal`, `Primitive`, ...) is a union of other bits, so
 * reporting it would label every literal twice. Only single-bit flags survive.
 */
const FLAG_LABELS: ReadonlyArray<readonly [string, number]> = FLAG_TABLE.filter(
  (entry): entry is readonly [string, number] =>
    Predicate.isNumber(entry[1]) && entry[1] > 0 && (entry[1] & (entry[1] - 1)) === 0,
)

const labelsOf = (flags: number): ReadonlyArray<string> =>
  FLAG_LABELS.filter(([, bit]) => (flags & bit) !== 0).map(([label]) => label)

const squash = (value: string): string => value.replace(/\s+/g, " ").trim()

/** The structural fingerprint of one resolved type. */
const structuralOf = (input: {
  readonly flags: ReadonlyArray<string>
  readonly display: string
  readonly members: ReadonlyArray<MemberFact>
  readonly variants: ReadonlyArray<string>
  readonly value: string | null
}): string => {
  if (input.flags.includes("Union") && input.variants.length > 0) {
    const parts = [...input.variants].map(squash).sort((left, right) => left.localeCompare(right))
    return "union(" + parts.join("|") + ")"
  }
  if (input.members.length > 0) {
    const parts = [...input.members]
      .map((member) => squash(member.name) + ":" + squash(member.type))
      .sort((left, right) => left.localeCompare(right))
    return "object{" + parts.join(";") + "}"
  }
  if (input.value !== null) return "literal:" + input.value
  return "intrinsic:" + squash(input.display)
}

/** True when a fingerprint has content, so a group is not "every any is an any". */
const contentful = (facts: ResolvedType): boolean =>
  !facts.truncated &&
  !facts.flags.includes("Any") &&
  !facts.flags.includes("Unknown") &&
  (facts.members.length > 0 || facts.variants.length >= 2)

/*
 * Canonical type identity.
 *
 * The id is built recursively rather than printed: each member resolves to its
 * own id, members sort by name, and the result is hashed with the type's flags.
 * Type parameters become their position, so `Box<A>` and `Holder<T>` with the
 * same shape compare equal despite the parameter's name. A type already on the
 * stack is marked `cycle` instead of followed forever. Every partial list carries
 * a truncation marker into its hash, so a truncated type can never collide with a
 * complete one.
 *
 * This is deliberately cheap and deliberately not authoritative. `identicalGroup`
 * is still the checker's mutual-assignability proof; this id only narrows what
 * has to be asked of the checker.
 */

interface CanonicalNode {
  readonly id: string
  readonly truncated: boolean
}

interface CanonicalContext {
  readonly checker: Project["checker"]
  readonly maxMembers: number
  readonly parameters: ReadonlyMap<number, string>
  readonly visiting: Set<number>
  readonly nodes: { count: number }
}

/** A node budget for one declaration: enough for real types, not for a runaway. */
const CANONICAL_NODES = 2000
const CANONICAL_DEPTH = 64

const canonicalHash = (payload: string): string => "c" + shortHash(payload)

/** The debruijn positions of the root type's own parameters. */
const parameterPositionsOf = async (type: Type): Promise<Map<number, string>> => {
  const positions = new Map<number, string>()
  const add = (parameters: ReadonlyArray<Type>): void => {
    for (const parameter of parameters) {
      if (!parameter.isTypeParameter() || positions.has(parameter.id)) continue
      positions.set(parameter.id, String(positions.size))
    }
  }
  if (type.isClassOrInterface()) add(await type.getTypeParameters())
  // A generic type alias is an object or union rather than an interface, so its
  // parameters arrive through the alias arguments instead.
  add(await type.getAliasTypeArguments())
  return positions
}

const canonicalOf = async (
  type: Type,
  context: CanonicalContext,
  depth: number,
): Promise<CanonicalNode> => {
  context.nodes.count += 1
  if (context.nodes.count > CANONICAL_NODES) return { id: "budget", truncated: true }
  if (depth > CANONICAL_DEPTH) return { id: "depth", truncated: true }
  if (context.visiting.has(type.id)) return { id: "cycle", truncated: false }

  if (type.isTypeParameter()) {
    const position = context.parameters.get(type.id)
    return { id: position === undefined ? "param:free" : "param:" + position, truncated: false }
  }

  if (type.isUnionType() || type.isIntersectionType()) {
    context.visiting.add(type.id)
    const parts = await type.getTypes()
    const children = await Promise.all(parts.map((part) => canonicalOf(part, context, depth + 1)))
    context.visiting.delete(type.id)
    const truncated = children.some((child) => child.truncated)
    const sorted = children
      .map((child) => child.id)
      .sort((left, right) => left.localeCompare(right))
    const kind = type.isUnionType() ? "union" : "intersection"
    return {
      id: canonicalHash(kind + "{" + sorted.join("|") + "}" + (truncated ? "|truncated" : "")),
      truncated,
    }
  }

  const tuple = await context.checker.isTupleType(type)
  const array = !tuple && (await context.checker.isArrayType(type))
  if (tuple || array) {
    context.visiting.add(type.id)
    const args = type.isTypeReference() ? await context.checker.getTypeArguments(type) : []
    const children = await Promise.all(args.map((arg) => canonicalOf(arg, context, depth + 1)))
    context.visiting.delete(type.id)
    const truncated = children.some((child) => child.truncated)
    return {
      id: canonicalHash(
        (tuple ? "tuple" : "array") +
          "<" +
          children.map((child) => child.id).join(",") +
          ">" +
          (truncated ? "|truncated" : ""),
      ),
      truncated,
    }
  }

  if (type.isLiteralType()) return { id: "literal:" + String(type.value), truncated: false }
  if (type.isIntrinsicType()) return { id: "intrinsic:" + type.intrinsicName, truncated: false }

  if (type.isObjectType()) {
    context.visiting.add(type.id)
    const symbols = await context.checker.getPropertiesOfType(type)
    const kept = symbols.slice(0, context.maxMembers)
    let truncated = symbols.length > kept.length
    const memberTypes = await context.checker.getTypeOfSymbol(kept)
    const rows: Array<string> = []
    for (const [index, symbol] of kept.entries()) {
      const memberType = memberTypes[index]
      if (memberType === undefined) {
        truncated = true
        continue
      }
      const child = await canonicalOf(memberType, context, depth + 1)
      if (child.truncated) truncated = true
      rows.push(symbol.name + ":" + child.id)
    }
    rows.sort((left, right) => left.localeCompare(right))

    // A function type has call signatures rather than properties. Without them
    // every function would share the empty-object id and the pre-filter would
    // admit everything.
    const signatures = await context.checker.getSignaturesOfType(type, SignatureKind.Call)
    const calls: Array<string> = []
    for (const signature of signatures.slice(0, context.maxMembers)) {
      const signatureParameters = await signature.getTypeParameters()
      const parameters = new Map(context.parameters)
      signatureParameters.forEach((parameter, index) =>
        parameters.set(parameter.id, "sig:" + index),
      )
      const signatureContext: CanonicalContext = {
        checker: context.checker,
        maxMembers: context.maxMembers,
        parameters,
        visiting: context.visiting,
        nodes: context.nodes,
      }
      const symbols = await signature.getParameters()
      const types = await context.checker.getTypeOfSymbol(symbols)
      const argumentsIds: Array<string> = []
      for (const parameterType of types) {
        if (parameterType === undefined) {
          truncated = true
          argumentsIds.push("unknown")
          continue
        }
        const child = await canonicalOf(parameterType, signatureContext, depth + 1)
        if (child.truncated) truncated = true
        argumentsIds.push(child.id)
      }
      const returned = await context.checker.getReturnTypeOfSignature(signature)
      const returnId =
        returned === undefined
          ? "unknown"
          : (await canonicalOf(returned, signatureContext, depth + 1)).id
      calls.push("(" + argumentsIds.join(",") + ")->" + returnId)
    }
    calls.sort((left, right) => left.localeCompare(right))
    context.visiting.delete(type.id)

    const flags = labelsOf(type.flags)
    const payload =
      "object{" +
      rows.join(";") +
      "}|flags:" +
      flags.join(",") +
      "|calls:" +
      calls.join("|") +
      (truncated ? "|truncated" : "")
    return { id: canonicalHash(payload), truncated }
  }

  const flags = labelsOf(type.flags)
  return { id: canonicalHash("opaque:" + flags.join(",")), truncated: false }
}

/** The facts of one declaration, with the group it was later placed in. */
const withGroup = (facts: ResolvedType, identicalGroup: string | undefined): ResolvedType => ({
  display: facts.display,
  structural: facts.structural,
  canonical: facts.canonical,
  flags: facts.flags,
  members: facts.members,
  variants: facts.variants,
  bases: facts.bases,
  alias: facts.alias,
  value: facts.value,
  identicalGroup: identicalGroup === undefined ? null : identicalGroup,
  truncated: facts.truncated,
})

/** One declaration, described. */
const describe = async (
  checker: Project["checker"],
  type: Type,
  budget: { strings: number; maxStrings: number },
  maxMembers: number,
): Promise<ResolvedType> => {
  const printed = async (value: Type): Promise<string | undefined> => {
    if (budget.strings >= budget.maxStrings) return undefined
    budget.strings += 1
    return squash(await checker.typeToString(value))
  }

  const display = (await printed(type)) ?? ""
  const flags = labelsOf(type.flags)
  const aliasSymbol = await type.getAliasSymbol()
  const alias = aliasSymbol === undefined ? null : aliasSymbol.name
  const literalValue = type.isLiteralType() ? String(type.value) : null

  let variants: Array<string> = []
  if (type.isUnionType()) {
    const parts = (await type.getTypes()) ?? []
    variants = (await Promise.all(parts.map((part) => printed(part)))).filter(
      (part): part is string => part !== undefined,
    )
  }

  let bases: Array<string> = []
  if (type.isClassOrInterface()) {
    const parts = (await type.getBaseTypes()) ?? []
    bases = (await Promise.all(parts.map((part) => printed(part)))).filter(
      (part): part is string => part !== undefined,
    )
  }

  const members: Array<MemberFact> = []
  let truncated = false
  if (type.isObjectType()) {
    // An array is an object with ninety methods; its members are the runtime's,
    // not the repository's, and printing them is how a tuple looks like a
    // vocabulary.
    const container = (await checker.isArrayType(type)) || (await checker.isTupleType(type))
    if (!container) {
      const symbols = await checker.getPropertiesOfType(type)
      const kept = symbols.slice(0, maxMembers)
      if (symbols.length > kept.length) truncated = true
      const types = await checker.getTypeOfSymbol(kept)
      for (const [index, symbol] of kept.entries()) {
        const member = types[index]
        const memberType = member === undefined ? undefined : await printed(member)
        if (memberType === undefined || member === undefined) {
          truncated = true
          continue
        }
        // The value set, only when every alternative is a literal. A union of
        // object types is not a vocabulary, and reporting its members as values
        // would make two different sets look alike.
        let variants: Array<string> = []
        if (member.isUnionType()) {
          const parts = (await member.getTypes()) ?? []
          const literals: Array<string> = []
          let allLiteral = parts.length >= 2
          for (const part of parts) {
            if (!part.isLiteralType()) {
              allLiteral = false
              break
            }
            const text = await printed(part)
            if (text === undefined) {
              allLiteral = false
              break
            }
            literals.push(text)
          }
          if (allLiteral) variants = literals
        }
        members.push({ name: symbol.name, type: memberType, variants })
      }
    }
  }

  const canonical = await canonicalOf(
    type,
    {
      checker,
      maxMembers,
      parameters: await parameterPositionsOf(type),
      visiting: new Set<number>(),
      nodes: { count: 0 },
    },
    0,
  )

  return {
    display,
    structural: structuralOf({ flags, display, members, variants, value: literalValue }),
    canonical: canonical.id,
    flags,
    members,
    variants,
    bases,
    alias,
    value: literalValue,
    identicalGroup: null,
    truncated,
  }
}

/**
 * What each declaration is, by the compiler's answer.
 *
 * One `getTypeAtPosition` call per file (the API takes a list), then one property
 * walk per declaration. The expensive call is `typeToString`, so it is budgeted
 * and the truncation is reported rather than hidden.
 *
 * @param input - the project, the tsconfig, and one request per declaration name.
 * @returns the facts, how many positions had no type, and how many were cut.
 */
export const resolveDeclarations = async (input: DeclarationQuery): Promise<DeclarationResult> => {
  if (input.requests.length === 0) return { found: [], unresolved: 0, truncated: 0 }
  const budget = { strings: 0, maxStrings: input.maxStrings }
  return await withSnapshot(input, async (snapshot) => {
    // Grouped by file, so the batch overload answers a whole file in one round
    // trip instead of one per declaration.
    const byFile = new Map<string, Array<DeclarationRequest>>()
    for (const request of input.requests) {
      const existing = byFile.get(request.file)
      if (existing === undefined) byFile.set(request.file, [request])
      else existing.push(request)
    }

    interface Described {
      readonly request: DeclarationRequest
      readonly checker: Project["checker"]
      readonly type: Type
      readonly facts: ResolvedType
    }
    const described: Array<Described> = []
    let unresolved = 0
    for (const [file, requests] of byFile) {
      const project = await projectOf({ snapshot, cwd: input.cwd, file })
      if (project === undefined) {
        unresolved += requests.length
        continue
      }
      const positions = requests.map((request) => request.position)
      const types = await project.checker.getTypeAtPosition(resolve(input.cwd, file), positions)
      for (const [index, request] of requests.entries()) {
        const type = types[index]
        if (type === undefined) {
          unresolved += 1
          continue
        }
        described.push({
          request,
          checker: project.checker,
          type,
          facts: await describe(project.checker, type, budget, input.maxMembers),
        })
      }
    }

    // The groups, after every declaration is described. Same fingerprint first,
    // then the checker has to agree in both directions -- a fingerprint of
    // printed member types can collide where assignability cannot.
    const byStructural = new Map<string, Array<Described>>()
    for (const entry of described) {
      if (!contentful(entry.facts)) continue
      const existing = byStructural.get(entry.facts.structural)
      if (existing === undefined) byStructural.set(entry.facts.structural, [entry])
      else existing.push(entry)
    }
    let truncated = described.filter((entry) => entry.facts.truncated).length
    if (budget.strings >= budget.maxStrings) truncated += 1
    const groupOf = new Map<string, string>()
    for (const [structural, group] of byStructural) {
      if (group.length < 2) continue
      const first = group[0]
      if (first === undefined) continue
      const checker = first.checker
      let identical = true
      for (const other of group.slice(1)) {
        const forward = await checker.isTypeAssignableTo(first.type, other.type)
        const backward = forward && (await checker.isTypeAssignableTo(other.type, first.type))
        if (!backward) {
          identical = false
          break
        }
      }
      if (!identical) continue
      groupOf.set(structural, "g" + shortHash(structural))
    }

    return {
      found: described.map((entry) => ({
        file: entry.request.file,
        position: entry.request.position,
        facts: withGroup(entry.facts, groupOf.get(entry.facts.structural)),
      })),
      unresolved,
      truncated,
    }
  })
}

/* -------------------------------------------------------------------------- */
/* Reading and caching                                                         */
/* -------------------------------------------------------------------------- */

/** Bumped when the shape of a fact changes: an old entry is not a hit. */
const DECLARATION_TYPES_VERSION = "3"

const CachedDeclaration = Schema.Struct({
  file: Schema.String,
  position: Schema.Number,
  facts: ResolvedType,
})

const CachedFacts = Schema.Struct({
  version: Schema.String,
  tool: Schema.String,
  manifest: Schema.String,
  entries: Schema.Array(CachedDeclaration),
})

const decodeCache = SchemaParser.decodeUnknownResult(Schema.fromJsonString(CachedFacts))

/** The key a declaration's facts are looked up by: the file and the name offset. */
export const declarationKey = (file: string, position: number): string =>
  file + "\u0000" + String(position)

export interface DeclarationTypesRequest {
  readonly root: string
  /** The project's tsconfig, relative to the root. */
  readonly tsconfig: string
  readonly cacheDir: string
  readonly tool: string
  readonly manifest: string
  readonly requests: ReadonlyArray<DeclarationRequest>
  readonly maxMembers: number
  readonly maxStrings: number
}

export interface LoadedDeclarations {
  readonly index: ReadonlyMap<string, ResolvedType>
  readonly resolvedFrom: "cache" | "checker" | "none"
  readonly unresolved: number
  readonly truncated: number
  /** Why the checker or the cache could not be used. Reported, not hidden. */
  readonly issues: ReadonlyArray<string>
}

const emptyDeclarations = (issues: ReadonlyArray<string>): LoadedDeclarations => ({
  index: new Map(),
  resolvedFrom: "none",
  unresolved: 0,
  truncated: 0,
  issues,
})

interface RanOk {
  readonly ok: true
  readonly result: DeclarationResult
}

interface RanFailed {
  readonly ok: false
  readonly reason: string
}

/**
 * Resolve every declaration's type, from the cache or from the checker.
 *
 * The cache key is the run manifest the caller already computed, because the
 * facts depend on the whole program -- the compiler, the tsconfig, every file --
 * and a manifest is content, not mtimes. An unchanged repository reuses the
 * answer it already paid for; a changed one asks again.
 */
export const loadDeclarationTypes = (
  input: DeclarationTypesRequest,
): Effect.Effect<LoadedDeclarations, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    if (input.requests.length === 0) return emptyDeclarations([])
    const store = path.join(input.cacheDir, "declaration-types.json")
    const exists = yield* Effect.orElseSucceed(fs.exists(store), () => false)
    if (exists) {
      const body = yield* Effect.orElseSucceed(fs.readFileString(store), () => "")
      const decoded = decodeCache(body)
      if (
        Result.isSuccess(decoded) &&
        decoded.success.version === DECLARATION_TYPES_VERSION &&
        decoded.success.tool === input.tool &&
        decoded.success.manifest === input.manifest
      ) {
        const index = new Map<string, ResolvedType>()
        for (const entry of decoded.success.entries) {
          index.set(declarationKey(entry.file, entry.position), entry.facts)
        }
        return { index, resolvedFrom: "cache", unresolved: 0, truncated: 0, issues: [] }
      }
    }

    const ran: RanOk | RanFailed = yield* Effect.tryPromise(() =>
      resolveDeclarations({
        cwd: input.root,
        tsconfig: input.tsconfig,
        requests: input.requests,
        maxMembers: input.maxMembers,
        maxStrings: input.maxStrings,
      }),
    ).pipe(
      Effect.map((result): RanOk => ({ ok: true, result })),
      Effect.orElseSucceed((error): RanFailed => ({ ok: false, reason: String(error) })),
    )
    if (!ran.ok) {
      return emptyDeclarations(["the checker could not resolve declaration types: " + ran.reason])
    }

    const index = new Map<string, ResolvedType>()
    for (const entry of ran.result.found) {
      index.set(declarationKey(entry.file, entry.position), entry.facts)
    }
    // Only a run that resolved something is worth storing: an empty answer is a
    // tsconfig that covers none of these files, and caching that would make the
    // miss permanent.
    if (ran.result.found.length > 0) {
      const body = JSON.stringify({
        version: DECLARATION_TYPES_VERSION,
        tool: input.tool,
        manifest: input.manifest,
        entries: ran.result.found.map((entry) => ({
          file: entry.file,
          position: entry.position,
          facts: entry.facts,
        })),
      })
      yield* Effect.orElseSucceed(
        fs.makeDirectory(input.cacheDir, { recursive: true }),
        () => undefined,
      )
      yield* Effect.orElseSucceed(fs.writeFileString(store, body), () => undefined)
    }
    return {
      index,
      resolvedFrom: "checker",
      unresolved: ran.result.unresolved,
      truncated: ran.result.truncated,
      issues: [],
    }
  })
