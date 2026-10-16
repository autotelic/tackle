import { Effect, FileSystem, Path, Result, Schema, SchemaParser } from "effect"

/**
 * The package.json in one directory, if it names the package.
 *
 * Read from the filesystem rather than declared, for the same reason .gitignore
 * is: it is already current, because whoever made the package wrote it. A name
 * and a description are the two fields that say what a package IS.
 *
 * Its own module rather than a corner of the workspace, because it is a boundary:
 * the file is external input, so it is decoded with a Schema instead of cast, and
 * the decode belongs next to the schema it uses.
 */
export interface PackageManifest {
  readonly name: string
  readonly summary: string | undefined
  /**
   * What the package declares that it depends on.
   *
   * The field that cannot be vacuous, and the reason `description` was not
   * enough. `"fasdentify core package"` says nothing; `"dependencies": {
   * "fastify": "^4" }` says everything. A package that declares a dependency has
   * already answered whether importing it is intended, so the question never
   * needs asking -- a fact, not a judgement.
   */
  readonly declares: ReadonlyArray<string>
}

const PackageManifestJson = Schema.Struct({
  name: Schema.NonEmptyString,
  description: Schema.optionalKey(Schema.String),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

/**
 * Reads and decodes the `package.json` in one directory.
 *
 * @param directory - The directory to read `package.json` from.
 * @returns The decoded manifest, or `undefined` when the file is absent or does
 *   not name the package.
 */
export const manifestAt = (
  directory: string,
): Effect.Effect<PackageManifest | undefined, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const file = path.join(directory, "package.json")
    const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    if (!exists) return undefined
    const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
    const decoded = Result.getOrUndefined(
      SchemaParser.decodeResult(Schema.fromJsonString(PackageManifestJson))(text),
    )
    if (decoded === undefined) return undefined
    // Every kind of dependency, because the question this answers is "has the
    // package declared it?" and a devDependency is a declaration. Restricting
    // this to runtime dependencies flagged `chai` and `@faker-js/faker` as
    // undeclared imports, which they are not -- the distinction between runtime
    // and development belongs to the judgement about whether an import FITS, and
    // that is the model's question, not this one's.
    const declares: Array<string> = []
    for (const field of ["dependencies", "peerDependencies", "devDependencies"] as const) {
      declares.push(...Object.keys(decoded[field] ?? {}))
    }
    return {
      name: decoded.name,
      summary: decoded.description,
      declares,
    }
  })
