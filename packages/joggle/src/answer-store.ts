import { Clock, Effect, FileSystem, Option, Order, Path, Ref, Result, Schema, SchemaParser, Semaphore } from "effect"
import { canonical } from "./canonical.ts"
import { StoredAnswer } from "./plans.ts"

/**
 * The answer cache, as a sharded content-addressed store.
 *
 * One file per shard, one entry per line, and the shard is a function of the
 * key alone. The key (`answerKeyFor`) already content-addresses the decision,
 * the atoms it read, the model and the decision version, so two branches that
 * judge different candidates write different shards -- or, when they collide on
 * a shard, different lines. That is the whole design: a merge is a directory
 * merge, and the residual collision is a same-line one, which the shipped merge
 * driver (`joggle merge-answers`) resolves by key.
 *
 * The shape is Bazel's: sharded content-addressed storage, written
 * deterministically (lines sorted by key) so a diff is the change and not the
 * reordering, JSONL rather than pretty-printed JSON so the file is line-oriented
 * and can merge at all. The prior art and the reasoning are in
 * `docs/artifacts.md`.
 *
 * The single `answers.json` written before the shard split is still read, and
 * the first write migrates it: every shard is written, then the old file is
 * removed. A reader that never writes leaves it alone.
 */

// How many leading hex characters name a shard. 256 files is enough granularity.
const SHARD_CHARS = 2

/** The shard a key belongs to: its first two characters, lower-cased. */
export const shardOf = (key: string): string => key.slice(0, SHARD_CHARS).toLowerCase().padEnd(SHARD_CHARS, "_")

/** The directory holding the shards, beside the single-file form. */
export const answersDir = (path: Path.Path, dir: string): string => path.join(dir, "answers")

const singleFile = (path: Path.Path, dir: string): string => path.join(dir, "answers.json")

/**
 * The attributes joggle manages for the cache directory itself.
 *
 * Git reads a `.gitattributes` in a subdirectory and applies its patterns
 * relative to that directory, so joggle can own the treatment of its own files
 * without touching the repository's top-level file. `-diff` keeps the shards out
 * of a diff (they are generated), `linguist-generated` keeps them out of GitHub
 * language stats, and `merge=joggle-answers` names the merge driver.
 */
const ATTRIBUTES =
  "answers/*.jsonl merge=joggle-answers linguist-generated -diff\n" +
  "answers.json linguist-generated -diff\n"

/** One entry: the key, when it was written, and the answer. */
export interface Entry {
  readonly key: string
  /** Unix seconds, for `cache prune --max-age`. */
  readonly writtenAt: number
  readonly answer: StoredAnswer
}

/** The shape of the single file, read once for the migration. */
const SingleFile = Schema.Struct({
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

/** What a shard held, and how many lines were not an entry. */
export interface ParsedShard {
  readonly entries: ReadonlyArray<Entry>
  /** Lines that did not decode, so a caller can see what it ignored. */
  readonly skippedLines: number
}

/** Parse a shard. A line that does not decode is skipped and COUNTED, never fatal. */
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

/** A shard body: entries sorted by key, newline-terminated. */
export const renderShard = (entries: Iterable<Entry>): string => {
  const sorted = [...entries].sort(byKey)
  return sorted.length === 0 ? "" : sorted.map(renderEntry).join("\n") + "\n"
}

/**
 * Union two sides of one shard by key.
 *
 * A key that only one side carries is kept. A key both sides carry with
 * different content keeps the newer timestamp: for a content-addressed key the
 * two answers should be identical, and the timestamp is the only signal that
 * says which the model produced last. Ties keep ours.
 */
export const mergeEntries = (
  ours: ReadonlyArray<Entry>,
  theirs: ReadonlyArray<Entry>,
): ReadonlyArray<Entry> => {
  const merged = new Map<string, Entry>()
  for (const entry of ours) merged.set(entry.key, entry)
  for (const entry of theirs) {
    const existing = merged.get(entry.key)
    if (existing === undefined || entry.writtenAt > existing.writtenAt) merged.set(entry.key, entry)
  }
  return [...merged.values()]
}

/**
 * A side of a merge that is not a shard at all.
 *
 * A tagged error rather than `Option.none`, because the reason is the whole
 * value: "ours" or "theirs" is what the driver prints and what a person acts on.
 */
export class NotAShard extends Schema.TaggedError<NotAShard>()("joggle/NotAShard", {
  side: Schema.String,
}) {}

/**
 * A merge of one shard, failing when a non-empty side is not a shard at all.
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
    return renderShard(mergeEntries(ourEntries, theirEntries))
  })

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

/** The write side of the cache, as the judged layer consumes it. */
export interface Store {
  readonly get: (key: string) => Effect.Effect<Option.Option<StoredAnswer>>
  readonly put: (key: string, answer: StoredAnswer) => Effect.Effect<void>
  readonly size: Effect.Effect<number>
  /** Rewrite every shard from memory, and remove the single file. Returns the count. */
  readonly migrate: Effect.Effect<number>
}

const readText = (fs: FileSystem.FileSystem, file: string): Effect.Effect<string> =>
  fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))

const exists = (fs: FileSystem.FileSystem, file: string): Effect.Effect<boolean> =>
  fs.exists(file).pipe(Effect.orElseSucceed(() => false))

const seconds = (millis: number): number => Math.floor(millis / 1000)

/** In memory the store is `shard -> key -> entry`, so a write touches one shard. */
type Shards = ReadonlyMap<string, ReadonlyMap<string, Entry>>

const add = (shards: Shards, entry: Entry): Shards => {
  const next = new Map(shards)
  const inner = new Map(next.get(shardOf(entry.key)) ?? [])
  inner.set(entry.key, entry)
  next.set(shardOf(entry.key), inner)
  return next
}

const count = (shards: Shards): number => {
  let total = 0
  for (const entries of shards.values()) total += entries.size
  return total
}

/**
 * Open the store: read the single file and every shard into memory, and keep the
 * dirty shards so a write is proportional to the change.
 *
 * Concurrent decisions finish at once and each writes; the permit keeps one
 * writer in the files at a time. Migration is the one full write: if the single
 * file was present, the first flush writes every shard before removing it, so a
 * crash in between leaves both and the sharded side wins on the next read.
 */
export const make = (fs: FileSystem.FileSystem, path: Path.Path, dir: string): Effect.Effect<Store> =>
  Effect.gen(function* () {
    const single = singleFile(path, dir)
    const migrating = yield* exists(fs, single)
    const now = seconds(yield* Clock.currentTimeMillis)

    let loaded: Shards = new Map()
    if (migrating) {
      const text = yield* readText(fs, single)
      const decoded = Result.getOrUndefined(SchemaParser.decodeResult(Schema.fromJsonString(SingleFile))(text))
      if (decoded !== undefined) {
        for (const [key, answer] of Object.entries(decoded.entries)) loaded = add(loaded, { key, writtenAt: now, answer })
      }
    }
    const shardNames = yield* fs.readDirectory(answersDir(path, dir)).pipe(Effect.orElseSucceed(() => []))
    for (const name of shardNames) {
      if (!name.endsWith(".jsonl")) continue
      const text = yield* readText(fs, path.join(answersDir(path, dir), name))
      // The sharded store is newer than the single file, so it wins on a key
      // both carry.
      for (const entry of parseLines(text).entries) loaded = add(loaded, entry)
    }

    const shards = yield* Ref.make(loaded)
    const dirty = yield* Ref.make<ReadonlySet<string>>(new Set())
    const needsMigration = yield* Ref.make(migrating)
    const writer = yield* Semaphore.make(1)

    const flush = writer.withPermits(1)(
      Effect.gen(function* () {
        // Taken and cleared in one step: a put that lands while this flush is
        // writing marks a fresh set, which its own flush then writes.
        const changed = yield* Ref.getAndSet(dirty, new Set<string>())
        const current = yield* Ref.get(shards)
        const migrate = yield* Ref.get(needsMigration)
        const targets = migrate ? [...current.keys()] : [...changed]
        const target = answersDir(path, dir)
        yield* fs.makeDirectory(target, { recursive: true }).pipe(Effect.orElseSucceed(() => undefined))
        const attributes = path.join(dir, ".gitattributes")
        if (!(yield* exists(fs, attributes))) {
          yield* fs.writeFileString(attributes, ATTRIBUTES).pipe(Effect.orElseSucceed(() => undefined))
        }
        for (const shard of targets) {
          const entries = current.get(shard)
          if (entries === undefined) continue
          yield* fs
            .writeFileString(path.join(target, shard + ".jsonl"), renderShard(entries.values()))
            .pipe(Effect.orElseSucceed(() => undefined))
        }
        if (migrate) {
          yield* fs.remove(single).pipe(Effect.orElseSucceed(() => undefined))
          yield* Ref.set(needsMigration, false)
        }
      }),
    )

    return {
      get: (key) =>
        Effect.map(Ref.get(shards), (current) => {
          const entry = current.get(shardOf(key))?.get(key)
          return entry === undefined ? Option.none() : Option.some(entry.answer)
        }),
      put: (key, answer) =>
        Effect.gen(function* () {
          const entry: Entry = { key, writtenAt: seconds(yield* Clock.currentTimeMillis), answer }
          yield* Ref.update(shards, (current) => add(current, entry))
          yield* Ref.update(dirty, (current) => {
            const next = new Set(current)
            next.add(shardOf(key))
            return next
          })
          yield* flush
        }),
      size: Effect.map(Ref.get(shards), count),
      migrate: Effect.gen(function* () {
        yield* Ref.set(needsMigration, true)
        yield* flush
        return count(yield* Ref.get(shards))
      }),
    }
  })

/* -------------------------------------------------------------------------- */
/* Pruning                                                                     */
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

/**
 * Drop cache entries and rewrite only the shards that changed.
 *
 * The age cut is per entry, from the timestamp each line carries. The size cut
 * is oldest-first across the whole store. A shard left empty is deleted rather
 * than written empty, so a pruned store is a smaller one, not one with the same
 * number of files.
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
    const target = answersDir(path, dir)

    const names = yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => []))
    const keptByShard = new Map<string, Array<Entry>>()
    const dropped: Array<{ readonly shard: string; readonly entry: Entry }> = []
    for (const name of names) {
      if (!name.endsWith(".jsonl")) continue
      const shard = name.slice(0, -".jsonl".length)
      const text = yield* readText(fs, path.join(target, name))
      for (const entry of parseLines(text).entries) {
        if (cutoff !== undefined && entry.writtenAt < cutoff) dropped.push({ shard, entry })
        else {
          const kept = keptByShard.get(shard) ?? []
          kept.push(entry)
          keptByShard.set(shard, kept)
        }
      }
    }

    if (options.maxBytes !== undefined) {
      let total = 0
      for (const entries of keptByShard.values()) for (const entry of entries) total += sizeOf(entry)
      if (total > options.maxBytes) {
        // A total order: oldest first, ties by key, so the result does not
        // depend on directory iteration.
        const ordered = [...keptByShard.values()].flat().sort(byKey)
        ordered.sort(Order.mapInput(Order.Number, (entry: Entry) => entry.writtenAt))
        const removedKeys = new Set<string>()
        for (const entry of ordered) {
          if (total <= options.maxBytes) break
          removedKeys.add(entry.key)
          dropped.push({ shard: shardOf(entry.key), entry })
          total -= sizeOf(entry)
        }
        for (const [shard, entries] of keptByShard) {
          keptByShard.set(
            shard,
            entries.filter((entry) => !removedKeys.has(entry.key)),
          )
        }
      }
    }

    const touched = new Set(dropped.map((entry) => entry.shard))
    for (const shard of touched) {
      const entries = keptByShard.get(shard) ?? []
      const file = path.join(target, shard + ".jsonl")
      if (entries.length === 0) {
        yield* fs.remove(file).pipe(Effect.orElseSucceed(() => undefined))
      } else {
        yield* fs.writeFileString(file, renderShard(entries)).pipe(Effect.orElseSucceed(() => undefined))
      }
    }

    let kept = 0
    let bytes = 0
    for (const entries of keptByShard.values()) {
      for (const entry of entries) {
        kept += 1
        bytes += sizeOf(entry)
      }
    }
    return { removed: dropped.length, kept, bytes }
  })
