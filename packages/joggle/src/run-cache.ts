import { Effect, FileSystem, Path, Result, Schema, SchemaParser } from "effect"
import { policy } from "./policy.ts"
import { shortHash } from "./state.ts"
import { Baseline, StoredRun } from "./schema.ts"

// The persisted side of a run: the manifest that decides whether to replay, and
// the last run and baseline that are read back. Its own module because it is a
// boundary: every file here can be absent, truncated, or left over from another
// version, so every read decodes with a Schema and every failure is a miss.

/**
 * Everything the output depends on, as one hash.
 *
 * Analysis version, decision version, model, the rule set, the root, and the
 * content of every analysed file. If this is unchanged then the previous report
 * is the report -- no parsing, no candidate generation, and no tokens.
 *
 * @param root - The analysed root.
 * @param files - Every analysed file, root-relative or absolute.
 * @param contents - The text of each file.
 * @param ruleIds - The rule set that ran.
 * @param toolFingerprint - The tool's own source hash.
 * @returns The manifest hash.
 */
export const manifestOf = (
  root: string,
  files: ReadonlyArray<string>,
  contents: ReadonlyMap<string, string>,
  ruleIds: ReadonlyArray<string>,
  toolFingerprint: string,
): string =>
  shortHash(
    [
      // The tool's own source, so a rule change cannot be forgotten. The declared
      // version stays beside it as the documented fallback.
      `tool=${toolFingerprint}`,
      `analysis=${policy.analysisVersion}`,
      `decisions=${policy.decisionVersion}`,
      `model=${policy.model}`,
      `root=${root}`,
      `rules=${[...ruleIds].sort((left, right) => left.localeCompare(right)).join(",")}`,
      `files=${files.length}`,
      ...files.map((file) => `${file}\u0000${shortHash(contents.get(file) ?? "")}`),
    ].join("\n"),
  )

const runPath = (path: Path.Path, cacheDir: string): string => path.join(cacheDir, "last-run.json")

/** The baseline is the file the config names, resolved by the caller. */
export const baselinePath = (_path: Path.Path, file: string): string => file

/**
 * Reads the stored run, or nothing when it is absent or unreadable.
 *
 * @param fs - The file system to read from.
 * @param path - The path service.
 * @param cacheDir - The directory holding `last-run.json`.
 * @returns The decoded run, or `undefined` for a miss.
 */
export const readStored = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cacheDir: string,
): Effect.Effect<StoredRun | undefined> =>
  Effect.gen(function* () {
    const file = runPath(path, cacheDir)
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return undefined
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    if (text.trim() === "") return undefined
    return Result.getOrUndefined(SchemaParser.decodeResult(Schema.fromJsonString(StoredRun))(text))
  })

/**
 * Writes the run, so the next one can replay it.
 *
 * @param fs - The file system to write to.
 * @param path - The path service.
 * @param cacheDir - The directory holding `last-run.json`.
 * @param run - The run to store.
 */
export const writeStored = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cacheDir: string,
  run: StoredRun,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* Effect.orElseSucceed(fs.makeDirectory(cacheDir, { recursive: true }), () => undefined)
    yield* Effect.orElseSucceed(
      fs.writeFileString(runPath(path, cacheDir), JSON.stringify(run, null, 2)),
      () => undefined,
    )
  })

/** One accepted finding: the fragment a baseline directory holds. */
const Fragment = Schema.Struct({ identity: Schema.String })

/**
 * Reads the accepted findings, or nothing when there is no baseline.
 *
 * A baseline is a directory of fragments -- one file per accepted finding, the
 * changesets/towncrier shape -- or, for a repository written before that shape
 * existed, the single JSON file. Which one it is comes from the filesystem, so
 * both are read without the caller saying which.
 *
 * @param fs - The file system to read from.
 * @param path - The path service.
 * @param target - The baseline directory, or the single file.
 * @returns The accepted identities, or `undefined` for a miss.
 */
export const readBaseline = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  target: string,
): Effect.Effect<ReadonlySet<string> | undefined> =>
  Effect.gen(function* () {
    const info = yield* fs.stat(target).pipe(Effect.orElseSucceed(() => undefined))
    if (info === undefined) return undefined

    if (info.type === "Directory") {
      const names = yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => []))
      const identities = new Set<string>()
      for (const name of names) {
        if (!name.endsWith(".json")) continue
        const text = yield* fs.readFileString(path.join(target, name)).pipe(Effect.orElseSucceed(() => ""))
        const decoded = Result.getOrUndefined(SchemaParser.decodeResult(Schema.fromJsonString(Fragment))(text))
        if (decoded !== undefined) identities.add(decoded.identity)
      }
      return identities.size === 0 ? undefined : identities
    }

    const text = yield* fs.readFileString(target).pipe(Effect.orElseSucceed(() => ""))
    const decoded = Result.getOrUndefined(SchemaParser.decodeResult(Schema.fromJsonString(Baseline))(text))
    return decoded === undefined ? undefined : new Set(decoded.identities)
  })

/**
 * Writes the accepted findings as the new baseline.
 *
 * A target ending in `.json` is the single file and is written as one. A target
 * that is not is a directory of fragments: one file per identity, named by the
 * identity's hash, so two branches that accept different findings never touch
 * the same file. A fragment no longer in the set is removed, so the directory is
 * the whole baseline and not a log of every acceptance.
 *
 * @param fs - The file system to write to.
 * @param path - The path service.
 * @param target - The baseline directory, or a `.json` file for the old shape.
 * @param identities - The finding identities to accept.
 */
export const writeBaseline = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  target: string,
  identities: ReadonlyArray<string>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    if (target.endsWith(".json")) {
      const parent = path.dirname(target)
      yield* Effect.orElseSucceed(fs.makeDirectory(parent, { recursive: true }), () => undefined)
      const body = JSON.stringify(
        { version: policy.version, identities: [...identities].sort((left, right) => left.localeCompare(right)) },
        null,
        2,
      )
      yield* Effect.orElseSucceed(fs.writeFileString(target, body), () => undefined)
      return
    }

    yield* Effect.orElseSucceed(fs.makeDirectory(target, { recursive: true }), () => undefined)
    const desired = new Map<string, string>()
    for (const identity of identities) desired.set(shortHash(identity) + ".json", identity)
    const present = new Set(yield* fs.readDirectory(target).pipe(Effect.orElseSucceed(() => [])))
    for (const [name, identity] of desired) {
      if (!present.has(name)) {
        yield* Effect.orElseSucceed(
          fs.writeFileString(path.join(target, name), JSON.stringify({ identity }, null, 2) + "\n"),
          () => undefined,
        )
      }
      present.delete(name)
    }
    // What is left is an acceptance the run no longer makes: delete the file.
    for (const name of present) {
      if (!name.endsWith(".json")) continue
      yield* Effect.orElseSucceed(fs.remove(path.join(target, name)), () => undefined)
    }
  })
