import {
  ElementFlags,
  SymbolFlags,
  type Checker,
  type Symbol,
  type Type,
  type TypeParameter,
  type TypeReference,
} from "@typescript/native/unstable/async"
import { SyntaxKind } from "@typescript/native/unstable/ast"
import { Option, Order } from "effect"
import { isRecord } from "./workspace.ts"
import { stableId } from "./identity.ts"

/*
 * A type's identity is its shape, read from the checker's graph.
 *
 * The printed form is not an identity: `Box<A>` and `Cell<T>` print differently
 * and mean the same thing, while two `Effect<A, never, R>` and
 * `Effect<A, Error, R>` print almost alike and are different programs. This
 * module walks the Type object the checker already built, erases names where
 * they are bound (a type parameter is a de Bruijn POSITION), and hashes the
 * result with the declaration pass's own `stableId`/`HASH_VERSION`. There is one
 * hashing scheme in joggle, not two.
 *
 * It is cheap and total: every Type gets an encoding, including the ones the
 * checker could not resolve (`error`). It is not a replacement for mutual
 * assignability, which remains the authoritative oracle in typefacts.ts.
 */

/** What a reference to a declaration should hash to, from the identity pass. */
export interface TypeIdContext {
  readonly checker: Checker
  /**
   * The content id of the declaration a symbol names, when the identity pass
   * knows it. A target outside the workspace has no id; it falls back to a
   * namespaced marker rather than a path.
   */
  readonly declarationIdOf: (symbol: Symbol) => Promise<string | undefined>
}

/**
 * Work reused across the declarations of one project.
 *
 * A canonical id is a pure function of the type graph, but computing it is a
 * sequence of sidecar round-trips. The walk is asked once per declaration, and
 * many declarations share the same type object or the same closed printed type.
 * Reuse is keyed by the checker's `Type.id` (the object's own identity) and by
 * the printed form, with the encoding cache also carrying the parameter scope
 * and the cycle path so a result is only reused in the context that produced it.
 *
 * The printed cache is restricted to CLOSED forms -- primitives, literals and
 * object shapes built only from those. A bare declaration name is not an
 * identity: two modules can both print `User` for different interfaces, and
 * caching by that name would make them equal.
 *
 * Reuse is not termination, and it is not the reason `policy.canonical` is off.
 * An entry is stored only after its walk returns, so a type that re-enters
 * itself with the same cycle path misses every time; `DagValue` in
 * `packages/board/src/mailbox/records.ts` does exactly that through
 * `ReadonlyArray<DagValue>`. See the comment on `policy.canonical` for the
 * measurement.
 */
export interface TypeIdMemo {
  readonly printed: Map<string, string>
  readonly types: Map<number, string>
  readonly encodings: Map<string, string>
  readonly symbols: Map<number, string | undefined>
  walks: number
  printedHits: number
  typeHits: number
  encodingHits: number
}

/** A fresh memo, for one project in one run. */
export const createTypeIdMemo = (): TypeIdMemo => ({
  printed: new Map(),
  types: new Map(),
  encodings: new Map(),
  symbols: new Map(),
  walks: 0,
  printedHits: 0,
  typeHits: 0,
  encodingHits: 0,
})

const CLOSED_WORDS = new Set([
  "any",
  "unknown",
  "never",
  "void",
  "undefined",
  "null",
  "string",
  "number",
  "boolean",
  "bigint",
  "symbol",
  "object",
  "true",
  "false",
  "readonly",
  "keyof",
  "typeof",
  "infer",
  "extends",
  "in",
  "out",
  "const",
  "this",
])

/**
 * Whether a printed type is its own identity.
 *
 * Property keys (`id:` / `id?:`) are text, not references, so they are allowed.
 * Any other non-keyword identifier is a name whose meaning depends on where it
 * was resolved, and is left to the `Type.id` cache instead.
 */
const isClosedPrint = (printed: string): boolean => {
  if (printed.length === 0) return false
  const identifier = /[A-Za-z_$][\w$]*/g
  for (let match = identifier.exec(printed); match !== null; match = identifier.exec(printed)) {
    if (CLOSED_WORDS.has(match[0])) continue
    const rest = printed.slice(identifier.lastIndex)
    if (/^\s*\??\s*:/.test(rest)) continue
    return false
  }
  return true
}

interface EncodingState extends TypeIdContext {
  /** Declaration ids currently being encoded, so a cycle terminates by name. */
  readonly visiting: Set<string>
  readonly memo: TypeIdMemo | undefined
}

const byHash: Order.Order<string> = Order.mapInput(Order.String, (value: string) => stableId(value))

const literalOf = (type: Type): Option.Option<string> => {
  if (!type.isLiteralType()) return Option.none()
  return Option.some("literal:" + String(type.value))
}

/**
 * Hold a declaration marker for the duration of one encoding.
 *
 * The marker is cycle state, not an error boundary: release it however the
 * checker's promises settle, so a rejected walk cannot leave a false cycle behind.
 */
const withVisit = async <A>(payload: {
  readonly state: EncodingState
  readonly marker: string
  readonly body: () => Promise<A>
}): Promise<A> => {
  payload.state.visiting.add(payload.marker)
  return payload.body().finally(() => payload.state.visiting.delete(payload.marker))
}

/** A parameter's position, by object identity first and symbol name as a fallback. */
const positionOf = async (
  type: TypeParameter,
  scope: ReadonlyArray<TypeParameter>,
): Promise<number> => {
  const direct = scope.indexOf(type)
  if (direct >= 0) return direct
  const symbol = await type.getSymbol()
  if (symbol === undefined) return -1
  for (const [index, candidate] of scope.entries()) {
    const candidateSymbol = await candidate.getSymbol()
    if (candidateSymbol?.name === symbol.name) return index
  }
  return -1
}

const isReadonly = async (symbol: Symbol): Promise<boolean> => {
  for (const declaration of symbol.declarations) {
    const node = await declaration.resolve()
    if (!isRecord(node)) continue
    const modifiers = node["modifiers"]
    if (!Array.isArray(modifiers)) continue
    if (
      modifiers.some(
        (modifier) => isRecord(modifier) && modifier["kind"] === SyntaxKind.ReadonlyKeyword,
      )
    ) {
      return true
    }
  }
  return false
}

/** A declaration's symbol: the alias first, because a type alias's `getSymbol` is `__type`. */
const declarationSymbolOf = async (type: Type): Promise<Symbol | undefined> =>
  (await type.getAliasSymbol()) ?? (await type.getSymbol())

/** The declaration id, or a stable namespaced marker for a type outside the workspace. */
const markerOf = async (type: Type, state: EncodingState): Promise<string> => {
  const symbol = await declarationSymbolOf(type)
  const id = symbol === undefined ? undefined : await state.declarationIdOf(symbol)
  if (id !== undefined) return id
  return "external:" + String(type.flags) + ":" + (symbol?.name ?? "anonymous")
}

/** The canonical encoding of one type, relative to the parameters in scope. */
const encodeUncached = async (
  type: Type,
  scope: ReadonlyArray<TypeParameter>,
  state: EncodingState,
  currentDeclaration: string | undefined,
): Promise<string> => {
  // The checker's own failure is a fact, and it is not `any` or `unknown`.
  if (type.isErrorType()) return "error"
  if (type.isTypeParameter()) {
    const position = await positionOf(type, scope)
    return position < 0 ? "param:free" : "param:" + String(position)
  }

  const literal = literalOf(type)
  if (Option.isSome(literal)) return literal.value

  if (type.isUnionType() || type.isIntersectionType()) {
    const kind = type.isUnionType() ? "union" : "intersection"
    const parts = await type.getTypes()
    const encoded = await Promise.all(parts.map((part) => encode(part, scope, state)))
    return kind + "(" + encoded.sort(byHash).join("|") + ")"
  }

  if (type.isTupleType()) {
    const parts = await state.checker.getTypeArguments(type)
    const elements = await Promise.all(
      parts.map(async (part, index) => {
        const flags = type.elementFlags[index] ?? ElementFlags.Required
        const marker =
          (flags & ElementFlags.Optional) !== 0
            ? "optional:"
            : (flags & ElementFlags.Rest) !== 0
              ? "rest:"
              : (flags & ElementFlags.Variadic) !== 0
                ? "variadic:"
                : ""
        return marker + (await encode(part, scope, state))
      }),
    )
    return (type.readonly ? "readonly-tuple(" : "tuple(") + elements.join(",") + ")"
  }

  if (type.isTemplateLiteralType()) {
    const parts = await type.getTypes()
    const encoded = await Promise.all(parts.map((part) => encode(part, scope, state)))
    const segments = type.texts.map((text, index) => text + (encoded[index] ?? ""))
    return "template(" + JSON.stringify(segments.join("\u0000")) + ")"
  }

  if (type.isIndexedAccessType()) {
    const object = await type.getObjectType()
    const index = await type.getIndexType()
    return (
      "indexed(" +
      (await encode(object, scope, state)) +
      "[" +
      (await encode(index, scope, state)) +
      "])"
    )
  }

  if (type.isIndexType()) {
    return "keyof(" + (await encode(await type.getTarget(), scope, state)) + ")"
  }

  if (type.isConditionalType()) {
    const parts = await Promise.all([
      type.getCheckType(),
      type.getExtendsType(),
      type.getTrueType(),
      type.getFalseType(),
    ])
    const encoded = await Promise.all(parts.map((part) => encode(part, scope, state)))
    return "conditional(" + encoded.join(",") + ")"
  }

  if (type.isSubstitutionType()) {
    return (
      "substitution(" +
      (await encode(await type.getBaseType(), scope, state)) +
      ";" +
      (await encode(await type.getConstraint(), scope, state)) +
      ")"
    )
  }

  if (type.isStringMappingType()) {
    return "mapping(" + (await encode(await type.getTarget(), scope, state)) + ")"
  }

  if (type.isIntrinsicType()) return "intrinsic:" + type.intrinsicName

  if (type.isTypeReference()) {
    const reference: TypeReference = type
    const target = await reference.getTarget()
    const symbol = await declarationSymbolOf(target)
    const args = await state.checker.getTypeArguments(reference)
    // Arrays and readonly arrays are structural containers, not declarations:
    // walking their runtime members would make `Tree[]` a cycle through `Array`.
    if (symbol?.name === "Array" || symbol?.name === "ReadonlyArray") {
      const elements = await Promise.all(args.map((arg) => encode(arg, scope, state)))
      return (
        (symbol.name === "ReadonlyArray" ? "readonly-array(" : "array(") + elements.join(",") + ")"
      )
    }
    const marker = await markerOf(target, state)
    if (state.visiting.has(marker)) return "cycle(" + marker + ")"
    return withVisit({
      state,
      marker,
      body: async () => {
        const encoded = await Promise.all(args.map((arg) => encode(arg, scope, state)))
        return "ref(" + marker + (encoded.length > 0 ? ";" + encoded.join(",") : "") + ")"
      },
    })
  }

  if (type.isObjectType()) {
    const symbol = await declarationSymbolOf(type)
    const current =
      currentDeclaration ?? (symbol === undefined ? undefined : await state.declarationIdOf(symbol))
    if (current !== undefined && state.visiting.has(current)) return "cycle(" + current + ")"
    const body = async (): Promise<string> => {
      const own = type.isClassOrInterface() ? await type.getTypeParameters() : []
      const aliases = await type.getAliasTypeArguments()
      const innerScope: Array<TypeParameter> = [...scope]
      for (const parameter of [...own, ...aliases]) {
        if (parameter.isTypeParameter() && !innerScope.includes(parameter))
          innerScope.push(parameter)
      }

      const symbols = await state.checker.getPropertiesOfType(type)
      const types = await state.checker.getTypeOfSymbol(symbols)
      const members = await Promise.all(
        symbols.map(async (symbol, index) => {
          const member = types[index]
          const property = symbol.name
          const optional = (symbol.flags & SymbolFlags.Optional) !== 0 ? "?" : ""
          const readonly = (await isReadonly(symbol)) ? "ro" : ""
          return (
            optional +
            readonly +
            property +
            ":" +
            (member === undefined ? "error" : await encode(member, innerScope, state))
          )
        }),
      )
      members.sort((left, right) => left.localeCompare(right))
      return "object{" + members.join(";") + "}"
    }
    return current === undefined ? body() : withVisit({ state, marker: current, body })
  }

  // A type kind this walk has not named still gets its flags, never printed text.
  return "flags:" + String(type.flags)
}

/**
 * Memoise one sub-walk by the type, the parameter scope and the cycle path.
 *
 * The path is part of the key because a cycle is reported relative to the
 * declarations currently being encoded; the same type under a different set of
 * ancestors is a different encoding, not a cache hit.
 */
const encodeType = async (
  type: Type,
  scope: ReadonlyArray<TypeParameter>,
  state: EncodingState,
  currentDeclaration: string | undefined,
): Promise<string> => {
  const memo = state.memo
  if (memo === undefined) return encodeUncached(type, scope, state, currentDeclaration)
  const key = [
    String(type.id),
    scope.map((parameter) => String(parameter.id)).join(","),
    [...state.visiting].sort().join(","),
    currentDeclaration ?? "",
  ].join("\u0000")
  const hit = memo.encodings.get(key)
  if (hit !== undefined) {
    memo.encodingHits += 1
    return hit
  }
  const encoding = await encodeUncached(type, scope, state, currentDeclaration)
  memo.encodings.set(key, encoding)
  return encoding
}

/** Encode one type in a fresh scope, with no declaration id forced. */
const encode = async (
  type: Type,
  scope: ReadonlyArray<TypeParameter>,
  state: EncodingState,
): Promise<string> => encodeType(type, scope, state, undefined)

/**
 * The canonical id of one declaration's type.
 *
 * `declarationId` is the declaration's own id from the identity pass, when the
 * caller has it: it is what a recursive member resolves back to and what makes
 * the cycle marker stable. A caller without it still gets a total id.
 */
export const typeIdOf = async (
  input: TypeIdContext & {
    readonly type: Type
    /** The declaration's own content id, when the identity pass knows it. */
    readonly declarationId?: string | undefined
    /** The printed form `describe` already paid for, when the caller has it. */
    readonly printed?: string | undefined
    /** Reuse from earlier declarations in this project. */
    readonly memo?: TypeIdMemo | undefined
  },
): Promise<string> => {
  const memo = input.memo
  if (memo !== undefined) {
    if (input.printed !== undefined && isClosedPrint(input.printed)) {
      const hit = memo.printed.get(input.printed)
      if (hit !== undefined) {
        memo.printedHits += 1
        return hit
      }
    }
    const hit = memo.types.get(input.type.id)
    if (hit !== undefined) {
      memo.typeHits += 1
      return hit
    }
    memo.walks += 1
  }
  // A declaration id is a property of the symbol, not of the request: cache the
  // identity pass's answer so a target referenced by many declarations is
  // mapped once, including an out-of-workspace "undefined".
  const declarationIdOf =
    memo === undefined
      ? input.declarationIdOf
      : async (symbol: Symbol): Promise<string | undefined> => {
          if (memo.symbols.has(symbol.id)) return memo.symbols.get(symbol.id)
          const id = await input.declarationIdOf(symbol)
          memo.symbols.set(symbol.id, id)
          return id
        }
  const state: EncodingState = {
    checker: input.checker,
    declarationIdOf,
    visiting: new Set<string>(),
    memo,
  }
  const scope = input.type.isClassOrInterface()
    ? await input.type.getTypeParameters()
    : (await input.type.getAliasTypeArguments()).filter((argument): argument is TypeParameter =>
        argument.isTypeParameter(),
      )
  const encoding = input.type.isTypeReference()
    ? await encodeType(input.type, scope, state, undefined)
    : await encodeType(input.type, scope, state, input.declarationId)
  const id = stableId(encoding)
  if (memo !== undefined) {
    memo.types.set(input.type.id, id)
    if (input.printed !== undefined && isClosedPrint(input.printed))
      memo.printed.set(input.printed, id)
  }
  return id
}
