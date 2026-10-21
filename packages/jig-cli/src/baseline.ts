import { Effect, FileSystem, Path } from "effect"
import { decodeBaseline, lexiconRef, parseJson, type Baseline } from "@autotelic/protocol"

/*
 * The baseline file, in the protocol's shape.
 *
 * It is committed to the repository, so the ratchet is a property of the code rather
 * than a cache somebody can clear. Read defensively — a corrupt baseline means "not
 * accepted yet", which fails safe — and write strictly, in one exact shape.
 *
 * The decode is protocol's, not a schema re-spelled here: the format owns its reader, and
 * two decoders would be two chances to drift.
 */

export const emptyBaseline: Baseline = { lexicon: lexiconRef("baseline"), identities: [] }

/** Read the committed baseline; a missing or malformed file is an empty one. */
export const readBaseline = (file: string): Effect.Effect<Baseline, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return emptyBaseline
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    return decodeBaseline(parseJson(text)) ?? emptyBaseline
  })

/** Write the baseline, creating its directory if needed. */
export const writeBaseline = (
  file: string,
  baseline: Baseline,
): Effect.Effect<void, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    yield* Effect.orElseSucceed(
      fs.makeDirectory(path.dirname(file), { recursive: true }),
      () => undefined,
    )
    yield* Effect.orElseSucceed(
      fs.writeFileString(file, `${JSON.stringify(baseline, null, 2)}\n`),
      () => undefined,
    )
  })
