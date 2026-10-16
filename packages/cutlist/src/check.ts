import { Effect, FileSystem, Path } from "effect"
import type { Catalog } from "@autotelic/protocol"

/*
 * `cutlist build --check`, the staleness gate — `oxfmt --check` / `prettier --check` for
 * the vocabulary.
 *
 * The reason it must exist is a property of the lint half: `plumb-ui` fails OPEN on a
 * malformed or stale manifest (a bad catalog decodes to empty, and every tier rule goes
 * quiet). A silently disabled rule is worse than a failing one, so the gate makes a
 * catalog that drifted from the tree loud, and CI fails until someone commits the fresh
 * one.
 */

export interface StalenessResult {
  readonly stale: boolean
  readonly committed: string | undefined
  readonly fresh: string
}

/** Compare the committed catalog's hash against a freshly computed one. */
export const compareCatalog = (
  file: string,
  fresh: Catalog,
): Effect.Effect<StalenessResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => undefined)
    if (text === undefined) return { stale: true, committed: undefined, fresh: fresh.hash }
    let committed: string | undefined
    try {
      const decoded = JSON.parse(text) as { hash?: unknown }
      committed = typeof decoded.hash === "string" ? decoded.hash : undefined
    } catch {
      committed = undefined
    }
    return { stale: committed !== fresh.hash, committed, fresh: fresh.hash }
  })
