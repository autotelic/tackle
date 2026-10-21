import { createHash } from "node:crypto"
import { isDeepStrictEqual } from "node:util"
import { Effect, FileSystem, Path } from "effect"
import { decodeMenu, isRecord, parseJson, str, type Catalog, type Menu } from "@autotelic/protocol"

/*
 * `cutlist build --check`, the staleness gate — `oxfmt --check` / `prettier --check` for
 * the vocabulary.
 *
 * The reason it must exist is a property of the lint half: `plumb-ui` fails OPEN on a
 * malformed or stale manifest (a bad catalog decodes to empty, and every tier rule goes
 * quiet). A silently disabled rule is worse than a failing one, so the gate makes a
 * catalog that drifted from the tree loud, and CI fails until someone commits the fresh
 * one.
 *
 * The gate compares content, never bytes: the catalog by its own hash, the menu by its
 * decoded model. Formatting is `oxfmt`'s business and must never be able to fail this.
 */

export interface StalenessResult {
  readonly stale: boolean
  readonly committed: string | undefined
  readonly fresh: string
}

/** Compare the committed catalog's hash against a freshly computed one. */
export const compareCatalog = ({
  file,
  fresh,
}: {
  readonly file: string
  readonly fresh: Catalog
}): Effect.Effect<StalenessResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => undefined)
    if (text === undefined) return { stale: true, committed: undefined, fresh: fresh.hash }
    // `parseJson` is the protocol's boundary reader: it answers `undefined` on malformed
    // input, so the decode is not a `try/catch` inside the Effect generator.
    const decoded = parseJson(text)
    const committed = isRecord(decoded) ? str(decoded.hash) : undefined
    return { stale: committed !== fresh.hash, committed, fresh: fresh.hash }
  })

const digestOf = (text: string): string => createHash("sha256").update(text).digest("hex")

/**
 * Compare a committed `menu.json` against the fresh menu, by model rather than by bytes.
 *
 * The menu is generated as plain JSON and then formatted by `oxfmt`, so bytes would report
 * a stale file every time the formatter touched an array. Decoding both sides and comparing
 * the records keeps the gate about content — the same reason the catalog is checked by its
 * own `hash` rather than by a diff.
 */
export const compareMenu = ({
  file,
  fresh,
}: {
  readonly file: string
  readonly fresh: Menu
}): Effect.Effect<StalenessResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => undefined)
    if (text === undefined) return { stale: true, committed: undefined, fresh: fresh.hash }
    const committed = decodeMenu(parseJson(text))
    if (committed === undefined) return { stale: true, committed: undefined, fresh: fresh.hash }
    return {
      stale: !isDeepStrictEqual(committed, fresh),
      committed: digestOf(JSON.stringify(committed)),
      fresh: digestOf(JSON.stringify(fresh)),
    }
  })

/**
 * Compare a committed JSON rendering against the fresh model.
 *
 * `patterns.json` and `recipes.json` are pretty-printed and then formatted by `oxfmt`, so
 * bytes would report a stale file after every formatter run. Decoding and deep-comparing the
 * model keeps the gate about content, the same reason `menu.json` is compared by its model.
 * A file that cannot be parsed is stale, never clean.
 */
export const compareJson = ({
  file,
  fresh,
}: {
  readonly file: string
  readonly fresh: unknown
}): Effect.Effect<StalenessResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => undefined)
    if (text === undefined)
      return { stale: true, committed: undefined, fresh: digestOf(JSON.stringify(fresh)) }
    const committed = parseJson(text)
    if (committed === undefined)
      return { stale: true, committed: undefined, fresh: digestOf(JSON.stringify(fresh)) }
    return {
      stale: !isDeepStrictEqual(committed, fresh),
      committed: digestOf(JSON.stringify(committed)),
      fresh: digestOf(JSON.stringify(fresh)),
    }
  })

/**
 * Compare a committed rendering against the fresh one, by bytes.
 *
 * `MENU.md` is a generator-canonical rendering — the renderer ends it the way `oxfmt`
 * would — so a difference means content moved, not formatting. A file that is missing is
 * stale, never "fine because unreadable".
 */
export const compareText = ({
  file,
  fresh,
}: {
  readonly file: string
  readonly fresh: string
}): Effect.Effect<StalenessResult, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const committed = yield* Effect.orElseSucceed(fs.readFileString(file), () => undefined)
    const freshHash = digestOf(fresh)
    if (committed === undefined) return { stale: true, committed: undefined, fresh: freshHash }
    return { stale: committed !== fresh, committed: digestOf(committed), fresh: freshHash }
  })
