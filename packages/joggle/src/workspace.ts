import { Clock, Effect, FileSystem, Order, Path, Schema } from "effect"
import { parseSync } from "oxc-parser"
import { policy } from "./policy.ts"
import {
  buildImportGraph,
  importsIn,
  type ImportEdge,
  type ImportGraph,
  type ParsedImport,
} from "./imports.ts"
import { isIgnored, orderRules, rulesAt, type IgnoreRule } from "./gitignore.ts"
import { shortHash } from "./state.ts"
import { blockingErrors, componentName, isAstro, parseInputOf } from "./astro.ts"
import { tsconfigScope } from "./tsconfig-scope.ts"
import { looksLikeSource } from "./source.ts"
import { manifestAt, type PackageManifest } from "./manifest.ts"

export type { PackageManifest } from "./manifest.ts"

import { shinglesOf } from "./similarity.ts"
import { WorkspaceError, type SourceLocation } from "./schema.ts"
import { emptyTypeIndex, type TypeFact, type TypeIndex } from "./typetrace.ts"

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/** What a declaration is. A Schema, so the cache decoder can be exact about it. */
export const UnitKind = Schema.Literals(["function", "interface", "type"])

export type UnitKind = typeof UnitKind.Type

/**
 * One addressable declaration. This is the closest thing joggle has to an
 * occurrence: every rule either judges a `Unit` or a pair of them.
 */
export interface Unit {
  readonly kind: UnitKind
  readonly name: string
  readonly file: string
  readonly start: number
  readonly end: number
  readonly location: SourceLocation
  readonly exported: boolean
  /** The declaration exactly as written. */
  readonly text: string
  /** The declaration with every identifier replaced by `_`. */
  readonly shape: string
  readonly tokens: ReadonlyArray<string>
  /**
   * Token-bigram set, computed once. Rebuilding it inside `similarity` meant two
   * thrown-away Set allocations and a string concatenation per bigram on every
   * pair comparison -- millions of allocations to answer a question the unit
   * already knew the answer to.
   */
  readonly shingles: ReadonlySet<string>
  readonly shapeHash: string
  /** Type-position names this declaration mentions, before resolution. */
  readonly typeRefs: ReadonlyArray<string>
  /**
   * Whether the declaration referenced any type at all.
   *
   * False for every declaration in a `.js` file, and for unannotated ones in
   * `.ts`. It is what lets a rule say "the shape was the only signal here"
   * instead of presenting a shape match with the authority of a typed one.
   */
  readonly typed: boolean
  /**
   * Each field's own declaration, normalised: `id: string`, `name?: string`, in
   * the order the declaration lists them. The keys are the property names, so one
   * map carries both the ordered field list and what each field says; a second
   * parallel array would be a second source of truth that can drift.
   *
   * Empty for everything that is not an interface or a type literal.
   *
   * The set comparison in `compose-types` compared field NAMES, and two types can
   * share a name with a different type behind it. `SourceFile.units` is
   * `ReadonlyArray<Unit>`; `Encoded.units` is `ReadonlyArray<unknown>`. Reporting
   * those as one type containing the other was wrong, and the fix is to keep what
   * the field actually says.
   */
  readonly fieldTypes: ReadonlyMap<string, string>
  /**
   * The types this declaration composes -- `extends`, `A & B`, `type T = A` --
   * as `{ name, resolved }` pairs. A composed type's field set is its own fields
   * plus these, and two parallel arrays would be two sources of truth.
   *
   * `resolved` is filled in the resolution pass, once the whole file set is
   * known, so a rule comparing field sets can follow inheritance across files.
   */
  composed: ReadonlyArray<ComposedBase>
  /**
   * Every call this declaration makes, resolved to where the callee is declared.
   *
   * Ordered, with repeats: two calls to the same function are two calls. This is
   * the second signal a body carries -- what it DOES, against what it looks like
   * -- and it is the one that survives a rewrite, since a re-implementation can
   * have a different shape and the same orchestration.
   */
  calls: ReadonlyArray<string>
  /** `calls` joined, so two declarations can be compared as sequences. */
  callSignature: string
  /**
   * Whether this declaration came from a test file.
   *
   * Kept on the unit rather than used to exclude it, because the two cases are
   * not the same: a helper duplicated between two spec files is a factory doing
   * its job, while a helper duplicated between a spec and the code it tests means
   * the spec is asserting against its own copy. The first should be silence; the
   * second is one of the more valuable things this tool can say, and excluding
   * test files wholesale threw it away.
   */
  readonly test: boolean
  /**
   * The same names after following this file's imports to where each is
   * declared. Two declarations whose shape matches but whose resolved types
   * differ are not the same thing, however alike they read.
   *
   * Filled in a second pass, once the whole file set is known: a type name only
   * means something when we know where it came from.
   */
  typeSignature: string
  /**
   * What the compiler resolved this declaration's type to.
   *
   * `undefined` means the run had no trace, which is not the same as "the
   * compiler had nothing to say": `at()` is the difference, and a rule that
   * cannot tell the two apart reports silence as agreement. `display` is the
   * checker's own printed form -- the structural fingerprint a trace can give --
   * and `origin` is where the checker attributes the type, which is not always
   * this declaration when an alias is involved.
   */
  typeFacts: TypeFact | undefined
  /** The comment directly above the declaration, if there is one. */
  readonly doc: string | undefined
}

/*
 * Structure a JSX codebase reveals through names rather than shapes.
 *
 * A composition pattern is a convention about how components are organised --
 * a context, a provider, blocks, and a dot-notation export -- and every part of
 * that convention is spelled somewhere in the source. These three lists are
 * enough to check it without a renderer, a bundler or a runtime.
 *
 * Declared as a Schema because it is written to the parse cache. Deriving the
 * type from the decoder rather than declaring it beside one keeps a single source
 * of truth: the cache file is external -- it can be truncated or edited by hand --
 * so it is worth decoding, and the type follows from what the decoder accepts.
 */
/** One object literal: what it holds, and where it is. */
export const ObjectSite = Schema.Struct({
  keys: Schema.Array(Schema.String),
  start: Schema.Number,
  /**
   * True when the literal IS a type declaration, such as the field object of a
   * `Schema.Struct`. A declaration is not a shape that needs a name; it is the
   * name.
   */
  declared: Schema.Boolean,
  /**
   * The declaration's non-optional keys, and empty for a literal that is not a
   * declaration. A use of the type may omit its optional keys, so this is what
   * tells a use from a shape that merely shares some keys.
   */
  required: Schema.Array(Schema.String),
  /**
   * The keys whose value admits `null`, such as `Schema.NullOr(...)`. Nullability
   * is a value, not strictness: a schema says whether the column can hold one.
   */
  nullable: Schema.Array(Schema.String),
  /**
   * A key's mapping to the column it reads, from
   * `.annotate({ sourceColumn: 'table.column' })`.
   *
   * The mapping is explicit because it is not derivable: `PayrollCrewRowSchema`
   * reads `payroll_crew.shakti_user_id` into a field called `person_id`, and no
   * name convention turns one into the other. A repository opts in by annotating;
   * the rule then compares the two nullabilities.
   */
  sources: Schema.Record(Schema.String, Schema.String),
  /**
   * Each field's `Schema` constructor chain, outermost first: `["optionalKey",
   * "Finite"]`. A FACT about the wire schema, not about the repository: `Finite`
   * excludes `Infinity` and `NaN`, `NullOr` admits a null, `Int` excludes a
   * fraction. It is what a value produced on the other side has to satisfy.
   */
  schemas: Schema.Record(Schema.String, Schema.Array(Schema.String)),
})

/**
 * One column a migration creates or alters: its table, its name, whether it
 * admits null.
 *
 * A migration is a specification, not an opinion, so this is a fact the checker
 * reads from the source rather than a judgement. Knex defaults a column to
 * nullable; `.notNullable()` is what makes it required. `.onDelete('SET NULL')`
 * is deliberately NOT read as nullability: the column can still be nullable or
 * not, and the action is about the parent row.
 */
export const ColumnFact = Schema.Struct({
  table: Schema.String,
  column: Schema.String,
  nullable: Schema.Boolean,
  /** The offset of the `table.<type>('<column>')` call, for the line. */
  start: Schema.Number,
})

/** One call, where it is, what it names, and the shape of its arguments. */
export const CallSite = Schema.Struct({
  /** Callee name, dotted for member calls: `createContext`, `React.useState`. */
  name: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  /**
   * How many arguments the call passes. A call whose default path passes none is
   * the shape a data-access question needs.
   */
  argumentCount: Schema.Number,
  /**
   * The keys of the call's one object-literal argument, when it has exactly one.
   *
   * A FACT about the call: which filters it sets, not which it ought to. Which of
   * the missing ones would bound a read is the question.
   */
  argumentKeys: Schema.Array(Schema.String),
})

/**
 * A place a string is built from other values: a template literal, or a `+`
 * with a string literal on one side.
 *
 * Structural, not semantic. It says a string is constructed here and which
 * references it interpolates (`$${row.amount}`, `total + " km"`); it does NOT
 * say the string is money, a date or a percent. A rule that needs to know what
 * the string means asks, instead of matching the text for known shapes.
 */
export const StringSite = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  /** The references interpolated into it, dotted: `row.amount`, `total`. */
  refs: Schema.Array(Schema.String),
})

export interface StringSite extends Schema.Schema.Type<typeof StringSite> {}

/**
 * An `if` statement, and whether its branch leaves the function.
 *
 * The guard's SHAPE is syntax -- a test, the references it names, whether the
 * branch returns or throws -- so it belongs here rather than in a rule matching
 * `if (!x)` against the source.
 */
export const GuardSite = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  /** The references the test names, dotted. */
  refs: Schema.Array(Schema.String),
  /** True when the consequent returns or throws: a guard clause. */
  exits: Schema.Boolean,
})

export interface GuardSite extends Schema.Schema.Type<typeof GuardSite> {}

/**
 * A `continue` in a loop: a place a unit skips an item.
 *
 * Structural, not semantic. It says the loop moved on without this item; it does
 * NOT say the skip is a data loss the caller must know about. That is a question.
 */
export const SkipSite = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
})

export interface SkipSite extends Schema.Schema.Type<typeof SkipSite> {}

/**
 * A string literal, and where it is.
 *
 * Structural: it says a piece of text is written here. It does NOT say the text
 * is a label, a route name or a message. A rule that needs to know asks.
 */
export const LiteralSite = Schema.Struct({
  value: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
})

export interface LiteralSite extends Schema.Schema.Type<typeof LiteralSite> {}

/** A `return`, where it is. The expression it returns is what a type question asks about. */
export const ReturnSite = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
})

export interface ReturnSite extends Schema.Schema.Type<typeof ReturnSite> {}

/** A comparison, its operator and span. A language construct, not a repository idiom. */
export const ComparisonSite = Schema.Struct({
  start: Schema.Number,
  end: Schema.Number,
  operator: Schema.String,
})

export interface ComparisonSite extends Schema.Schema.Type<typeof ComparisonSite> {}

export const StructureFacts = Schema.Struct({
  /**
   * Every call site in the file, in order.
   *
   * Ordered and not deduplicated, because both properties are load-bearing: a
   * count needs multiplicity and a PATTERN is a sequence. The span is what lets a
   * call be attributed to the declaration that makes it.
   */
  callSites: Schema.Array(CallSite),
  /** Element names as written, dotted for member JSX: `Button`, `Counter.Provider`. */
  jsx: Schema.Array(Schema.String),
  /** Every object literal: its key names, and where it starts. */
  objects: Schema.Array(ObjectSite),
  /** Columns a migration creates or alters, with their nullability. */
  columns: Schema.Array(ColumnFact),
  /** Every place a string is built from other values. */
  stringSites: Schema.Array(StringSite),
  /** Every `if` statement, with the references its test names. */
  guards: Schema.Array(GuardSite),
  /** Every `continue`: a place a loop skips an item. */
  skips: Schema.Array(SkipSite),
  /** Every string literal, with its value and span. */
  literals: Schema.Array(LiteralSite),
  /**
   * Functions whose every parameter is optional or defaulted, by name.
   *
   * A list rather than a boolean on each unit: a fourth flag on `Unit` was a
   * smell (the linter's `no-boolean-field-signals`), and this is a fact about the
   * file, not a property of the declaration a rule reads.
   */
  allOptionalFunctions: Schema.Array(Schema.String),
  /** Every `return`, with its span. */
  returns: Schema.Array(ReturnSite),
  /** Every comparison (`===`, `>`, `in`, ...), a language construct. */
  comparisons: Schema.Array(ComparisonSite),
})

export interface StructureFacts extends Schema.Schema.Type<typeof StructureFacts> {}

export interface SourceFile {
  readonly path: string
  readonly text: string
  readonly units: ReadonlyArray<Unit>
  /** Raw import/re-export statements, before resolution. */
  readonly importStatements: ReadonlyArray<ParsedImport>
  /** Names the file spells: what it calls, what it renders, what it declares. */
  readonly facts: StructureFacts
}

/*
 * The deterministic substrate. Its only job is to make candidate generation
 * cheap and high-recall; it makes no judgements.
 */
/* A file that was read and could not be parsed, with the parser's own words. */
/**
 * What a package says about itself.
 *
 * A package's own manifest is the material a question about its dependencies
 * needs. `packages/fasdentify` importing fastify is either a violation or the
 * package's entire purpose, and only one field decides which:
 *
 *   "description": "A Fastify plugin for sending mail"
 *
 * The docs call state "the material you would present to a panel of experts". I
 * asked the panel whether a package should import a framework without telling it
 * what the package was, and it gave the only answer available from that material.
 */
export interface UnparsedFile {
  readonly path: string
  readonly reason: string
}

export interface Workspace {
  readonly root: string
  readonly files: ReadonlyArray<SourceFile>
  readonly units: ReadonlyArray<Unit>
  readonly byName: ReadonlyMap<string, ReadonlyArray<Unit>>
  /**
   * Who imports what, resolved against the files actually analysed. This is
   * pillar two of the four in docs/new-passes.md and it was the missing one:
   * without it, "keep X and import it here" was advice we had never checked, and
   * there was no way to know what a deletion would break.
   */
  readonly imports: ImportGraph
  /**
   * Files that were read and could not be parsed.
   *
   * Recorded rather than dropped: a file the parser rejected is a hole in every
   * rule's view of the repository, and until this existed the parse result's
   * `errors` array was never read at all.
   */
  readonly unparsed: ReadonlyArray<UnparsedFile>
  /**
   * The nearest manifest above each analysed directory, keyed by that directory.
   *
   * Derived from the filesystem rather than declared, so it cannot go stale: move
   * a package and its description travels with it.
   */
  readonly manifests: ReadonlyMap<string, PackageManifest>
  /** What the load cost, phase by phase. Printed with the rule timings. */
  readonly phases: ReadonlyArray<{ readonly phase: string; readonly ms: number }>
  /** How much of the parse came from the cache. Reported, never assumed. */
  readonly parses: Parses
  /**
   * Declarations that came from a test file.
   *
   * They are analysed, but only against each other: a factory repeated in two
   * spec files is doing its job, while a helper repeated between a spec and the
   * code it tests means the spec asserts against its own copy.
   */
  readonly testDeclarations: number
  /**
   * Declarations not analysed because a transpiler emitted them.
   *
   * TypeScript and Babel emit a helper into every file that needs one, so
   * `__classPrivateFieldGet` appears once per file BY CONSTRUCTION. Reporting
   * those as duplication is reporting the compiler.
   */
  readonly excludedHelpers: number
  /**
   * The compiler's view of every declaration's type, or an empty index when the
   * run did not ask for a trace.
   *
   * The index answers "what is this declaration's type" and "where does the
   * checker say it was declared". A rule reads it directly for the second
   * question; the first is already on the unit, filled in the same resolution
   * pass that resolves type names.
   */
  readonly types: TypeIndex
}

/* -------------------------------------------------------------------------- */
/* Source helpers                                                              */
/* -------------------------------------------------------------------------- */

/** True for a plain object: the narrowing every raw JSON read begins with. */
export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

interface IdentifierSite {
  readonly start: number
  readonly end: number
  readonly name: string
  /**
   * Property keys, member-access properties and type references are part of what
   * a declaration *means*; local binding names are not. Keeping the former and
   * erasing the latter is the difference between "the same shape" and "the same
   * thing".
   */
  readonly siteKind: "binding" | "property" | "type"
}

/**
 * Node kinds that name a *type*. In a type position the identifier is the whole
 * meaning: `z.infer<typeof CompanyTypeSchema>` and `z.infer<typeof schema>` are
 * different types, and `FastifyRequest<{ Params: { id: string } }>` is a
 * different endpoint in every route that declares one. Erasing these made the
 * shape matcher claim those pairs were identical, which cost 308 of 525
 * verification calls on one codebase answering "keep both".
 */
const TYPE_REFERENCE_ROOT = new Set([
  "TSClassImplements",
  "TSInterfaceHeritage",
  "TSTypeQuery",
  "TSTypeReference",
])

/**
 * Node kinds whose `key` or `property` names the shape rather than the reader:
 * `user.name`, `{ name: string }`, `{ name }`, class fields, enum members.
 */
const PROPERTY_BEARING = new Set([
  "AccessorProperty",
  "ClassProperty",
  "MemberExpression",
  "MethodDefinition",
  "ObjectProperty",
  "Property",
  "PropertyDefinition",
  "TSEnumMember",
  "TSMethodSignature",
  "TSPropertySignature",
])

/** Every `Identifier` in a subtree, as start offsets. */
const identifierOffsets = (root: unknown): ReadonlyArray<number> => {
  const offsets: Array<number> = []
  const stack: Array<unknown> = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    if (!isRecord(node)) continue
    if (node["type"] === "Identifier" && typeof node["start"] === "number") {
      offsets.push(node["start"])
    }
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") stack.push(value)
    }
  }
  return offsets
}

/**
 * Collect every `Identifier` node in the file, marking the ones that are shape.
 *
 * Three things survive normalisation: property names, type references, and
 * generic type-parameter *declarations* (which are local bindings, so `f<T>`
 * and `g<U>` still compare equal). Everything else is a local name.
 */
const collectIdentifiers = (root: unknown): ReadonlyArray<IdentifierSite> => {
  const found: Array<{ start: number; end: number; name: string }> = []
  const properties = new Set<number>()
  const types = new Set<number>()
  const typeRoots: Array<unknown> = []
  const typeParameters = new Set<string>()
  const stack: Array<unknown> = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    if (!isRecord(node)) continue
    const kind = node["type"]
    if (typeof kind === "string") {
      if (PROPERTY_BEARING.has(kind)) {
        for (const field of ["key", "property", "id"]) {
          const child = node[field]
          if (isRecord(child) && child["type"] === "Identifier" && typeof child["start"] === "number") {
            properties.add(child["start"])
          }
        }
      }
      if (TYPE_REFERENCE_ROOT.has(kind)) typeRoots.push(node)
      if (kind === "TSTypeParameter") {
        const name = node["name"]
        if (isRecord(name) && typeof name["name"] === "string") typeParameters.add(name["name"])
      }
    }
    if (
      kind === "Identifier" &&
      typeof node["name"] === "string" &&
      typeof node["start"] === "number" &&
      typeof node["end"] === "number"
    ) {
      found.push({ start: node["start"], end: node["end"], name: node["name"] })
    }
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") stack.push(value)
    }
  }

  for (const typeRoot of typeRoots) {
    for (const offset of identifierOffsets(typeRoot)) {
      const site = found.find((candidate) => candidate.start === offset)
      if (site === undefined || typeParameters.has(site.name)) continue
      types.add(offset)
    }
  }

  return found.map((site) => ({
    ...site,
    siteKind: properties.has(site.start) ? "property" : types.has(site.start) ? "type" : "binding",
  }))
}

interface Span {
  readonly start: number
  readonly end: number
}

/**
 * Replace identifier names (and comments) with `_` / whitespace so that two
 * declarations with the same structure but different vocabulary compare equal.
 *
 * Only the leading identifier characters are replaced, so a parameter's type
 * annotation is preserved: `a: number` becomes `_: number`.
 */
const normalize = (
  text: string,
  span: Span,
  identifiers: ReadonlyArray<IdentifierSite>,
  comments: ReadonlyArray<Span>,
): string => {
  interface Edit {
    readonly start: number
    readonly end: number
    readonly text: string
  }
  const edits: Array<Edit> = []
  for (const comment of comments) {
    if (comment.start >= span.start && comment.end <= span.end) {
      edits.push({ start: comment.start, end: comment.end, text: " " })
    }
  }
  for (const identifier of identifiers) {
    if (identifier.siteKind !== "binding") continue
    if (identifier.start < span.start) continue
    if (identifier.start + identifier.name.length > span.end) continue
    if (text.slice(identifier.start, identifier.start + identifier.name.length) !== identifier.name) continue
    edits.push({ start: identifier.start, end: identifier.start + identifier.name.length, text: "_" })
  }
  edits.sort((a, b) => b.start - a.start)
  let out = text.slice(span.start, span.end)
  for (const edit of edits) {
    const from = edit.start - span.start
    const to = edit.end - span.start
    out = out.slice(0, from) + edit.text + out.slice(to)
  }
  return out.replace(/\s+/g, " ").trim()
}

const TOKEN_PATTERN = /[A-Za-z0-9_$]+|[^\sA-Za-z0-9_$]/g

/** Split a shape string into its tokens. */
export const tokenize = (shape: string): ReadonlyArray<string> => {
  const tokens: Array<string> = []
  for (const match of shape.matchAll(TOKEN_PATTERN)) tokens.push(match[0])
  return tokens
}



/**
 * The offset at which each line of a file begins, in UTF-16 code units.
 *
 * The unit the parser reports, so a parser offset and a line table agree. A
 * table in UTF-8 bytes put every declaration after an em dash on the wrong line.
 *
 * @param text - The file's text.
 * @returns One offset per line, the first being 0.
 */
export const lineStarts = (text: string): ReadonlyArray<number> => {
  const found: Array<number> = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "\n") found.push(index + 1)
  }
  return found
}

const locate = (starts: ReadonlyArray<number>, offset: number): { line: number; column: number } => {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    const value = starts[mid]
    if (value !== undefined && value <= offset) low = mid
    else high = mid - 1
  }
  const start = starts[low]
  return { line: low + 1, column: start === undefined ? 1 : offset - start + 1 }
}

/* -------------------------------------------------------------------------- */
/* Extraction                                                                  */
/* -------------------------------------------------------------------------- */

type Lang = "js" | "jsx" | "ts" | "tsx"

/**
 * The language of a file, from its extension.
 *
 * `.js` is the interesting one. JSX in a `.js` file is legal under the configs
 * most React applications use, and oxc parses `lang: "js"` strictly enough to
 * reject it. So the extension gives a first guess and the parser gets the last
 * word -- see `parseSourceFile`, which gives a `.js` file a second reading as
 * JSX when the first one reports errors, rather than guessing from the contents.
 */
const langOf = (file: string): Lang => {
  const dot = file.lastIndexOf(".")
  const extension = dot < 0 ? "" : file.slice(dot)
  switch (extension) {
    case ".tsx":
      return "tsx"
    case ".jsx":
      return "jsx"
    case ".ts":
    case ".mts":
    case ".cts":
    case ".astro":
      return "ts"
    default:
      return "js"
  }
}

interface DeclarationSite extends Span {
  readonly kind: UnitKind
  readonly name: string
  readonly exported: boolean
  readonly allParamsOptional: boolean
  readonly fieldTypes: ReadonlyMap<string, string>
  /** The types this declaration composes, before resolution. */
  readonly bases: ReadonlyArray<string>
  /**
   * Where the declaration's own statement starts, for the doc lookup.
   *
   * For a `const f = () => ...` the span is the arrow, but the JSDoc sits above
   * the `const`. Reading from the span dropped the doc for every const-declared
   * function, which is most of them.
   */
  readonly docStart: number
}

/**
 * The property names a type declaration lists, and the types it composes.
 *
 * An interface keeps its own fields in `body.body` and its `extends` clauses on
 * the declaration; a type alias keeps a literal's members, an intersection's
 * named constituents (`A & B`) and literal constituents, or a plain alias
 * target (`type T = A`). A union has no single field set and returns nothing.
 *
 * The bases are recorded rather than resolved here: a base can live in another
 * file, and only the workspace pass knows where a name is declared.
 */
interface FieldSet {
  readonly names: ReadonlyArray<string>
  readonly declarations: ReadonlyMap<string, string>
  readonly bases: ReadonlyArray<string>
}

/** The name a type reference or heritage clause points at, if it has one. */
const referenceName = (node: unknown): string | undefined => {
  if (!isRecord(node)) return undefined
  if (node["type"] === "TSTypeReference") {
    const typeName = node["typeName"]
    if (isRecord(typeName) && typeof typeName["name"] === "string") return typeName["name"]
    return undefined
  }
  if (node["type"] === "TSInterfaceHeritage" || node["type"] === "TSClassImplements") {
    return referenceName(node["expression"])
  }
  if (node["type"] === "Identifier" && typeof node["name"] === "string") return node["name"]
  return undefined
}

/**
 * A composed base: the name as written, and where it resolves to.
 *
 * One list of pairs rather than two parallel arrays, because two arrays are two
 * sources of truth that can drift apart. `resolved` is filled by the resolution
 * pass, once the whole file set is known.
 */
export interface ComposedBase {
  readonly name: string
  readonly resolvedTo: string
}

const fieldsOf = (node: Record<string, unknown>, text: string): FieldSet => {
  const memberLists: Array<unknown> = []
  const bases: Array<string> = []
  if (node["type"] === "TSInterfaceDeclaration") {
    const body = node["body"]
    if (isRecord(body)) memberLists.push(body["body"])
    const heritage = node["extends"]
    if (Array.isArray(heritage)) {
      for (const entry of heritage) {
        const base = referenceName(entry)
        if (base !== undefined) bases.push(base)
      }
    }
  } else if (node["type"] === "TSTypeAliasDeclaration" && isRecord(node["typeAnnotation"])) {
    const annotation = node["typeAnnotation"]
    if (Array.isArray(annotation["members"])) memberLists.push(annotation["members"])
    if (annotation["type"] === "TSIntersectionType" && Array.isArray(annotation["types"])) {
      for (const part of annotation["types"]) {
        if (isRecord(part) && Array.isArray(part["members"])) memberLists.push(part["members"])
        const base = referenceName(part)
        if (base !== undefined) bases.push(base)
      }
    } else {
      const base = referenceName(annotation)
      if (base !== undefined) bases.push(base)
    }
  }
  const names: Array<string> = []
  const declarations = new Map<string, string>()
  for (const members of memberLists) {
    if (!Array.isArray(members)) continue
    for (const member of members) {
      if (!isRecord(member)) continue
      const key = member["key"]
      if (!isRecord(key)) continue
      const name =
        typeof key["name"] === "string"
          ? key["name"]
          : typeof key["value"] === "string"
            ? key["value"]
            : undefined
      if (name === undefined || declarations.has(name)) continue
      // The TYPE annotation, not the whole member.
      //
      // This recorded the member's source, which made "signal?: AbortSignal" and
      // "signal: AbortSignal" different declarations -- and they are not, for the
      // question being asked. A and B intersected with the first in one and the
      // second in the other is "signal: AbortSignal", which is what the whole type
      // wanted, so optionality is exactly the difference composition RESOLVES.
      // Running against a real SDK, that false difference hid a genuine finding.
      //
      // A different TYPE is a different matter: "x: string" against "x: number"
      // intersects to never, and there the fields genuinely disagree.
      const annotation = member["typeAnnotation"]
      const start = isRecord(annotation) ? annotation["start"] : undefined
      const end = isRecord(annotation) ? annotation["end"] : undefined
      const declaration =
        typeof start === "number" && typeof end === "number"
          ? text.slice(start, end).replace(/\s+/g, " ").trim()
          : name
      names.push(name)
      declarations.set(name, declaration)
    }
  }
  return { names, declarations, bases }
}

/** The property names a type declaration lists, in order: the keys of `fieldTypes`. */
export const unitFields = (unit: Unit): ReadonlyArray<string> => [...unit.fieldTypes.keys()]

/**
 * A predicate for the declarations that are named types with at least
 * `minFields` fields.
 *
 * Two rules ask this with different thresholds; one predicate keeps the test
 * itself in one place, so "what counts as a type worth comparing" cannot drift
 * between them.
 *
 * @param minFields - The least number of fields worth comparing.
 * @returns A predicate over units.
 */
export const typeUnits =
  (minFields: number): ((unit: Unit) => boolean) =>
  (unit) =>
    (unit.kind === "interface" || unit.kind === "type") && unitFields(unit).length >= minFields

/** True when every parameter is optional or has a default. */
const paramsAllOptional = (node: unknown): boolean => {
  if (!isRecord(node)) return false
  const params = node["params"]
  if (!Array.isArray(params) || params.length === 0) return false
  return params.every((param) => {
    if (!isRecord(param)) return false
    if (param["optional"] === true) return true
    return param["type"] === "AssignmentPattern"
  })
}

const sitesIn = (program: Record<string, unknown>, text: string): ReadonlyArray<DeclarationSite> => {
  const body = program["body"]
  if (!Array.isArray(body)) return []
  const sites: Array<DeclarationSite> = []

  const push = (
    node: unknown,
    kind: UnitKind,
    name: unknown,
    exported: boolean,
    docStart: number | undefined,
  ): void => {
    if (!isRecord(node)) return
    if (typeof name !== "string") return
    const start = node["start"]
    const end = node["end"]
    if (typeof start !== "number" || typeof end !== "number") return
    const fieldSet = fieldsOf(node, text)
    sites.push({
      kind,
      name,
      start,
      end,
      exported,
      allParamsOptional: paramsAllOptional(node),
      fieldTypes: fieldSet.declarations,
      bases: fieldSet.bases,
      docStart: docStart ?? start,
    })
  }

  const fromDeclaration = (
    declaration: unknown,
    exported: boolean,
    docStart: number | undefined,
  ): void => {
    if (!isRecord(declaration)) return
    switch (declaration["type"]) {
      case "FunctionDeclaration": {
        const id = declaration["id"]
        push(declaration, "function", isRecord(id) ? id["name"] : undefined, exported, docStart)
        return
      }
      case "TSInterfaceDeclaration": {
        const id = declaration["id"]
        push(declaration, "interface", isRecord(id) ? id["name"] : undefined, exported, docStart)
        return
      }
      case "TSTypeAliasDeclaration": {
        const id = declaration["id"]
        push(declaration, "type", isRecord(id) ? id["name"] : undefined, exported, docStart)
        return
      }
      case "VariableDeclaration": {
        const declarators = declaration["declarations"]
        if (!Array.isArray(declarators)) return
        for (const declarator of declarators) {
          if (!isRecord(declarator)) continue
          const id = declarator["id"]
          const init = declarator["init"]
          if (!isRecord(init)) continue
          const initType = init["type"]
          if (initType === "ObjectExpression") {
            fromDeclaration(init, exported, docStart)
            continue
          }
          if (initType !== "ArrowFunctionExpression" && initType !== "FunctionExpression") continue
          push(init, "function", isRecord(id) ? id["name"] : undefined, exported, docStart)
        }
        return
      }
      // Class methods and object-literal methods were invisible: only top-level
      // declarations became units, so a helper copied between two classes or two
      // API objects was never a candidate. They are named Owner.member so a
      // reader can tell which one the report means.
      case "ClassDeclaration":
      case "ClassExpression": {
        const classId = declaration["id"]
        const className =
          isRecord(classId) && typeof classId["name"] === "string" ? classId["name"] : undefined
        const body = declaration["body"]
        if (!isRecord(body)) return
        const members = body["body"]
        if (!Array.isArray(members)) return
        for (const member of members) {
          if (!isRecord(member)) continue
          const key = member["key"]
          const keyName = isRecord(key) && typeof key["name"] === "string" ? key["name"] : undefined
          if (keyName === undefined) continue
          const name = className === undefined ? keyName : `${className}.${keyName}`
          const value = member["value"]
          if (isRecord(value) && typeof value["start"] === "number" && typeof value["end"] === "number") {
            sites.push({
              kind: "function",
              name,
              start: value["start"],
              end: value["end"],
              exported,
              allParamsOptional: paramsAllOptional(value),
              fieldTypes: new Map(),
              bases: [],
              docStart: typeof member["start"] === "number" ? member["start"] : value["start"],
            })
          } else {
            push(member, "function", name, exported, undefined)
          }
        }
        return
      }
      case "ObjectExpression": {
        const properties = declaration["properties"]
        if (!Array.isArray(properties)) return
        for (const property of properties) {
          if (!isRecord(property) || property["type"] !== "Property") continue
          const key = property["key"]
          const keyName = isRecord(key) && typeof key["name"] === "string" ? key["name"] : undefined
          if (keyName === undefined) continue
          const value = property["value"]
          if (!isRecord(value)) continue
          const valueType = value["type"]
          if (valueType !== "ArrowFunctionExpression" && valueType !== "FunctionExpression") continue
          push(value, "function", keyName, exported, undefined)
        }
        return
      }
      default:
        return
    }
  }

  for (const statement of body) {
    if (!isRecord(statement)) continue
    switch (statement["type"]) {
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration":
        // The doc sits above the `export`, so the lookup starts at the statement.
        fromDeclaration(
          statement["declaration"],
          true,
          typeof statement["start"] === "number" ? statement["start"] : undefined,
        )
        continue
      case "FunctionDeclaration":
      case "TSInterfaceDeclaration":
      case "TSTypeAliasDeclaration":
      case "VariableDeclaration":
        fromDeclaration(
          statement,
          false,
          typeof statement["start"] === "number" ? statement["start"] : undefined,
        )
        continue
      default:
        continue
    }
  }

  return sites
}

/**
 * Collect the names a file spells.
 *
 * One generic walk, three lists. A composition pattern is checkable from them
 * because every part of the convention is literally written down: a call to
 * `createContext`, a render of `Counter.Provider`, an object literal with
 * `state`, `actions` and `meta` among its keys.
 */
const structureIn = (root: unknown, allOptionalFunctions: ReadonlyArray<string>): StructureFacts => {
  const callSites: Array<typeof CallSite.Type> = []
  const jsx = new Set<string>()
  const objects: Array<typeof ObjectSite.Type> = []
  const columns: Array<typeof ColumnFact.Type> = []
  const stringSites: Array<StringSite> = []
  const guards: Array<GuardSite> = []
  const skips: Array<SkipSite> = []
  const literals: Array<LiteralSite> = []
  const returns: Array<ReturnSite> = []
  const comparisons: Array<ComparisonSite> = []
  interface DeclaredFields {
    readonly required: Array<string>
    readonly nullable: Array<string>
    readonly sources: Record<string, string>
    readonly schemas: Record<string, ReadonlyArray<string>>
  }
  const declaredObjects = new Map<number, DeclaredFields>()

  const nameOf = (node: unknown): string | undefined => {
    if (!isRecord(node)) return undefined
    if (node["type"] === "Identifier" && typeof node["name"] === "string") return node["name"]
    if (node["type"] === "MemberExpression" || node["type"] === "StaticMemberExpression") {
      const object = nameOf(node["object"])
      const property = node["property"]
      const key =
        isRecord(property) && typeof property["name"] === "string" ? property["name"] : undefined
      return object !== undefined && key !== undefined ? object + "." + key : undefined
    }
    if (node["type"] === "JSXIdentifier" && typeof node["name"] === "string") return node["name"]
    if (node["type"] === "JSXMemberExpression") {
      const object = nameOf(node["object"])
      const property = nameOf(node["property"])
      return object !== undefined && property !== undefined ? object + "." + property : undefined
    }
    return undefined
  }

  /** Every reference a subtree names, dotted, deduplicated. */
  const refsIn = (node: unknown): ReadonlyArray<string> => {
    const found: Array<string> = []
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const child of value) walk(child)
        return
      }
      if (!isRecord(value)) return
      const type = value["type"]
      if (type === "Identifier" && typeof value["name"] === "string") {
        found.push(value["name"])
        return
      }
      if (type === "MemberExpression" || type === "StaticMemberExpression") {
        const name = nameOf(value)
        if (name !== undefined) found.push(name)
        return
      }
      for (const key of Object.keys(value)) {
        if (key === "type" || key === "start" || key === "end") continue
        walk(value[key])
      }
    }
    walk(node)
    return [...new Set(found)]
  }

  /** True when a subtree returns or throws. */
  const exitsIn = (node: unknown): boolean => {
    let found = false
    const walk = (value: unknown): void => {
      if (found) return
      if (Array.isArray(value)) {
        for (const child of value) walk(child)
        return
      }
      if (!isRecord(value)) return
      const type = value["type"]
      if (type === "ReturnStatement" || type === "ThrowStatement") {
        found = true
        return
      }
      for (const key of Object.keys(value)) {
        if (key === "type" || key === "start" || key === "end") continue
        walk(value[key])
      }
    }
    walk(node)
    return found
  }

  /** The method names of a call chain, outermost first: `[annotate, NullOr]`. */
  const chainOf = (node: unknown): ReadonlyArray<string> => {
    const methods: Array<string> = []
    let current: unknown = node
    for (let guard = 0; guard < 32; guard += 1) {
      if (!isRecord(current) || current["type"] !== "CallExpression") break
      const callee = current["callee"]
      if (!isRecord(callee)) break
      const property = callee["property"]
      const method = isRecord(property) && typeof property["name"] === "string" ? property["name"] : undefined
      if (method !== undefined) methods.push(method)
      current = callee["object"]
    }
    return methods
  }

  /**
   * A field value's `Schema` chain, including a bare member.
   *
   * `chainOf` follows CALL chains (`Schema.NullOr(Schema.String)`), so it misses
   * `Schema.Number`, which is a member and not a call -- and a bare `Finite` is
   * exactly the field a value has to satisfy.
   */
  const schemasOf = (value: unknown): ReadonlyArray<string> => {
    const methods = chainOf(value)
    if (methods.length > 0) return methods
    if (
      isRecord(value) &&
      (value["type"] === "MemberExpression" || value["type"] === "StaticMemberExpression")
    ) {
      const property = value["property"]
      if (isRecord(property) && typeof property["name"] === "string") return [property["name"]]
    }
    return []
  }

  /** The `sourceColumn` an `.annotate({...})` in the chain names, or "". */
  const sourceColumnOf = (value: unknown): string => {
    let current: unknown = value
    for (let guard = 0; guard < 32; guard += 1) {
      if (!isRecord(current) || current["type"] !== "CallExpression") break
      const callee = current["callee"]
      if (!isRecord(callee)) break
      const property = callee["property"]
      const method = isRecord(property) && typeof property["name"] === "string" ? property["name"] : undefined
      if (method === "annotate") {
        const args = current["arguments"]
        if (Array.isArray(args)) {
          for (const arg of args) {
            if (!isRecord(arg) || arg["type"] !== "ObjectExpression") continue
            const properties = arg["properties"]
            if (!Array.isArray(properties)) continue
            for (const entry of properties) {
              if (!isRecord(entry)) continue
              const key = entry["key"]
              if (!isRecord(key) || key["name"] !== "sourceColumn") continue
              const field = entry["value"]
              if (isRecord(field) && typeof field["value"] === "string") return field["value"]
            }
          }
        }
      }
      current = callee["object"]
    }
    return ""
  }

  // The non-optional keys of a `Schema.Struct` field object, the keys that admit
  // null, and the column each field reads.
  const declaredFieldsOf = (object: Record<string, unknown>): DeclaredFields => {
    const properties = object["properties"]
    const required: Array<string> = []
    const nullable: Array<string> = []
    const sources: Record<string, string> = {}
    const schemas: Record<string, ReadonlyArray<string>> = {}
    if (!Array.isArray(properties)) return { required, nullable, sources, schemas }
    for (const property of properties) {
      if (!isRecord(property)) continue
      const key = property["key"]
      const name = isRecord(key) && typeof key["name"] === "string" ? key["name"] : undefined
      if (name === undefined) continue
      const value = property["value"]
      const methods = schemasOf(value)
      if (!methods.includes("optionalKey") && !methods.includes("optional")) required.push(name)
      if (methods.includes("NullOr")) nullable.push(name)
      const source = sourceColumnOf(value)
      if (source !== "") sources[name] = source
      if (methods.length > 0) schemas[name] = methods
    }
    return { required, nullable, sources, schemas }
  }

  // A same-file `const NAME = 'value'`, so `createTable(PAYROLL_CREW, ...)` names
  // its table even though the table name is not a literal.
  const constStrings = new Map<string, string>()
  const collectConsts = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) collectConsts(child)
      return
    }
    if (!isRecord(node)) return
    if (node["type"] === "VariableDeclarator") {
      const id = node["id"]
      const init = node["init"]
      if (
        isRecord(id) &&
        id["type"] === "Identifier" &&
        typeof id["name"] === "string" &&
        isRecord(init) &&
        init["type"] === "Literal" &&
        typeof init["value"] === "string"
      ) {
        constStrings.set(id["name"], init["value"])
      }
    }
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") collectConsts(value)
    }
  }
  collectConsts(root)

  const tableNameOf = (arg: unknown): string => {
    if (!isRecord(arg)) return ""
    if (typeof arg["value"] === "string") return arg["value"]
    if (arg["type"] === "Identifier" && typeof arg["name"] === "string") return constStrings.get(arg["name"]) ?? ""
    return ""
  }

  const COLUMN_TYPES = new Set([
    "uuid", "string", "text", "integer", "bigInteger", "smallint", "tinyint", "float", "double",
    "decimal", "boolean", "timestamp", "datetime", "date", "time", "json", "jsonb", "binary",
    "increments", "bigIncrements", "enu", "specificType",
  ])

  /** Record the column a `table.<type>('<name>')` chain builds, if it is one. */
  const addColumn = (table: string, node: unknown): void => {
    let current: unknown = node
    const methods: Array<string> = []
    for (let guard = 0; guard < 32; guard += 1) {
      if (!isRecord(current) || current["type"] !== "CallExpression") return
      const callee = current["callee"]
      if (!isRecord(callee)) return
      const property = callee["property"]
      const method = isRecord(property) && typeof property["name"] === "string" ? property["name"] : undefined
      if (method !== undefined) methods.push(method)
      const base = callee["object"]
      if (method !== undefined && COLUMN_TYPES.has(method) && isRecord(base) && base["type"] === "Identifier") {
        const args = current["arguments"]
        const first = Array.isArray(args) ? args[0] : undefined
        const start = current["start"]
        if (isRecord(first) && typeof first["value"] === "string" && typeof start === "number") {
          // A primary key is NOT NULL in Postgres even without `.notNullable()`.
          const nullable = !methods.includes("notNullable") && !methods.includes("primary")
          columns.push({ table, column: first["value"], nullable, start })
        }
        return
      }
      current = base
    }
  }

  const statementsOf = (fn: unknown): ReadonlyArray<unknown> => {
    if (!isRecord(fn)) return []
    const body = fn["body"]
    if (isRecord(body) && body["type"] === "BlockStatement") {
      const statements = body["body"]
      return Array.isArray(statements) ? statements : []
    }
    return body === undefined ? [] : [body]
  }

  const stack: Array<unknown> = [root]
  while (stack.length > 0) {
    const node = stack.pop()
    if (Array.isArray(node)) {
      for (const child of node) stack.push(child)
      continue
    }
    if (!isRecord(node)) continue
    switch (node["type"]) {
      case "CallExpression": {
        const called = nameOf(node["callee"])
        const start = node["start"]
        const end = node["end"]
        // Every call site, in order, with its span.
        //
        // This was a Set, so a file calling useState thirty-four times reported
        // one -- and a rule whose TRIGGER counted those calls could never fire.
        // Order is kept because a call PATTERN is a sequence, and the span is
        // kept so a call can be attributed to the declaration that makes it.
        if (called !== undefined && typeof start === "number" && typeof end === "number") {
          const args = Array.isArray(node["arguments"]) ? node["arguments"] : []
          const argumentKeys: Array<string> = []
          if (args.length === 1 && isRecord(args[0]) && args[0]["type"] === "ObjectExpression") {
            const properties = args[0]["properties"]
            if (Array.isArray(properties)) {
              for (const property of properties) {
                if (!isRecord(property)) continue
                const key = property["key"]
                const name = isRecord(key)
                  ? typeof key["name"] === "string"
                    ? key["name"]
                    : typeof key["value"] === "string"
                      ? key["value"]
                      : undefined
                  : undefined
                if (name !== undefined) argumentKeys.push(name)
              }
            }
          }
          callSites.push({ name: called, start, end, argumentCount: args.length, argumentKeys })
        }
        // A `Schema.Struct({...})` or `Schema.TaggedError<X>()("tag", {...})`
        // argument IS a named type. Marking the field object lets the object-shape
        // rule tell a declaration from a literal that needs a name.
        const callee = node["callee"]
        const inner =
          isRecord(callee) && callee["type"] === "CallExpression" ? nameOf(callee["callee"]) : undefined
        if (called === "Schema.Struct" || inner === "Schema.TaggedError") {
          const args = node["arguments"]
          if (Array.isArray(args)) {
            for (const arg of args) {
              if (isRecord(arg) && arg["type"] === "ObjectExpression" && typeof arg["start"] === "number") {
                declaredObjects.set(arg["start"], declaredFieldsOf(arg))
              }
            }
          }
        }
        // A migration is a specification: `knex.schema.createTable(T, t => {
        // t.uuid('col').notNullable() })`. Read statically, because the DB is the
        // other half of the contract and it is not at the keyboard.
        //
        // The method comes from the callee's PROPERTY, not `nameOf`: a fluent
        // chain like `.createTable(A, ...).createTable(B, ...)` has a CallExpression
        // as its callee's object, which `nameOf` does not follow.
        const calleeProperty =
          isRecord(node["callee"]) && isRecord(node["callee"]["property"]) &&
          typeof node["callee"]["property"]["name"] === "string"
            ? node["callee"]["property"]["name"]
            : undefined
        const last = calleeProperty ?? called?.split(".").at(-1)
        if (last === "createTable" || last === "alterTable") {
          const args = node["arguments"]
          const table = tableNameOf(Array.isArray(args) ? args[0] : undefined)
          const callback = Array.isArray(args) ? args[1] : undefined
          if (table !== "") {
            for (const statement of statementsOf(callback)) {
              const expression =
                isRecord(statement) && statement["type"] === "ExpressionStatement"
                  ? statement["expression"]
                  : statement
              addColumn(table, expression)
            }
          }
        }
        break
      }
      // A literal the author put a type ON is a named shape, whatever form the
      // naming takes. `satisfies T` and `as T` are checked against a type just
      // as an annotation is, and the object-shape rule keys on the literal's
      // field set, so without this a `satisfies Record<Role, Band>` looked like
      // a shape nobody named.
      case "TSSatisfiesExpression":
      case "TSAsExpression": {
        const expression = node["expression"]
        if (
          isRecord(expression) &&
          expression["type"] === "ObjectExpression" &&
          typeof expression["start"] === "number"
        ) {
          declaredObjects.set(expression["start"], { required: [], nullable: [], sources: {}, schemas: {} })
        }
        break
      }
      case "VariableDeclarator": {
        const id = node["id"]
        const init = node["init"]
        if (
          isRecord(id) &&
          isRecord(id["typeAnnotation"]) &&
          isRecord(init) &&
          init["type"] === "ObjectExpression" &&
          typeof init["start"] === "number"
        ) {
          declaredObjects.set(init["start"], { required: [], nullable: [], sources: {}, schemas: {} })
        }
        break
      }
      case "JSXOpeningElement":
      case "JSXSelfClosingElement": {
        const element = nameOf(node["name"])
        if (element !== undefined) jsx.add(element)
        break
      }
      case "ObjectExpression": {
        const properties = node["properties"]
        if (Array.isArray(properties)) {
          const keys: Array<string> = []
          for (const property of properties) {
            if (!isRecord(property)) continue
            const key = property["key"]
            if (isRecord(key) && typeof key["name"] === "string") keys.push(key["name"])
            else if (isRecord(key) && typeof key["value"] === "string") keys.push(key["value"])
          }
          const start = node["start"]
          if (typeof start === "number") {
            const declared = declaredObjects.get(start)
            objects.push({
              keys,
              start,
              declared: declared !== undefined,
              required: declared?.required ?? [],
              nullable: declared?.nullable ?? [],
              sources: declared?.sources ?? {},
              schemas: declared?.schemas ?? {},
            })
          }
        }
        break
      }
      case "TemplateLiteral": {
        const start = node["start"]
        const end = node["end"]
        // The walker, not `nameOf`: an interpolation is often a call
        // (`${amount.toFixed(2)}`), and the reference that matters is inside it.
        if (typeof start === "number" && typeof end === "number") {
          stringSites.push({ start, end, refs: refsIn(node) })
        }
        break
      }
      case "BinaryExpression": {
        const start = node["start"]
        const end = node["end"]
        const operator = node["operator"]
        // A `+` with a string literal or a template on one side builds a string.
        const isString = (value: unknown): boolean =>
          isRecord(value) &&
          (value["type"] === "TemplateLiteral" ||
            (value["type"] === "Literal" && typeof value["value"] === "string"))
        if (operator === "+" && (isString(node["left"]) || isString(node["right"]))) {
          if (typeof start === "number" && typeof end === "number") {
            stringSites.push({ start, end, refs: refsIn(node) })
          }
          break
        }
        // A comparison, by its operator: `===`, `>`, `in`. Syntax, not meaning.
        const comparing =
          operator === "===" || operator === "!==" || operator === "==" || operator === "!=" ||
          operator === ">" || operator === "<" || operator === ">=" || operator === "<=" ||
          operator === "in" || operator === "instanceof"
        if (comparing && typeof operator === "string" && typeof start === "number" && typeof end === "number") {
          comparisons.push({ start, end, operator })
        }
        break
      }
      case "ReturnStatement": {
        // The ARGUMENT's span, not the statement's: a type question asks about
        // the expression, and `getTypeAtPosition` on `return` answers nothing.
        const argument = node["argument"]
        if (isRecord(argument) && typeof argument["start"] === "number" && typeof argument["end"] === "number") {
          returns.push({ start: argument["start"], end: argument["end"] })
        }
        break
      }
      case "Literal": {
        const start = node["start"]
        const end = node["end"]
        if (typeof node["value"] === "string" && typeof start === "number" && typeof end === "number") {
          literals.push({ value: node["value"], start, end })
        }
        break
      }
      case "JSXText": {
        // The text between tags is its own node, not a Literal -- which is why the
        // review's own case, a label inside a component, was invisible at first.
        const start = node["start"]
        const end = node["end"]
        const raw = node["value"]
        if (typeof raw === "string" && typeof start === "number" && typeof end === "number") {
          const value = raw.trim()
          if (value !== "") literals.push({ value, start, end })
        }
        break
      }
      case "ContinueStatement": {
        const start = node["start"]
        const end = node["end"]
        if (typeof start === "number" && typeof end === "number") skips.push({ start, end })
        break
      }
      case "IfStatement": {
        const start = node["start"]
        const end = node["end"]
        if (typeof start === "number" && typeof end === "number") {
          guards.push({
            start,
            end,
            refs: refsIn(node["test"]),
            exits: exitsIn(node["consequent"]),
          })
        }
        break
      }
      default:
        break
    }
    for (const value of Object.values(node)) {
      if (value !== null && typeof value === "object") stack.push(value)
    }
  }
  return { callSites, jsx: [...jsx], objects, columns, stringSites, guards, skips, literals, allOptionalFunctions, returns, comparisons }
}

/** A parse result, whichever language produced it. */
type ParsedSource = ReturnType<typeof parseSync>

const describeParseErrors = (errors: ReadonlyArray<unknown>): string => {
  const first = errors[0]
  const message =
    typeof first === "object" &&
    first !== null &&
    typeof (first as Record<string, unknown>)["message"] === "string"
      ? ((first as Record<string, unknown>)["message"] as string)
      : "the parser rejected this file"
  return errors.length > 1 ? message + " (and " + (errors.length - 1) + " more)" : message
}

/** A file's path and text, and the parse read from them. */
interface ParsedFileText {
  readonly file: string
  readonly text: string
  readonly parsed: ParsedSource
}

const sourceFileFrom = ({ file, text, parsed }: ParsedFileText): SourceFile => {
  const program: unknown = parsed.program
  const identifiers = collectIdentifiers(program)
  const comments = parsed.comments.map((comment) => ({
    start: comment.start,
    end: comment.end,
    value: comment.value,
  }))
  // The comment immediately above a declaration: docs/reference/names.md argues it is the
  // single spot an agent is guaranteed to read, so which copy carries one is
  // evidence about which copy to keep.
  const docFor = (from: number): string | undefined => {
    let best: { start: number; end: number; value: string } | undefined
    for (const comment of comments) {
      if (comment.end > from) continue
      if (text.slice(comment.end, from).trim() !== "") continue
      if (best === undefined || comment.end > best.end) best = comment
    }
    return best?.value.replace(/^\s*\*+\s?/gm, "").trim() || undefined
  }
  const starts = lineStarts(text)

  const units: Array<Unit> = []
  const sites = isRecord(program) ? sitesIn(program, text) : []
  if (isRecord(program)) {
    for (const site of sites) {
      const shape = normalize(text, site, identifiers, comments)
      const tokens = tokenize(shape)
      const from = locate(starts, site.start)
      const to = locate(starts, site.end)
      // Whether this declaration said anything about its types. In a `.js` file,
      // and in unannotated `.ts`, the answer is never. Recorded rather than
      // inferred later: "no types written" and "types written and empty" look the
      // same from outside and are not the same fact.
      const typeRefs = [
        ...new Set(
          identifiers
            .filter(
              (identifier) =>
                identifier.siteKind === "type" &&
                identifier.start >= site.start &&
                identifier.end <= site.end,
            )
            .map((identifier) => identifier.name),
        ),
      ]
      units.push({
        kind: site.kind,
        name: site.name,
        file,
        start: site.start,
        end: site.end,
        location: { file, line: from.line, column: from.column, endLine: to.line, endColumn: to.column },
        exported: site.exported,
        text: text.slice(site.start, site.end),
        shape,
        tokens,
        shingles: shinglesOf(tokens),
        shapeHash: shortHash(shape),
        typeRefs,
        typed: typeRefs.length > 0,
        fieldTypes: site.fieldTypes,
        composed: site.bases.map((name) => ({ name, resolvedTo: "" })),
        calls: [],
        callSignature: "",
        test: policy.testFiles.test(file),
        typeSignature: "",
        typeFacts: undefined,
        doc: docFor(site.docStart),
      })
    }
  }
  const imports = isRecord(program) ? importsIn(program) : []
  const allOptionalFunctions = sites
    .filter((site) => site.kind === "function" && site.allParamsOptional)
    .map((site) => site.name)
  return { path: file, text, units, importStatements: imports, facts: structureIn(program, allOptionalFunctions) }
}

/** A file we read, and either parsed or could not. */
export type ParseOutcome =
  | { readonly ok: true; readonly file: SourceFile }
  | { readonly ok: false; readonly reason: string }

/** A file's path and text, the pair the parser reads. */
export interface FileText {
  readonly file: string
  readonly text: string
}

/** An `.astro` file's `Props`, named after its component; any other file unchanged. */
const withComponentProps = (source: SourceFile): SourceFile =>
  !isAstro(source.path)
    ? source
    : {
        ...source,
        units: source.units.map((unit) =>
          unit.name === "Props" && (unit.kind === "interface" || unit.kind === "type")
            ? { ...unit, name: componentName(source.path) + "Props" }
            : unit,
        ),
      }

/**
 * Parse a file, giving `.js` a second reading as JSX.
 *
 * One retry, and then the file is REPORTED as unparsed rather than silently
 * contributing nothing. The `errors` array was never read here, so a file the
 * parser rejected looked exactly like a file with no declarations in it -- and
 * every rule's view of the repository had a hole nobody could see.
 */
const parseSourceFile = ({ file, text }: FileText): ParseOutcome => {
  const lang = langOf(file)
  const first = parseSync(file, parseInputOf({ file, text }), { sourceType: "module", lang })
  const errors = blockingErrors(file, first.errors)
  if (errors.length === 0) return { ok: true, file: withComponentProps(sourceFileFrom({ file, text, parsed: first })) }

  if (lang === "js") {
    const retry = parseSync(file, text, { sourceType: "module", lang: "jsx" })
    if (retry.errors.length === 0) return { ok: true, file: sourceFileFrom({ file, text, parsed: retry }) }
  }
  return { ok: false, reason: describeParseErrors(errors) }
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

const ignored = new Set<string>(policy.ignoredDirectories)

/* Insurance against symlink cycles and pathological trees. */
/** What discovery saw, and what it declined to look at. */
export interface Discovery {
  readonly files: ReadonlyArray<string>
  /**
   * Files the walk saw and did not treat as source, by extension.
   *
   * A bound nobody can see is indistinguishable from a bug, and this was the one
   * bound in the program with no report at all. Non-source files were dropped
   * inside the walk loop, so "287 files" read as the repository rather than as a
   * fifth of it, and an entire API written in JavaScript was invisible for as
   * long as the extension list stayed the way it was.
   */
  readonly skippedExtensions: ReadonlyArray<SkippedExtension>
  /** True when the walk stopped at its own limit rather than at the end. */
  readonly truncated: boolean
  /** Files skipped because a .gitignore says so. */
  readonly ignored: number
  /**
   * Directories skipped because a .gitignore says so.
   *
   * Counted separately because an ignored directory hides an unknown number of
   * files: `.wrangler/` is one line in a .gitignore and ten generated files on
   * disk, and reporting only the file count would have made the largest source
   * of noise in one real report look like a rounding error.
   */
  readonly ignoredDirectories: number
}

export interface SkippedExtension {
  readonly extension: string
  readonly count: number
}

/**
 * Whether a name is one a transpiler emits rather than one a person wrote.
 *
 * The lists are explicit rather than "starts with `__`", because a person is
 * allowed to write `__proto__`-adjacent names and a filter that guesses at them
 * is a filter that will one day drop real code. Every entry here is a helper
 * TypeScript or Babel puts in a file by itself.
 */
const COMPILER_HELPERS = new Set([
  "__awaiter", "__generator", "__rest", "__spread", "__spreadArray", "__spreadArrays",
  "__values", "__read", "__readInt", "__assign", "__extends", "__decorate", "__metadata",
  "__param", "__createBinding", "__setFunctionName", "__toPrimitive", "__toPropertyKey",
  "__importDefault", "__importStar", "__export", "__exportStar", "__classPrivateFieldGet",
  "__classPrivateFieldSet", "__classPrivateFieldIn", "__addDisposableResource",
  "__disposeResources", "__esDecorate", "__runInitializers", "__propKey",
  "_interopRequireDefault", "_interopRequireWildcard", "_classCallCheck", "_defineProperty",
  "_toConsumableArray", "_typeof", "_extends", "_objectSpread", "_objectSpread2",
  "_slicedToArray", "_asyncToGenerator", "_createClass", "_getPrototypeOf", "_inherits",
])

const isCompilerHelper = (name: string): boolean => COMPILER_HELPERS.has(name)

const extensionOf = (file: string): string => {
  const cut = file.lastIndexOf(".")
  return cut === -1 ? "(no extension)" : file.slice(cut)
}

const summarise = (counts: ReadonlyMap<string, number>): ReadonlyArray<SkippedExtension> =>
  [...counts.entries()]
    .map(([extension, count]) => ({ extension, count }))
    .sort(
      (left, right) => right.count - left.count || left.extension.localeCompare(right.extension),
    )

const walkLimits = { directories: 5000, files: 20000 }

/** A directory and the root it is measured against. */
interface WalkPosition {
  readonly root: string
  readonly dir: string
  readonly path: Path.Path
}

const depthOf = ({ root, dir, path }: WalkPosition): number =>
  path.relative(root, dir).split(path.sep).filter((segment) => segment !== "" && segment !== ".")
    .length

/** A directory to walk, its root, and the ignore rules already in force. */
interface WalkRequest {
  readonly dir: string
  readonly root: string
  readonly inherited?: ReadonlyArray<IgnoreRule>
}

/**
 * Walk a directory, honouring .gitignore as it goes.
 *
 * Rules accumulate as directories are entered. A rule only speaks for its own
 * directory and below it -- `isIgnored` returns early when the path is not under
 * the rule's base -- so a sibling's rules are inert rather than wrong, which is
 * what lets one list serve the whole walk.
 */
const walk = ({ dir, root, inherited = [] }: WalkRequest): Effect.Effect<Discovery, WorkspaceError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const found: Array<string> = []
    const skipped = new Map<string, number>()
    let rules: ReadonlyArray<IgnoreRule> = inherited
    let ignoredCount = 0
    let ignoredDirs = 0
    const stack: Array<string> = []
    const seen = new Set<string>()

    // The path the caller named must be readable; anything discovered below it
    // is best effort. One odd entry must not fail the whole run.
    const rootEntries = yield* fs.readDirectory(dir).pipe(
      Effect.mapError(
        (cause) => WorkspaceError.make({ path: dir, operation: "readDirectory", cause }),
      ),
    )
    seen.add(dir)
    for (const entry of rootEntries) {
      if (!ignored.has(entry)) stack.push(path.join(dir, entry))
    }

    while (stack.length > 0 && seen.size < walkLimits.directories && found.length < walkLimits.files) {
      const current = stack.pop()
      if (current === undefined) break
      // stat, not the name: a zero-byte file called "tsx" is not a directory.
      const info = yield* Effect.orElseSucceed(fs.stat(current), () => undefined)
      if (info === undefined) continue
      // Ignored first: a generated .js file is both non-source and ignored, and
      // "we were told not to look" is the more useful of the two reasons.
      if (rules.length > 0 && isIgnored(rules, current, path)) {
        if (info.type === "File") ignoredCount += 1
        else ignoredDirs += 1
        continue
      }
      if (info.type === "File") {
        if (looksLikeSource(current)) {
          found.push(current)
        } else {
          const extension = extensionOf(current)
          skipped.set(extension, (skipped.get(extension) ?? 0) + 1)
        }
        continue
      }
      if (info.type !== "Directory") continue
      if (seen.has(current)) continue
      seen.add(current)
      // A directory's own .gitignore applies to what is inside it, so it is
      // read before its children are pushed.
      const here = yield* rulesAt(current, depthOf({ root, dir: current, path }))
      if (here.length > 0) rules = orderRules([...rules, ...here])

      const entries = yield* Effect.orElseSucceed(
        fs.readDirectory(current),
        () => [] as ReadonlyArray<string>,
      )
      for (const entry of entries) {
        if (!ignored.has(entry)) stack.push(path.join(current, entry))
      }
    }
    // Both limits are reported, not silently obeyed: reaching one means the run
    // analysed part of the tree and said nothing about the rest.
    return {
      files: found.sort(Order.String),
      skippedExtensions: summarise(skipped),
      truncated: found.length >= walkLimits.files || seen.size >= walkLimits.directories,
      ignored: ignoredCount,
      ignoredDirectories: ignoredDirs,
    }
  })

const resolveInputs = (
  root: string,
  inputs: ReadonlyArray<string>,
): Effect.Effect<Discovery, WorkspaceError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const files: Array<string> = []
    const skipped = new Map<string, number>()
    let truncated = false
    let ignored = 0
    let ignoredDirectories = 0
    for (const input of inputs) {
      const absolute = path.isAbsolute(input) ? input : path.join(root, input)
      if (looksLikeSource(absolute)) {
        files.push(absolute)
        continue
      }
      // A .gitignore above the walked directory still applies to it, so the
      // chain from the root down to (but not including) the input is loaded
      // first.
      const chain: Array<IgnoreRule> = [...(yield* rulesAt(root, 0))]
      const segments = path
        .relative(root, absolute)
        .split(path.sep)
        .filter((segment) => segment !== "" && segment !== ".")
      let cursor = root
      for (const segment of segments.slice(0, -1)) {
        cursor = path.join(cursor, segment)
        chain.push(
          ...(yield* rulesAt(cursor, path.relative(root, cursor).split(path.sep).length)),
        )
      }
      const nested = yield* walk({ dir: absolute, root, inherited: orderRules(chain) })
      for (const file of nested.files) files.push(file)
      truncated = truncated || nested.truncated
      ignored += nested.ignored
      ignoredDirectories += nested.ignoredDirectories
      for (const entry of nested.skippedExtensions) {
        skipped.set(entry.extension, (skipped.get(entry.extension) ?? 0) + entry.count)
      }
    }
    return { files, skippedExtensions: summarise(skipped), truncated, ignored, ignoredDirectories }
  })

/**
 * The files this run will look at, before any of them are read.
 *
 * Separated from `loadWorkspace` so a caller can hash the inputs and decide
 * whether the analysis is worth doing at all: an unchanged repository should
 * cost a read, not a parse.
 */
export const discoverFiles = (
  root: string,
  inputs: ReadonlyArray<string>,
  discovered: ReadonlyArray<string> | undefined,
): Effect.Effect<Discovery, WorkspaceError, FileSystem.FileSystem | Path.Path> =>
  discovered !== undefined
    ? Effect.gen(function* () {
        const path = yield* Path.Path
        const inScope = yield* tsconfigScope(root)
        const walked = yield* resolveInputs(root, ["."])
        const astro = walked.files.filter(
          (file) => isAstro(file) && inScope(path.relative(root, file).split(path.sep).join("/")),
        )
        return {
          files: [...discovered, ...astro].sort(Order.String),
          skippedExtensions: [],
          truncated: walked.truncated,
          ignored: 0,
          ignoredDirectories: 0,
        }
      })
    : resolveInputs(root, inputs.length > 0 ? inputs : ["."])

/**
 * Parses to reuse, keyed by a file and its content.
 *
 * Declared here rather than in the module that persists it, so the direction is
 * one-way: the cache knows what a parse is, and the parser does not know there is
 * a cache on disk.
 */
export interface Parses {
  readonly get: (file: string, text: string) => SourceFile | undefined
  readonly set: (file: string, text: string, parsed: SourceFile) => void
  readonly hits: () => number
  readonly misses: () => number
}

/** A parse cache that always misses, for a caller with no cache to give it. */
export const noParses = (): Parses => ({
  get: () => undefined,
  set: () => undefined,
  hits: () => 0,
  misses: () => 0,
})

/** Optional inputs a caller can hand the workspace loader. */
export interface WorkspaceInputs {
  /** Files discovery already found; absent means discover them instead. */
  readonly discovered?: ReadonlyArray<string>
  /** Source text already read by the caller, keyed by absolute path. */
  readonly contents?: ReadonlyMap<string, string>
  /**
   * Parses to reuse, keyed by file and content. A parse depends on exactly two
   * things -- the text and the parser -- so the key carries the text and the
   * tool's own fingerprint is checked when the cache is opened.
   */
  readonly parses?: Parses
  /**
   * The compiler's type facts, when the run resolved them. Generated by the
   * caller, not here, because a trace typechecks the whole program.
   */
  readonly types?: TypeIndex
}

/**
 * Read and index what tsgo sees, or the given paths, into the workspace every
 * rule reads.
 */
export const loadWorkspace = (
  root: string,
  inputs: ReadonlyArray<string>,
  input: WorkspaceInputs = {},
): Effect.Effect<Workspace, WorkspaceError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const parses = input.parses ?? noParses()
    const types = input.types ?? emptyTypeIndex
    const files =
      input.discovered ?? (yield* resolveInputs(root, inputs.length > 0 ? inputs : ["."])).files
    // Where the time went, in the same shape the report already uses for rules.
    // Adding this is how I learned that the parser was never the expensive part
    // and that two guesses about the bottleneck were both wrong.
    const phases: Array<{ phase: string; ms: number }> = []
    const mark = (phase: string, since: number, now: number): number => {
      phases.push({ phase, ms: now - since })
      return now
    }
    let clock = yield* Clock.currentTimeMillis
    const parsed: Array<SourceFile> = []
    const unparsed: Array<UnparsedFile> = []
    for (const absolute of files) {
      const preloaded = input.contents?.get(absolute)
      const text =
        preloaded ??
        (yield* fs.readFileString(absolute).pipe(
          Effect.mapError(
            (cause) => WorkspaceError.make({ path: absolute, operation: "readFileString", cause }),
          ),
        ))
      // Diagnostics carry paths relative to the root, so output is stable and
      // hosts such as GitHub Actions can annotate the right file.
      const relative = path.relative(root, absolute)
      const cached = parses.get(relative, text)
      if (cached !== undefined) {
        parsed.push(cached)
        continue
      }
      const outcome = parseSourceFile({ file: relative, text })
      if (outcome.ok) {
        parsed.push(outcome.file)
        parses.set(relative, text, outcome.file)
      } else {
        unparsed.push({ path: relative, reason: outcome.reason })
      }
    }
    clock = mark("read+parse", clock, yield* Clock.currentTimeMillis)
    const graph = buildImportGraph(parsed, path)
    clock = mark("import-graph", clock, yield* Clock.currentTimeMillis)
    // Resolution happens here, not at parse time, because it needs the whole
    // file set: a type name only means something once we know where it came from.
    // Edges indexed by the file that WRITES them.
    //
    // Resolving a type name used to scan the whole edge list once per type
    // reference, and the first loop it tried was `importersOf.get(file)` filtered
    // by `edge.importer === file` -- which only ever matches a file importing itself,
    // so it missed on every call and the second loop did all the work.
    //
    // On one repository that was 10,674 type references against 8,518 edges:
    // ninety million comparisons to answer a question each file already knew the
    // answer to. It was 4.4 seconds of a 4.6 second run, and I had assumed the
    // PARSER was the expensive part. It never was.
    const outward = new Map<string, Array<ImportEdge>>()
    for (const edge of graph.edges) {
      if (edge.resolution === "unresolved") continue
      const existing = outward.get(edge.importer)
      if (existing === undefined) outward.set(edge.importer, [edge])
      else existing.push(edge)
    }
    const resolveRef = (file: string, name: string): string => {
      for (const edge of outward.get(file) ?? []) {
        if (edge.names.includes(name)) return `${edge.to}#${name}`
      }
      return `${file}#${name}`
    }
    parsed.forEach((file) => {
      file.units.forEach((unit) => {
        // Calls made inside this declaration's span, in the order they are made,
        // resolved to the declaration they reach. `resolveRef` is the same
        // function the type pass uses: a name is a name, whether it appears in
        // type position or before a pair of parentheses.
        unit.calls = file.facts.callSites
          .filter((site) => site.start >= unit.start && site.end <= unit.end)
          .map((site) => resolveRef(file.path, site.name))
        unit.callSignature = unit.calls.join("|")
        // The types this declaration composes, resolved the same way. A field
        // set is only complete once `extends`/`&` bases are followed.
        unit.composed = unit.composed.map((base) => ({
          name: base.name,
          resolvedTo: resolveRef(file.path, base.name),
        }))
        unit.typeSignature = unit.typeRefs
          .map((name) => resolveRef(file.path, name))
          .sort(Order.String)
          .join("|")
        // The compiler's answer, keyed by the declaration's own line, with the
        // name as the fallback for the `const X` / `type X` pairs a trace puts
        // on one declaration and joggle's unit on the other.
        unit.typeFacts = types.at(unit.file, unit.location.line, unit.name)
      })
    })
    // Declarations from test files and from transpiler helpers are excluded
    // before any rule sees them, and counted, because a rule that silently
    // receives fewer candidates is a rule nobody can debug.
    // The nearest package.json above each directory an analysed file sits in.
    // Bounded to a few levels and cached per directory, so this is a handful of
    // reads rather than one per file.
    const manifests = new Map<string, PackageManifest>()
    const directories = [
      ...new Set(
        parsed.map((file) => {
          const cut = file.path.lastIndexOf("/")
          return cut === -1 ? "." : file.path.slice(0, cut)
        }),
      ),
    ]
    for (const directory of directories) {
      let cursor = directory
      // Bounded by the path itself rather than by a constant. Six levels is
      // nothing in a monorepo: a file eight directories deep sits above its own
      // manifest, and was grouped under a different name than its siblings.
      for (let depth = 0; depth <= directory.split("/").length + 1; depth += 1) {
        // The root has a manifest too, and it is the one that governs a file
        // sitting at the top of the repository. Breaking before reading it made
        // every dependency of `app.ts` and `index.ts` look undeclared.
        const manifest = yield* manifestAt(cursor === "." ? root : path.join(root, cursor))
        if (manifest !== undefined) {
          manifests.set(directory, manifest)
          break
        }
        const parent = cursor.includes("/") ? cursor.slice(0, cursor.lastIndexOf("/")) : "."
        if (parent === cursor || cursor === ".") break
        cursor = parent
      }
    }

    clock = mark("resolve-types", clock, yield* Clock.currentTimeMillis)
    const allUnits = parsed.flatMap((file) => file.units)
    // Helpers go; test declarations stay and are marked, because whether they
    // should be compared depends on what they are compared AGAINST.
    const units = allUnits.filter((unit) => !isCompilerHelper(unit.name))
    clock = mark("units+manifests", clock, yield* Clock.currentTimeMillis)
    const testDeclarations = units.filter((unit) => unit.test).length
    const excludedHelpers = allUnits.filter((unit) => isCompilerHelper(unit.name)).length
    const byName = new Map<string, Array<Unit>>()
    for (const unit of units) {
      const existing = byName.get(unit.name)
      if (existing === undefined) byName.set(unit.name, [unit])
      else existing.push(unit)
    }
    return {
      root,
      files: parsed,
      units,
      byName,
      imports: graph,
      phases,
      parses,
      unparsed,
      manifests,
      testDeclarations,
      excludedHelpers,
      types,
    }
  })
