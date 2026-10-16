import { Effect, FileSystem, Path, Result, Schema, SchemaParser } from "effect"
import { shortHash } from "./state.ts"
import { shinglesOf } from "./similarity.ts"
import { ParsedImport } from "./imports.ts"
import { SourceLocation } from "./schema.ts"
import {
  StructureFacts,
  tokenize,
  UnitKind,
  type FileText,
  type Parses,
  type SourceFile,
  type Unit,
} from "./workspace.ts"

/**
 * Parsing, as a cached unit of work keyed by its inputs.
 *
 * The idea is from a talk about Turbopack's incremental engine (docs/turbo.md):
 * every expensive operation becomes a cached unit whose key is derived from what
 * it reads, because "I don't really trust developers to write correct cache keys
 * or track inputs by hand".
 *
 * The measurement that justifies it: on one repository the whole-run fingerprint
 * meant any change at all re-parsed 2,456 files, and `read+parse` was 2.3 of the
 * 2.4 seconds the workspace took. A one-line edit cost 2.3 seconds to answer a
 * question about one file.
 *
 * A parse reads exactly two things -- the text of the file and the parser -- so
 * the key is exactly those two. The text comes from the call site, which already
 * has it; the parser is the tool's own fingerprint, checked when the cache is
 * opened. There is no third thing a parse could depend on.
 *
 * WHAT IS STORED, AND WHAT IS NOT. Only the ANALYSIS: the units, their imports
 * and the file's structural facts. Not the file's text, which the caller already
 * has in memory; not a unit's text, which is a slice of it; not a unit's tokens,
 * which are a function of its shape; and not its shingles, which are a function
 * of its tokens. The first version stored all of it and produced a 67 megabyte
 * cache for 2,456 files -- most of it the same bytes said four different ways.
 *
 * WHAT THIS DOES NOT DO. It is not a reactive graph. Turbopack tracks which cell
 * read which and propagates invalidation upward with early cutoff; this is one
 * layer of that idea, at the point where 96% of the time is. A dependency graph
 * over eight thousand units would cost more to maintain than it saves at this
 * size, and the talk is honest about the overheads -- memory, and "global
 * algorithms harm incrementality" -- that such a system brings with it.
 */
export const CACHE_VERSION = "10"

/** One parse's key: which file, and what it said. */
export const keyOf = ({ file, text }: FileText): string =>
  file + "\u0000" + shortHash(text)

/** A unit minus everything derivable from the file's text. */
const encodeUnit = (unit: Unit): typeof EncodedUnit.Type => ({
  kind: unit.kind,
  name: unit.name,
  start: unit.start,
  end: unit.end,
  location: unit.location,
  exported: unit.exported,
  shape: unit.shape,
  shapeHash: unit.shapeHash,
  typeRefs: unit.typeRefs,
  typed: unit.typed,
  fieldTypes: Object.fromEntries(unit.fieldTypes),
  bases: unit.composed.map((base) => base.name),
  test: unit.test,
  ...(unit.doc === undefined ? {} : { doc: unit.doc }),
})

const encodeSourceFile = (file: SourceFile): typeof EncodedFile.Type => ({
  units: file.units.map(encodeUnit),
  imports: file.importStatements,
  facts: file.facts,
})

/**
 * A cached parse: the analysis, and nothing the file's text can give back.
 *
 * One Schema for the whole file rather than hand-written checks, because this is
 * genuinely external. It is a file on disk that can be truncated by an interrupted
 * write, edited by hand, or left over from a different tool -- so it is worth
 * DECODING rather than casting, and every type here is derived from the decoder
 * instead of declared beside it.
 *
 * The AST is not treated this way, and the reason is measured rather than
 * assumed: decoding one node costs 213ns against 3ns for a typeof check, a factor
 * of 73, and joggle walks millions of nodes per run. oxc produced that AST in this
 * process and `parseSync` has a type for it, so validating it would be validating
 * our own output at 73 times the price.
 */
const EncodedUnit = Schema.Struct({
  kind: UnitKind,
  name: Schema.String,
  start: Schema.Number,
  end: Schema.Number,
  location: SourceLocation,
  exported: Schema.Boolean,
  shape: Schema.String,
  shapeHash: Schema.String,
  typeRefs: Schema.Array(Schema.String),
  typed: Schema.Boolean,
  fieldTypes: Schema.Record(Schema.String, Schema.String),
  // Absent in caches written before composition was recorded; the version bump
  // rebuilds them, and this keeps a stale entry decodable rather than an issue.
  bases: Schema.optionalKey(Schema.Array(Schema.String)),
  test: Schema.Boolean,
  doc: Schema.optionalKey(Schema.String),
})

const EncodedFile = Schema.Struct({
  units: Schema.Array(EncodedUnit),
  imports: Schema.Array(ParsedImport),
  facts: StructureFacts,
})

const CacheFile = Schema.Struct({
  version: Schema.String,
  tool: Schema.String,
  entries: Schema.Record(Schema.String, EncodedFile),
})

/**
 * The decoder, chosen so that a failure is RECORDED.
 *
 * `decodeUnknownResult` returns the schema issue as data rather than throwing it
 * away, which is the part that matters: a cache that has quietly stopped working
 * used to look exactly like a cold one, forever.
 */
const decodeCache = SchemaParser.decodeUnknownResult(Schema.fromJsonString(CacheFile))

/**
 * A unit, rebuilt from a decoded entry and the text the caller already has.
 *
 * The text is a slice of the file, and the tokens and shingles are functions of
 * the shape, so none of the three are stored -- which is most of why the cache is
 * 12 megabytes rather than 67.
 *
 * A span that does not fit the file it claims to come from is a corrupt entry, and
 * a corrupt entry is a miss.
 */
const unitFrom = (
  entry: typeof EncodedUnit.Type,
  source: FileText,
): Unit | undefined => {
  const { file, text } = source
  // A span that does not fit the file it claims to come from is a corrupt entry,
  // and a corrupt entry is a miss.
  if (entry.start < 0 || entry.start > entry.end || entry.end > text.length) return undefined
  const tokens = tokenize(entry.shape)
  return {
    kind: entry.kind,
    name: entry.name,
    file,
    start: entry.start,
    end: entry.end,
    location: entry.location,
    exported: entry.exported,
    text: text.slice(entry.start, entry.end),
    shape: entry.shape,
    tokens,
    shingles: shinglesOf(tokens),
    shapeHash: entry.shapeHash,
    typeRefs: entry.typeRefs,
    typed: entry.typed,
    fieldTypes: new Map(Object.entries(entry.fieldTypes)),
    composed: (entry.bases ?? []).map((name) => ({ name, resolvedTo: "" })),
    test: entry.test,
    // Three fields the resolution pass fills in, so none is stored: the calls a
    // declaration makes depend on the whole file set, exactly as its resolved
    // types do.
    typeSignature: "",
    // Filled by the resolution pass once the whole file set is known, exactly as
    // the calls and the resolved type names are, so it is not stored.
    typeFacts: undefined,
    calls: [],
    callSignature: "",
    doc: entry.doc,
  }
}

/** A whole file's parse, or undefined when any unit of it is unusable. */
const sourceFileFrom = (
  entry: typeof EncodedFile.Type,
  source: FileText,
): SourceFile | undefined => {
  const units: Array<Unit> = []
  for (const raw of entry.units) {
    const unit = unitFrom(raw, source)
    if (unit === undefined) return undefined
    units.push(unit)
  }
  return {
    path: source.file,
    text: source.text,
    units,
    importStatements: entry.imports,
    facts: entry.facts,
  }
}

export interface ParseCache {
  readonly parses: Parses
  /** Why each cache file failed to decode. Reported, because silence looks cold. */
  readonly issues: ReadonlyArray<string>
  readonly save: Effect.Effect<void, never, FileSystem.FileSystem | Path.Path>
}

/** The cache directory and the tool fingerprint that keys it. */
interface ParseCacheScope {
  readonly cacheDir: string
  readonly tool: string
}

/**
 * The cache on disk, discarded whole when the tool's own source has changed.
 *
 * The parser is part of the tool, so an entry produced by a different parser is
 * not a cache hit -- it is a wrong answer. That is the same reasoning as the run
 * manifest, applied to the operation that dominates the run.
 */
export const loadParses = ({ cacheDir, tool }: ParseCacheScope): Effect.Effect<ParseCache, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const store = path.join(cacheDir, "parses.json")

    // The map holds the ENCODED form, so saving serializes what is already there
    // rather than walking every unit a second time to write it out.
    const issues: Array<string> = []
    const entries = new Map<string, typeof EncodedFile.Type>()
    const exists = yield* Effect.orElseSucceed(fs.exists(store), () => false)
    if (exists) {
      const body = yield* Effect.orElseSucceed(fs.readFileString(store), () => "")
      // One decode for the whole file. A cache from a different tool version is
      // discarded whole rather than repaired: the parser is part of the tool, so
      // an entry it did not produce is a wrong answer, not a slow one.
      const decoded = decodeCache(body)
      if (Result.isFailure(decoded)) {
        // An empty or absent cache is not damage; a file that will not parse is.
        if (body.trim() !== "") issues.push("the cache file did not match the expected shape")
      } else if (decoded.success.version === CACHE_VERSION && decoded.success.tool === tool) {
        // A version or tool mismatch is not damage either: the cache is discarded
        // whole and rebuilt, which is what an upgrade is supposed to do.
        for (const [key, value] of Object.entries(decoded.success.entries)) entries.set(key, value)
      }
    }

    let hits = 0
    let misses = 0
    const parses: Parses = {
      get: (relative, text) => {
        const stored = entries.get(keyOf({ file: relative, text }))
        // Decoded against the text the CALLER has, which is the whole reason the
        // text is not in the cache: it is already here.
        const rebuilt =
          stored === undefined ? undefined : sourceFileFrom(stored, { file: relative, text })
        if (rebuilt === undefined) {
          misses += 1
          return undefined
        }
        hits += 1
        return rebuilt
      },
      set: (relative, text, parsed) => {
        entries.set(keyOf({ file: relative, text }), encodeSourceFile(parsed))
      },
      hits: () => hits,
      misses: () => misses,
    }

    return {
      parses,
      issues,
      // Only when something was parsed. A run that read twenty thousand entries
      // and wrote them all back is a run where the cache costs more than it saves.
      save: Effect.gen(function* () {
        if (misses === 0) return
        const body = JSON.stringify({
          version: CACHE_VERSION,
          tool,
          entries: Object.fromEntries(entries),
        })
        yield* Effect.orElseSucceed(fs.makeDirectory(cacheDir, { recursive: true }), () => undefined)
        yield* Effect.orElseSucceed(fs.writeFileString(store, body), () => undefined)
      }),
    }
  })
