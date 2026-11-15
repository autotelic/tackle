import { Clock, Effect, FileSystem, Option, Order, Path, Ref, Result, Schema, SchemaParser, Semaphore } from "effect"
import { canonical } from "./canonical.ts"
import { StoredAnswer } from "./plans.ts"

/**
 * The answer cache: one logical ledger, two on-disk layouts.
 *
 * An entry is a line of `<key>\t<unix-seconds>\t<json>`, sorted by key. The
 * key (`answerKeyFor`) already content-addresses the decision, the atoms it
 * read, the model and the decision version, so the line is the identity.
 *
 * **Single** (the default) is one file, `answers.jsonl`. It is the shape a
 * reviewer can read: a verdict change is one changed line in one diff. Sharding
 * bought merge granularity at a cost nobody was paying -- 130 shard files for 182
 * entries is a zero-reviewability commit, and git cannot ship the merge driver
 * that was supposed to make the shards safe.
 *
 * **Sharded** is `answers/<first two hex chars>.jsonl`, chosen explicitly when a
 * store is large enough that a whole-file rewrite or a merge is a real cost. It
 * uses git's built-in `merge=union`, which needs no per-machine registration.
 *
 * Both are read. The layout is decided by what is on disk, unless the caller
 * names one; `joggle cache migrate --layout` rewrites in the other shape. The
 * older `answers.json` object is read and consolidated into the single file on
 * the first write.
 */

const SHARD_CHARS = 2

/** How the ledger is stored. */
export type Layout = "single" | "sharded"

/** The shard a key belongs to: its first two characters, lower-cased. */
export const shardOf = (key: string): string => key.slice(0, SHARD_CHARS).toLowerCase().padEnd(SHARD_CHARS, "_")

/** The directory holding the shards, beside the single-file form. */
export const answersDir = (path: Path.Path, dir: string): string => path.join(dir, "answers")

/** The one-file ledger. */
export const answersFile = (path: Path.Path, dir: string): string => path.join(dir, "answers.jsonl")

/** The older pretty-printed object, still read. */
const answersObject = (path: Path.Path, dir: string): string => path.join(dir, "answers.json")

/**
 * The attributes joggle manages for the cache directory itself.
 *
 * Git reads a `.gitattributes` in a subdirectory and applies its patterns
 * relative to that directory, so joggle owns the treatment of its own files
 * without touching the repository's top-level file.
 *
 * `merge=union` rather than a custom driver: git cannot ship a merge driver in
 * `.gitattributes`, so `merge=joggle-answers` only worked on a machine where
 * somebody registered it by hand -- and a fresh clone silently got the default
 * merge instead. Union needs no registration and is correct for an append-only,
 * key-sorted JSONL.
 *
 * No `-diff` and no `linguist-generated`: the ledger's justification is that a
 * maintainer reviewed the verdicts, and those attributes made it a binary blob
 * that GitHub collapses. A verdict change should be one visible line.
 */
const ATTRIBUTES =
  "answers.jsonl merge=union\n" + "answers/*.jsonl merge=union\n" + "answers.json merge=union\n"

/**
 * Banners earlier versions wrote.
 *
 * Rewritten in place because each is byte-identical to what joggle generated, so
 * this is a migration rather than an edit of a file a person may have changed.
 * Any other content is left alone.
 */
const LEGACY_ATTRIBUTES = [
  "answers/*.jsonl merge=joggle-answers linguist-generated -diff\n" +
    "answers.json linguist-generated -diff\n",
  "answers/*.jsonl merge=union\n" + "answers.json merge=union\n",
]

/** One entry: the key, when it was written, and the answer. */
export interface Entry {
  readonly key: string
  /** Unix seconds, for `cache prune --max-age`. */
  readonly writtenAt: number
  readonly answer: StoredAnswer
}

/** The shape of the older single object, read once and consolidated. */
const AnswersObject = Schema.Struct({
  version: Schema.String,
  entries: Schema.Record(Schema.String, StoredAnswer),
})

const decodeAnswer = Schema.fromJsonString(StoredAnswer)

/**
 * One line: `<key>\t<unix-seconds>\t<json>`. A tab cannot appear unescaped in
 * any of the three fields, so the split is unambiguous.
 */
export const renderEntry = (entry: Entry): string =>
  entry.key + "\t" + entry.writtenAt + "\t" + canonical(entry.answer)

/** What a file held, and how many lines were not an entry. */
export interface ParsedShard {
  readonly entries: ReadonlyArray<Entry>
  /** Lines that did not decode, so a caller can see what it ignored. */
  readonly skippedLines: number
}

/** Parse a ledger file. A line that does not decode is skipped and COUNTED, never fatal. */
export const parseLines = (text: string): ParsedShard => {
  const entries: Array<Entry> = []
  let skippedLines = 0
  for (const line of text.split("\n")) {
    if (line === "") continue
    const first = line.indexOf("\t")
    const second = line.indexOf("\t", first + 1)
    if (first < 0 || second < 0) {
      skippedLines += 1
      continue
    }
    const writtenAt = Number(line.slice(first + 1, second))
    const answer = Result.getOrUndefined(SchemaParser.decodeResult(decodeAnswer)(line.slice(second + 1)))
    if (answer === undefined || !Number.isFinite(writtenAt)) {
      skippedLines += 1
      continue
    }
    entries.push({ key: line.slice(0, first), writtenAt, answer })
  }
  return { entries, skippedLines }
}

const byKey: Order.Order<Entry> = Order.mapInput(Order.String, (entry: Entry) => entry.key)

/** A file body: entries sorted by key, newline-terminated. */
export const renderShard = (entries: Iterable<Entry>): string => {
  const sorted = [...entries].sort(byKey)
  return sorted.length === 0 ? "" : sorted.map(renderEntry).join("\n") + "\n"
}

/**
 * Union two sides of one file by key.
 *
 * A key that only one side carries is kept. A key both sides carry with
 * different content keeps the newer timestamp: for a content-addressed key the
 * two answers should be identical, and the timestamp is the only signal that
 * says which the model produced last. Ties keep ours.
 */
export const mergeEntries = ({
  ours,
  theirs,
}: {
  readonly ours: ReadonlyArray<Entry>
  readonly theirs: ReadonlyArray<Entry>
}): ReadonlyArray<Entry> => {
  const merged = new Map<string, Entry>()
  for (const entry of ours) merged.set(entry.key, entry)
  for (const entry of theirs) {
    const existing = merged.get(entry.key)
    if (existing === undefined || entry.writtenAt > existing.writtenAt) merged.set(entry.key, entry)
  }
  return [...merged.values()]
}

/**
 * A side of a merge that is not a ledger file at all.
 *
 * A tagged error rather than `Option.none`, because the reason is the whole
 * value: "ours" or "theirs" is what the driver prints and what a person acts on.
 */
export class NotAShard extends Schema.TaggedError<
  NotAShard,
  { readonly brand: unique symbol }
>()("joggle/NotAShard", {
  side: Schema.String,
}) {}

/**
 * A merge of one file, failing when a non-empty side is not a ledger at all.
 *
 * Failing is how the driver declines: git then records an ordinary conflict,
 * which is recoverable, instead of a union that silently dropped lines. Every
 * line is either present or not, and a content-addressed key means the two sides
 * cannot substantively disagree, so there is no base to consult.
 */
export const mergeShardText = (text: {
  readonly ours: string
  readonly theirs: string
}): Effect.Effect<string, NotAShard> =>
  Effect.gen(function* () {
    const ourEntries = parseLines(text.ours).entries
    const theirEntries = parseLines(text.theirs).entries
    if (text.ours.trim() !== "" && ourEntries.length === 0) return yield* NotAShard.make({ side: "ours" })
    if (text.theirs.trim() !== "" && theirEntries.length === 0) {
      return yield* NotAShard.make({ side: "theirs" })
    }
    return renderShard(mergeEntries({ ours: ourEntries, theirs: theirEntries }))
  })

/* -------------------------------------------------------------------------- */
/* Reading and writing both layouts                                            */
/* -------------------------------------------------------------------------- */

const readText = (fs: FileSystem.FileSystem, file: string): Effect.Effect<string> =>
  fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))

const exists = (fs: FileSystem.FileSystem, file: string): Effect.Effect<boolean> =>
  fs.exists(file).pipe(Effect.orElseSucceed(() => false))

const seconds = (millis: number): number => Math.floor(millis / 1000)

const bytesOf = (text: string): number => new TextEncoder().encode(text).length

interface Loaded {
  readonly entries: ReadonlyMap<string, Entry>
  readonly layout: Layout
  /** Files the ledger lives in: one for the single layout, one per non-empty shard. */
  readonly files: number
  readonly bytes: number
  readonly skippedLines: number
}

/**
 * Read every form into one map, newest timestamp winning a shared key.
 *
 * The layouts are not mutually exclusive on disk: a repository that migrated
 * may still carry the old file after a crash, and reading both is how that
 * degrades to the union rather than to whichever the walk hit first.
 */
const loadAll = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
): Effect.Effect<Loaded> =>
  Effect.gen(function* () {
    const now = seconds(yield* Clock.currentTimeMillis)
    const merged = new Map<string, Entry>()
    const absorb = (entry: Entry): void => {
      const existing = merged.get(entry.key)
      if (existing === undefined || entry.writtenAt > existing.writtenAt) merged.set(entry.key, entry)
    }
    let files = 0
    let bytes = 0
    let skippedLines = 0

    const older = answersObject(path, dir)
    if (yield* exists(fs, older)) {
      const text = yield* readText(fs, older)
      const decoded = Result.getOrUndefined(SchemaParser.decodeResult(Schema.fromJsonString(AnswersObject))(text))
      if (decoded !== undefined) {
        files += 1
        bytes += bytesOf(text)
        for (const [key, answer] of Object.entries(decoded.entries)) absorb({ key, writtenAt: now, answer })
      }
    }

    const single = answersFile(path, dir)
    const singleExists = yield* exists(fs, single)
    if (singleExists) {
      const text = yield* readText(fs, single)
      const parsed = parseLines(text)
      files += 1
      bytes += bytesOf(text)
      skippedLines += parsed.skippedLines
      for (const entry of parsed.entries) absorb(entry)
    }

    const target = answersDir(path, dir)
    const names = yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => []))
    let shards = 0
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue
      const text = yield* readText(fs, path.join(target, name))
      const parsed = parseLines(text)
      if (text === "") continue
      shards += 1
      files += 1
      bytes += bytesOf(text)
      skippedLines += parsed.skippedLines
      for (const entry of parsed.entries) absorb(entry)
    }

    // Sharded wins when both exist: it is the form a migration finishes by
    // writing, so a half-finished single-to-sharded run reads as sharded.
    return {
      entries: merged,
      layout: shards > 0 ? "sharded" : "single",
      files,
      bytes,
      skippedLines,
    }
  })

const writeAttributes = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const attributes = path.join(dir, ".gitattributes")
    if (!(yield* exists(fs, attributes))) {
      yield* fs.writeFileString(attributes, ATTRIBUTES).pipe(Effect.orElseSucceed(() => undefined))
      return
    }
    const current = yield* readText(fs, attributes)
    if (LEGACY_ATTRIBUTES.includes(current)) {
      yield* fs.writeFileString(attributes, ATTRIBUTES).pipe(Effect.orElseSucceed(() => undefined))
    }
  })

const removeQuietly = (fs: FileSystem.FileSystem, file: string): Effect.Effect<void> =>
  fs.remove(file).pipe(Effect.orElseSucceed(() => undefined))

/**
 * Write the whole ledger in one layout, and remove the other form.
 *
 * A full write is what migration and pruning do; the store's own `put` writes
 * only what changed. Removing the other form first would lose it on a crash, so
 * the new form is written first and the old one removed after.
 */
const writeAll = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  layout: Layout,
  entries: ReadonlyMap<string, Entry>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* writeAttributes(fs, path, dir)
    const target = answersDir(path, dir)
    if (layout === "single") {
      yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
      const file = answersFile(path, dir)
      if (entries.size === 0) {
        yield* removeQuietly(fs, file)
      } else {
        yield* fs.writeFileString(file, renderShard(entries.values())).pipe(Effect.orElseSucceed(() => undefined))
      }
      const names = yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => []))
      for (const name of names) {
        if (name.endsWith(".jsonl")) yield* removeQuietly(fs, path.join(target, name))
      }
      yield* removeQuietly(fs, answersObject(path, dir))
      return
    }

    const grouped = new Map<string, Array<Entry>>()
    for (const entry of entries.values()) {
      const shard = shardOf(entry.key)
      const list = grouped.get(shard) ?? []
      list.push(entry)
      grouped.set(shard, list)
    }
    yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
    for (const [shard, list] of grouped) {
      yield* fs
        .writeFileString(path.join(target, shard + ".jsonl"), renderShard(list))
        .pipe(Effect.orElseSucceed(() => undefined))
    }
    const names = yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => []))
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue
      if (!grouped.has(name.slice(0, -".jsonl".length))) yield* removeQuietly(fs, path.join(target, name))
    }
    yield* removeQuietly(fs, answersFile(path, dir))
    yield* removeQuietly(fs, answersObject(path, dir))
  })

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

/** The write side of the cache, as the judged layer consumes it. */
export interface Store {
  readonly get: (key: string) => Effect.Effect<Option.Option<StoredAnswer>>
  readonly put: (key: string, answer: StoredAnswer) => Effect.Effect<void>
  readonly size: Effect.Effect<number>
  /** Rewrite the ledger in `layout`, and remove the other form. Returns the count. */
  readonly migrate: (layout?: Layout) => Effect.Effect<number>
  /** The layout this store writes in. */
  readonly layout: Layout
}

export interface StoreOptions {
  /** The layout to write; absent means "whatever is already on disk". */
  readonly layout?: Layout | undefined
}

/**
 * Open the store, and write in the layout the repository already uses unless the
 * caller names one.
 *
 * One writer at a time: concurrent decisions finish together, and a single-file
 * layout rewrites the whole ledger on a `put`, so letting two flushes interleave
 * would lose one. A sharded flush writes only the shards whose keys changed.
 */
export const make = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  options: StoreOptions = {},
): Effect.Effect<Store> =>
  Effect.gen(function* () {
    const loaded = yield* loadAll(fs, path, dir)
    const chosen: Layout = options.layout ?? loaded.layout
    const entries = yield* Ref.make(loaded.entries)
    const dirty = yield* Ref.make<ReadonlySet<string>>(new Set())
    const layoutRef = yield* Ref.make<Layout>(chosen)
    const fullWrite = yield* Ref.make(loaded.layout !== chosen)
    const writer = yield* Semaphore.make(1)

    const flush = writer.withPermits(1)(
      Effect.gen(function* () {
        const changed = yield* Ref.getAndSet(dirty, new Set<string>())
        const current = yield* Ref.get(entries)
        const layout = yield* Ref.get(layoutRef)
        const rewrite = yield* Ref.getAndSet(fullWrite, false)
        if (rewrite || layout === "single") {
          yield* writeAll(fs, path, dir, layout, current)
          return
        }
        yield* writeAttributes(fs, path, dir)
        const target = answersDir(path, dir)
        yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
        const shards = new Set([...changed].map(shardOf))
        for (const shard of shards) {
          const list = [...current.values()].filter((entry) => shardOf(entry.key) === shard)
          const file = path.join(target, shard + ".jsonl")
          if (list.length === 0) yield* removeQuietly(fs, file)
          else yield* fs.writeFileString(file, renderShard(list)).pipe(Effect.orElseSucceed(() => undefined))
        }
      }),
    )

    return {
      get: (key) => Effect.map(Ref.get(entries), (current) => Option.fromUndefinedOr(current.get(key)?.answer)),
      put: (key, answer) =>
        Effect.gen(function* () {
          const entry: Entry = { key, writtenAt: seconds(yield* Clock.currentTimeMillis), answer }
          yield* Ref.update(entries, (current) => new Map(current).set(key, entry))
          yield* Ref.update(dirty, (current) => new Set(current).add(key))
          yield* flush
        }),
      size: Effect.map(Ref.get(entries), (current) => current.size),
      layout: chosen,
      migrate: (layout) =>
        Effect.gen(function* () {
          const target = layout ?? (yield* Ref.get(layoutRef))
          yield* Ref.set(layoutRef, target)
          yield* Ref.set(fullWrite, true)
          yield* flush
          return (yield* Ref.get(entries)).size
        }),
    }
  })

/* -------------------------------------------------------------------------- */
/* Pruning and the census                                                      */
/* -------------------------------------------------------------------------- */

export interface PruneOptions {
  /** Drop entries written more than this many seconds ago. */
  readonly olderThanSeconds?: number | undefined
  /** After the age cut, drop oldest-first until the store is at or under this. */
  readonly maxBytes?: number | undefined
  /** Seconds since the epoch, so the cut is testable. Defaults to now. */
  readonly now?: number | undefined
}

export interface PruneResult {
  readonly removed: number
  readonly kept: number
  readonly bytes: number
}

const sizeOf = (entry: Entry): number => renderEntry(entry).length + 1

/** What the committed ledger says, rendered for a reader rather than replayed. */
export interface Census {
  readonly entries: number
  /** Files the ledger lives in: one for the single layout, one per non-empty shard. */
  readonly files: number
  readonly layout: Layout
  readonly bytes: number
  readonly skippedLines: number
  /** Entries by stored answer kind: Rate, Classify, Probability. */
  readonly kinds: ReadonlyArray<{ readonly kind: string; readonly count: number }>
  /** For Probability answers: the yes/no split at 0.5. */
  readonly verdicts: { readonly yes: number; readonly no: number }
  /** For Classify/Rate answers: the labels, most common first. */
  readonly labels: ReadonlyArray<{ readonly label: string; readonly count: number }>
  readonly oldest: number | undefined
  readonly newest: number | undefined
}

/**
 * Read the ledger and count what is in it.
 *
 * The keys are content hashes, so there is no rule name to group by: a verdict
 * cannot be attributed to a question after the fact. What IS visible is the
 * verdict distribution and the labels a classified answer chose, which is what a
 * reviewer opening a batch of new lines actually wants.
 */
export const census = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
): Effect.Effect<Census> =>
  Effect.gen(function* () {
    const loaded = yield* loadAll(fs, path, dir)
    const kinds = new Map<string, number>()
    const labels = new Map<string, number>()
    let yes = 0
    let no = 0
    let oldest: number | undefined
    let newest: number | undefined
    for (const entry of loaded.entries.values()) {
      oldest = oldest === undefined ? entry.writtenAt : Math.min(oldest, entry.writtenAt)
      newest = newest === undefined ? entry.writtenAt : Math.max(newest, entry.writtenAt)
      kinds.set(entry.answer.kind, (kinds.get(entry.answer.kind) ?? 0) + 1)
      if (entry.answer.kind === "Probability") {
        if (entry.answer.probability >= 0.5) yes += 1
        else no += 1
      } else {
        labels.set(entry.answer.label, (labels.get(entry.answer.label) ?? 0) + 1)
      }
    }
    return {
      entries: loaded.entries.size,
      files: loaded.files,
      layout: loaded.layout,
      bytes: loaded.bytes,
      skippedLines: loaded.skippedLines,
      kinds: [...kinds.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([kind, count]) => ({ kind, count })),
      verdicts: { yes, no },
      labels: [...labels.entries()]
        .sort(([left, leftCount], [right, rightCount]) => rightCount - leftCount || left.localeCompare(right))
        .map(([label, count]) => ({ label, count })),
      oldest,
      newest,
    }
  })

/**
 * Drop cache entries and rewrite only the file or shards that changed.
 *
 * The age cut is per entry, from the timestamp each line carries. The size cut
 * is oldest-first across the whole ledger. An emptied file or shard is deleted
 * rather than written empty.
 */
export const prune = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  dir: string,
  options: PruneOptions = {},
): Effect.Effect<PruneResult> =>
  Effect.gen(function* () {
    const now = options.now ?? seconds(yield* Clock.currentTimeMillis)
    const cutoff = options.olderThanSeconds === undefined ? undefined : now - options.olderThanSeconds
    const loaded = yield* loadAll(fs, path, dir)
    const kept = new Map<string, Entry>()
    let removed = 0
    for (const entry of loaded.entries.values()) {
      if (cutoff !== undefined && entry.writtenAt < cutoff) {
        removed += 1
        continue
      }
      kept.set(entry.key, entry)
    }

    if (options.maxBytes !== undefined) {
      let total = 0
      for (const entry of kept.values()) total += sizeOf(entry)
      if (total > options.maxBytes) {
        // A total order: oldest first, ties by key, so the result does not
        // depend on directory iteration.
        const ordered = [...kept.values()].sort((left, right) => left.writtenAt - right.writtenAt || byKey(left, right))
        for (const entry of ordered) {
          if (total <= options.maxBytes) break
          kept.delete(entry.key)
          removed += 1
          total -= sizeOf(entry)
        }
      }
    }

    // Writing only when something changed keeps a no-op prune from touching the
    // ledger's bytes (and therefore its diff).
    if (removed > 0) yield* writeAll(fs, path, dir, loaded.layout, kept)

    let bytes = 0
    for (const entry of kept.values()) bytes += sizeOf(entry)
    return { removed, kept: kept.size, bytes }
  })
