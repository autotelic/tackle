import { Effect, FileSystem, Path, Result, Schema, SchemaParser, type Predicate } from "effect"
import { tsconfigEntry } from "./glob.ts"

/*
 * The root tsconfig's `include` and `exclude`, for files the compiler cannot list.
 *
 * tsgo applies them to every file it lists; an `.astro` file found by walking
 * has to be held to the same scope, or a run reads what the project excluded.
 * Only the root file is read: `extends` is not followed, and a tsconfig that is
 * not plain JSON scopes nothing out rather than guessing.
 */

const TsconfigScope = Schema.Struct({
  include: Schema.optionalKey(Schema.Array(Schema.String)),
  exclude: Schema.optionalKey(Schema.Array(Schema.String)),
})

const decodeTsconfig = SchemaParser.decodeUnknownResult(Schema.fromJsonString(TsconfigScope))

const everything: Predicate.Predicate<string> = () => true

/** Whether a root-relative, `/`-separated path is in the project the root tsconfig describes. */
export const tsconfigScope = (
  root: string,
): Effect.Effect<Predicate.Predicate<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const body = yield* Effect.orElseSucceed(fs.readFileString(path.join(root, "tsconfig.json")), () => undefined)
    if (body === undefined) return everything
    const decoded = Result.getOrUndefined(decodeTsconfig(body))
    if (decoded === undefined) return everything
    const include = (decoded.include ?? []).map(tsconfigEntry)
    const exclude = (decoded.exclude ?? []).map(tsconfigEntry)
    return (file) =>
      (include.length === 0 || include.some((matches) => matches(file))) &&
      !exclude.some((matches) => matches(file))
  })
