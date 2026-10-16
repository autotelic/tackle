import { Effect, FileSystem, Order, Path } from "effect"
import { shortHash } from "./state.ts"

/*
 * A hash of the tool's own source, which is the version nobody has to remember.
 *
 * `policy.analysisVersion` is a hand-bumped string, and a hand-bumped string is a
 * promise to remember. Forgetting it means the next run replays a report produced
 * by rules that no longer exist -- which happened twice in one session, and both
 * times the output looked entirely plausible, because a stale report is not
 * malformed, it is just wrong.
 *
 * So the version is not maintained by hand. The tool hashes its own sources
 * and puts that hash in the run manifest, and a change to a rule, a threshold or a
 * question cannot be missed because it cannot be omitted. `analysisVersion`
 * survives as the fallback for when the sources cannot be read, and as the
 * deliberate override for when a change is meant NOT to invalidate a run -- a
 * refactor, say, that provably cannot alter output.
 *
 * The cost is one pass over the tool's own source per run, which is a couple of
 * dozen small files, and it is paid once per run rather than once per file.
 */

/**
 * Where this module lives, which is the directory to hash.
 *
 * Read from the module's own URL so it follows the tool wherever it is installed:
 * `src/` when run from source, `dist/` from a published package. Undefined when
 * the runtime does not expose it, in which case the declared version is used.
 */
const sourceDirectory = (): string | undefined => {
  const here = import.meta.dirname
  return here.length > 0 ? here : undefined
}

/**
 * Sources are hashed, not the whole directory: a stray `.joggle` cache or a
 * `node_modules` under the tool's own folder is not part of the tool.
 */
const isSource = (name: string): boolean => name.endsWith(".ts") || name.endsWith(".js")

/**
 * Hash this tool's own source, so a rule or threshold change cannot be
 * forgotten. `declared` is the fallback for a build that ships no source.
 */
export const sourceFingerprint = (
  declared: string,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const directory = sourceDirectory()
    if (directory === undefined) return declared

    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    // Any failure here is a fallback, never an error: a run that cannot read its
    // own source still has the declared version and still produces a report.
    const names = yield* Effect.orElseSucceed(
      fs.readDirectory(directory, { recursive: true }),
      () => [],
    )
    const sources = names.filter(isSource).sort(Order.String)
    if (sources.length === 0) return declared

    const parts: Array<string> = []
    for (const name of sources) {
      const text = yield* Effect.orElseSucceed(fs.readFileString(path.join(directory, name)), () => "")
      parts.push(name + "\u0000" + text)
    }
    // Sorted by name, and the name is inside the hash, so a rename is a change.
    return shortHash(parts.join("\u0001"))
  })
