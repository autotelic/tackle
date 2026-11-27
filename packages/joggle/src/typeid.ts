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

interface EncodingState extends TypeIdContext {
  /** Declaration ids currently being encoded, so a cycle terminates by name. */
  readonly visiting: Set<string>
}

const byHash = (left: string, right: string): number => {
  const a = stableId(left)
  const b = stableId(right)
  return a < b ? -1 : a > b ? 1 : 0
}

const literalOf = (type: Type): string | undefined => {
  if (!type.isLiteralType()) return undefined
  const value = type.value
  return "literal:" + (typeof value === "bigint" ? value.toString() : String(value))
}

/** The parameters a type brings into scope, in declaration order. */
const parametersOf = async (type: Type): Promise<ReadonlyArray<TypeParameter>> => {
  if (type.isClassOrInterface()) return await type.getTypeParameters()
  return []
}

const aliasArgumentsOf = async (type: Type): Promise<ReadonlyArray<Type>> =>
  type.isObjectType() ? await type.getAliasTypeArguments() : []

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
const encode = async (
  type: Type,
  scope: ReadonlyArray<TypeParameter>,
  state: EncodingState,
  currentDeclaration?: string,
): Promise<string> => {
  // The checker's own failure is a fact, and it is not `any` or `unknown`.
  if (type.isErrorType()) return "error"
  if (type.isTypeParameter()) {
    const position = await positionOf(type, scope)
    return position < 0 ? "param:free" : "param:" + String(position)
  }

  const literal = literalOf(type)
  if (literal !== undefined) return literal

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
    const reference = type as TypeReference
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
    state.visiting.add(marker)
    try {
      const encoded = await Promise.all(args.map((arg) => encode(arg, scope, state)))
      return "ref(" + marker + (encoded.length > 0 ? ";" + encoded.join(",") : "") + ")"
    } finally {
      state.visiting.delete(marker)
    }
  }

  if (type.isObjectType()) {
    const symbol = await declarationSymbolOf(type)
    const current =
      currentDeclaration ?? (symbol === undefined ? undefined : await state.declarationIdOf(symbol))
    if (current !== undefined) {
      if (state.visiting.has(current)) return "cycle(" + current + ")"
      state.visiting.add(current)
    }
    try {
      const own = await parametersOf(type)
      const aliases = await aliasArgumentsOf(type)
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
    } finally {
      if (current !== undefined) state.visiting.delete(current)
    }
  }

  // A type kind this walk has not named still gets its flags, never printed text.
  return "flags:" + String(type.flags)
}

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
  },
): Promise<string> => {
  const state: EncodingState = {
    checker: input.checker,
    declarationIdOf: input.declarationIdOf,
    visiting: new Set<string>(),
  }
  const scope = input.type.isClassOrInterface()
    ? await input.type.getTypeParameters()
    : (await input.type.getAliasTypeArguments()).filter((argument): argument is TypeParameter =>
        argument.isTypeParameter(),
      )
  const encoding = input.type.isTypeReference()
    ? await encode(input.type, scope, state)
    : await encode(input.type, scope, state, input.declarationId)
  return stableId(encoding)
}
