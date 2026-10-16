import { Config, Effect, FileSystem, Option, Path } from "effect"
import { createHash } from "node:crypto"
import { homedir } from "node:os"

/*
 * Where joggle's state lives, and how it is read back.
 *
 * Three artifacts, three lifecycles:
 *
 *   <root>/.joggle/answers/     reviewed, committed, replayed by CI: sharded
 *   <root>/.joggle/baseline/    reviewed, committed: the ratchet, as fragments
 *   <machine cache>/joggle/<root>/   ephemeral, machine-local, never committed
 *
 * The first two belong to the repository, because they are decisions a person
 * should be able to read in a diff and because CI replays them with no API key.
 * Both are directories of small files -- one shard of answers, one fragment per
 * accepted finding -- so that two branches write different files rather than the
 * same one. The third is a performance artifact -- a manifest, the last report,
 * and the per-file facts -- and it belongs to the machine: it is the largest, it
 * churns on every edit, and writing it into a working tree means analysing
 * someone else's checkout leaves litter in it. `docs/artifacts.md` is the long
 * form.
 *
 * One machine cache serves every repository, keyed by the analysed root, so
 * pointing joggle at any number of checkouts costs no per-repo setup and writes
 * nothing into them.
 */

/** A short content hash, used for cache keys and manifests. */
export const shortHash = (value: string): string =>
  createHash("sha1").update(value).digest("hex").slice(0, 16)

/** The per-machine cache root, following the platform's convention. */
export const machineCacheRoot: Effect.Effect<string> = Effect.gen(function* () {
  // A host such as pi can run with no HOME. Fall back to the passwd database,
  // never to ".", because a relative root puts the cache inside the analysed
  // repository -- the one place this file exists to keep it out of.
  const home = yield* Config.String("HOME").pipe(Effect.orElseSucceed(() => homedir()))
  const xdg = yield* Config.option(Config.String("XDG_CACHE_HOME")).pipe(
    Effect.orElseSucceed(() => Option.none<string>()),
  )
  const root = Option.getOrUndefined(xdg)
  if (root !== undefined && root !== "") return root
  return process.platform === "darwin" ? `${home}/Library/Caches` : `${home}/.cache`
}).pipe(Effect.orElseSucceed(() => homedir()))

/** A machine-local directory for one analysed root. */
export const runCacheDirFor = (root: string): Effect.Effect<string> =>
  Effect.map(machineCacheRoot, (base) => `${base}/joggle/${shortHash(root)}`)

/**
 * Where a run's answer cache goes.
 *
 * Explicit wins. Otherwise a repository that already has a `.joggle/` is one
 * being onboarded -- its cache is a committed artifact and that is where it
 * lives -- and any other checkout is one being visited, so the cache is
 * machine-local and nothing is written into it. This is the rule the pi
 * extension has always applied; the CLI applies it too, so the two agree and a
 * tool run never litters a checkout it does not own.
 *
 * @param cwd - The analysed root.
 * @param explicit - The value of `--cache-dir`, if given.
 * @returns The directory holding `answers/`.
 */
export const cacheDirFor = (
  cwd: string,
  explicit: string | undefined,
): Effect.Effect<string, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    if (explicit !== undefined) return explicit
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const local = path.join(cwd, ".joggle")
    const onboarded = yield* fs.exists(local).pipe(Effect.orElseSucceed(() => false))
    return onboarded ? local : yield* runCacheDirFor(cwd)
  })
