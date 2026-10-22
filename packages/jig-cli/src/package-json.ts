import { Effect, FileSystem, Path, Result, Schema, SchemaParser } from "effect"

/**
 * The parts of `package.json` a scaffold reads.
 *
 * A generated config should know the package manager and the scripts the repo
 * already runs. It does not need the whole manifest, and a missing or malformed
 * one is an empty answer rather than a failure: `init` can still write a config
 * for a directory that is not a Node package yet.
 */
const Manifest = Schema.Struct({
  description: Schema.optionalKey(Schema.String),
  packageManager: Schema.optionalKey(Schema.String),
  scripts: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  dependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
  devDependencies: Schema.optionalKey(Schema.Record(Schema.String, Schema.String)),
})

const decode = SchemaParser.decodeUnknownResult(Schema.fromJsonString(Manifest))

/** What a scaffold reads from a package manifest. */
export interface PackageManifest {
  readonly description: string | undefined
  readonly packageManager: string | undefined
  readonly scripts: Readonly<Record<string, string>>
  readonly dependencies: Readonly<Record<string, string>>
}

/** Read `package.json`, or an empty manifest when it is absent or malformed. */
export const packageJsonOf = (
  root: string,
): Effect.Effect<PackageManifest, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* Effect.orElseSucceed(
      fs.readFileString(path.join(root, "package.json")),
      () => "",
    )
    const decoded = Result.getOrUndefined(decode(text))
    return {
      description: decoded?.description,
      packageManager: decoded?.packageManager,
      scripts: decoded?.scripts ?? {},
      dependencies: Object.assign({}, decoded?.dependencies, decoded?.devDependencies),
    }
  })
