import { Effect, FileSystem, Path, Result, Schema, SchemaParser } from "effect"
import type { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { Service as Tsgo } from "./tsgo.ts"

/* -------------------------------------------------------------------------- */
/* Vocabulary                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * One resolved type, as `tsgo --generateTrace` describes it.
 *
 * The trace is a hack that works: it needs no fork and no patch, and the checker
 * writes it while it is already checking the program. What it carries is the
 * resolved type in the checker's own printed form, the flags the checker gave it,
 * the declaration it was attributed to, and the type arguments and union members
 * it was built from.
 *
 * What it does NOT carry is an object type's members. This was assumed otherwise
 * and measured false (2026-09, tsgo 7.0.0-dev.20260707.2): a NAMED interface or
 * type alias has no `display` at all -- `PersonSummary` is just a descriptor with
 * `flags: ["Object"]` and a symbol name -- and the trace records no property
 * list, so `PersonSummary.treesPlanted`'s resolved type cannot be read from it.
 * Only an ANONYMOUS object type gets a printed `display` --
 * `{ readonly id: String; readonly email: String }` -- which is why an object
 * literal's inferred type is readable and a declaration's fields are not.
 *
 * Type ALIASES are worse: `type ProjectRole = (typeof PROJECT_ROLES)[number]`
 * produced no entry attributed to `ProjectRole` at all. So a field-level
 * resolved type is simply not in the trace, and `field-type-drift` cannot be
 * made trace-based. What would answer it is a checker host that calls
 * `getTypeAtLocation` on the property -- `docs/type-resolution.md`.
 */
export const TypeFact = Schema.Struct({
  /**
   * The checker's printed form of the resolved type. Empty when the checker had
   * nothing to print, which is itself a fact about the declaration.
   */
  display: Schema.String,
  /** The symbol the checker resolved, when it named one. */
  symbol: Schema.String,
  /** The checker's flags: `Object`, `Union`, `Any`, `Conditional`, ... */
  flags: Schema.Array(Schema.String),
  /** Resolved type arguments, printed, in declaration order. */
  arguments: Schema.Array(Schema.String),
  /** Resolved union members, printed, in the checker's order. */
  members: Schema.Array(Schema.String),
  /**
   * Where the CHECKER says the type was declared, root-relative.
   *
   * This is not always the declaration joggle is looking at: an alias resolves
   * to the type it aliases, and the trace attributes the type to the aliased
   * declaration. That difference is the useful part -- it is the join from a
   * name to its meaning that text cannot make.
   */
  origin: Schema.Struct({ file: Schema.String, line: Schema.Number }),
})

export interface TypeFact extends Schema.Schema.Type<typeof TypeFact> {}

/**
 * The resolved types, keyed by where they were declared.
 *
 * A lookup is by declaration site first, then by symbol name in the same file,
 * because the trace attributes a type to its first declaration and a declaration
 * pair like `const Severity = ...` plus `type Severity = ...` puts the type on
 * the first and joggle's unit on the second.
 */
export interface TypeIndex {
  /** The type the checker resolved for the declaration here, or undefined. */
  readonly at: (file: string, line: number, name?: string) => TypeFact | undefined
  /** How many declaration sites resolved to a type. */
  readonly sites: number
}

/** No types were resolved, for a caller that ran without a trace. */
export const emptyTypeIndex: TypeIndex = {
  at: () => undefined,
  sites: 0,
}

/* -------------------------------------------------------------------------- */
/* The trace document                                                          */
/* -------------------------------------------------------------------------- */

/**
 * The shape of one entry in a `types_N.json` file.
 *
 * Read with guards rather than a Schema decoder on purpose: a full decode of
 * 65,000 descriptors per file costs far more than the lookup it enables, and the
 * file is produced by a program this process just ran. Damage is still recorded
 * -- a file that will not parse is an issue, not a silent cold start -- but the
 * common path is a `JSON.parse` and a handful of `typeof` checks.
 */
interface RawType {
  readonly id: number
  readonly display: string
  readonly symbol: string
  readonly flags: ReadonlyArray<string>
  /** The type arguments, alias arguments included, in the order the trace wrote them. */
  readonly arguments: ReadonlyArray<number>
  readonly unionTypes: ReadonlyArray<number>
  readonly declaration: { readonly file: string; readonly line: number } | undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const stringsOf = (value: unknown): ReadonlyArray<string> =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []

const numbersOf = (value: unknown): ReadonlyArray<number> =>
  Array.isArray(value) ? value.filter((item): item is number => typeof item === "number") : []

const declarationOf = (value: unknown): { file: string; line: number } | undefined => {
  if (!isRecord(value)) return undefined
  const file = value["path"]
  const start = value["start"]
  if (typeof file !== "string" || !isRecord(start)) return undefined
  const line = start["line"]
  return typeof line === "number" ? { file, line } : undefined
}

const rawOf = (value: unknown): RawType | undefined => {
  if (!isRecord(value)) return undefined
  const id = value["id"]
  if (typeof id !== "number") return undefined
  const display = value["display"]
  const intrinsic = value["intrinsicName"]
  const symbol = value["symbolName"]
  return {
    id,
    display: typeof display === "string" ? display : typeof intrinsic === "string" ? intrinsic : "",
    symbol: typeof symbol === "string" ? symbol : "",
    flags: stringsOf(value["flags"]),
    arguments: [...numbersOf(value["typeArguments"]), ...numbersOf(value["aliasTypeArguments"])],
    unionTypes: numbersOf(value["unionTypes"]),
    declaration: declarationOf(value["firstDeclaration"]),
  }
}

/* -------------------------------------------------------------------------- */
/* Parsing                                                                     */
/* -------------------------------------------------------------------------- */

/** One resolved declaration, before it becomes an index. */
export interface TypeEntry {
  readonly file: string
  readonly line: number
  readonly name: string
  readonly fact: TypeFact
}

/**
 * A function from a trace path to a root-relative path, or undefined when the
 * file sits outside the root.
 *
 * Curried rather than taking the root and the file as two adjacent strings: a
 * swapped call would compile and produce a path of the wrong shape, which is
 * exactly the class of bug the trace reader exists to avoid.
 */
const relativeTo = (root: string) => (file: string): string | undefined => {
  const normalizedRoot = root.split("\\").join("/").replace(/\/+$/, "")
  const normalized = file.split("\\").join("/")
  if (!normalized.toLowerCase().startsWith(normalizedRoot.toLowerCase() + "/")) return undefined
  return normalized.slice(normalizedRoot.length + 1)
}

/** The most informative fact for one declaration: the longest printed type wins. */
const better = (left: TypeFact, right: TypeFact): TypeFact =>
  right.display.length > left.display.length ? right : left

/**
 * Turn the parsed `types_N.json` documents into entries, one per declaration.
 *
 * Each document is one checker, and type ids are only meaningful inside the
 * document that defines them, so the arguments and union members are resolved
 * against the same document and the results are merged by declaration site. The
 * checkers agree about a declaration; when they do not, the longest printed type
 * is kept, because a short print is a partial view and a long one is not.
 */
export const parseTrace = (
  root: string,
  documents: ReadonlyArray<ReadonlyArray<unknown>>,
): ReadonlyArray<TypeEntry> => {
  const bySite = new Map<string, TypeEntry>()
  const byName = new Map<string, TypeEntry>()
  const relative = relativeTo(root)

  const insert = (site: Map<string, TypeEntry>, key: string, entry: TypeEntry): void => {
    const existing = site.get(key)
    site.set(key, existing === undefined ? entry : { ...entry, fact: better(existing.fact, entry.fact) })
  }

  for (const document of documents) {
    const byId = new Map<number, RawType>()
    for (const value of document) {
      const raw = rawOf(value)
      if (raw !== undefined) byId.set(raw.id, raw)
    }
    const printed = (id: number): string => {
      const target = byId.get(id)
      if (target === undefined) return ""
      return target.display !== "" ? target.display : target.symbol
    }
    for (const raw of byId.values()) {
      if (raw.declaration === undefined) continue
      const file = relative(raw.declaration.file)
      if (file === undefined) continue
      const fact: TypeFact = {
        display: raw.display,
        symbol: raw.symbol,
        flags: raw.flags,
        arguments: raw.arguments.slice(0, 8).map(printed),
        members: raw.unionTypes.slice(0, 16).map(printed),
        origin: { file, line: raw.declaration.line },
      }
      const entry: TypeEntry = { file, line: raw.declaration.line, name: raw.symbol, fact }
      insert(bySite, file.toLowerCase() + "\u0000" + raw.declaration.line, entry)
      if (raw.symbol !== "") insert(byName, file.toLowerCase() + "\u0000" + raw.symbol, entry)
    }
  }

  return [...bySite.values()]
}

/** Build the lookup from parsed entries. */
export const indexOf = (entries: ReadonlyArray<TypeEntry>): TypeIndex => {
  const bySite = new Map<string, TypeFact>()
  const byName = new Map<string, TypeFact>()
  for (const entry of entries) {
    const siteKey = entry.file.toLowerCase() + "\u0000" + entry.line
    const site = bySite.get(siteKey)
    bySite.set(siteKey, site === undefined ? entry.fact : better(site, entry.fact))
    if (entry.name === "") continue
    const nameKey = entry.file.toLowerCase() + "\u0000" + entry.name
    const named = byName.get(nameKey)
    byName.set(nameKey, named === undefined ? entry.fact : better(named, entry.fact))
  }
  return {
    sites: bySite.size,
    at: (file, line, name) => {
      const key = file.toLowerCase() + "\u0000"
      return bySite.get(key + line) ?? (name === undefined ? undefined : byName.get(key + name))
    },
  }
}

/* -------------------------------------------------------------------------- */
/* Reading and caching                                                         */
/* -------------------------------------------------------------------------- */

const TRACE_VERSION = "1"

const CachedEntry = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  name: Schema.String,
  fact: TypeFact,
})

const CachedIndex = Schema.Struct({
  version: Schema.String,
  tool: Schema.String,
  manifest: Schema.String,
  entries: Schema.Array(CachedEntry),
})

const decodeCache = SchemaParser.decodeUnknownResult(Schema.fromJsonString(CachedIndex))

/**
 * Parse JSON at the boundary, recording the failure instead of throwing it past
 * the typed channel. A trace file that will not parse is an issue, and an issue
 * is a fact the run reports rather than a defect that escapes it.
 */
const parseJson = (text: string): Effect.Effect<unknown, never> =>
  Effect.try(() => JSON.parse(text)).pipe(Effect.orElseSucceed(() => undefined))

/** The paths the legend names, one per checker. */
const legendPaths = (parsed: unknown): ReadonlyArray<string> => {
  if (!Array.isArray(parsed)) return []
  return parsed.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const typesPath = entry["typesPath"]
    return typeof typesPath === "string" ? [typesPath] : []
  })
}

export interface LoadedTypes {
  readonly index: TypeIndex
  /** Why a cache file or a trace document could not be read. Reported, not hidden. */
  readonly issues: ReadonlyArray<string>
  readonly loadedFrom: "cache" | "trace"
}

/**
 * Where a type trace is read from, and the tool fingerprint that keys it.
 */
export interface TypeFactRequest {
  readonly root: string
  readonly cacheDir: string
  readonly tool: string
  readonly manifest: string
}

/**
 * Resolve the declarations to their types, from the cache or from a fresh trace.
 *
 * The cache key is the same manifest the run already computed plus the tool
 * fingerprint, because a trace depends on the whole program: the compiler
 * version, the tsconfig, and every file it checked. The manifest is content, not
 * mtimes, so a trace is reused exactly when the code it describes is unchanged.
 */
export const loadTypeFacts = (input: TypeFactRequest): Effect.Effect<
  LoadedTypes,
  never,
  Tsgo | FileSystem.FileSystem | Path.Path | ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const issues: Array<string> = []
    const store = path.join(input.cacheDir, "types.json")

    const exists = yield* Effect.orElseSucceed(fs.exists(store), () => false)
    if (exists) {
      const body = yield* Effect.orElseSucceed(fs.readFileString(store), () => "")
      const decoded = decodeCache(body)
      if (Result.isSuccess(decoded)) {
        const cached = decoded.success
        if (
          cached.version === TRACE_VERSION &&
          cached.tool === input.tool &&
          cached.manifest === input.manifest
        ) {
          return {
            index: indexOf(cached.entries),
            issues,
            loadedFrom: "cache" as const,
          }
        }
      } else if (body.trim() !== "") {
        issues.push("the type cache did not match the expected shape and was ignored")
      }
    }

    const documents: Array<ReadonlyArray<unknown>> = []
    yield* Effect.scoped(
      Effect.gen(function* () {
        const dir = yield* fs.makeTempDirectoryScoped({ directory: input.cacheDir })
        const tsgo = yield* Tsgo
        yield* tsgo.generateTrace(input.root, dir)
        const legend = yield* fs.readFileString(path.join(dir, "legend.json"))
        const paths = legendPaths(yield* parseJson(legend))
        if (paths.length === 0) issues.push("the trace legend named no type files")
        for (const typesPath of paths) {
          const body = yield* fs.readFileString(typesPath)
          const parsed = yield* parseJson(body)
          if (Array.isArray(parsed)) documents.push(parsed)
          else issues.push("a trace type file was not an array: " + typesPath)
        }
      }),
    ).pipe(
      Effect.catch((error) => {
        issues.push("the trace could not be generated: " + String(error))
        return Effect.void
      }),
    )

    const entries = parseTrace(input.root, documents)
    const index = indexOf(entries)
    if (entries.length > 0) {
      const body = JSON.stringify({
        version: TRACE_VERSION,
        tool: input.tool,
        manifest: input.manifest,
        entries,
      })
      yield* Effect.orElseSucceed(fs.makeDirectory(input.cacheDir, { recursive: true }), () => undefined)
      yield* Effect.orElseSucceed(fs.writeFileString(store, body), () => undefined)
    }
    return { index, issues, loadedFrom: "trace" as const }
  })
