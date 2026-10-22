import { Effect, FileSystem, Path, Predicate, Result, Schema, SchemaParser } from "effect"
import { stripJsonc } from "./jsonc.ts"

/**
 * The content mappers a project declares, read from its tsconfig chain.
 *
 * TypeScript 7.1 lets a project register a package that turns a foreign file
 * (`.vue`, `.svelte`, `.mdx`) into virtual TypeScript. The compiler then needs
 * `--runExternalCode`, because a mapper is an arbitrary process. joggle does not
 * run mappers on its own: it reports what a project declared and what it could
 * index, so a run cannot claim to have looked at a file it never read.
 *
 * `extends` is followed for the same reason: a shared base config is where a
 * monorepo puts the mapper, and reading only the leaf would report "none" for a
 * project that has three.
 */
const ContentMapper = Schema.Struct({
  package: Schema.String,
  extensions: Schema.Array(Schema.String),
})

const Tsconfig = Schema.Struct({
  extends: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String)])),
  contentMappers: Schema.optionalKey(Schema.Array(ContentMapper)),
})

const decode = SchemaParser.decodeUnknownResult(Schema.fromJsonString(Tsconfig))

/** One mapper package and the extensions it claims. */
export interface ContentMapperEntry {
  readonly package: string
  readonly extensions: ReadonlyArray<string>
}

/** The `extends` entries that name a file rather than a package. */
const baseFiles = (value: string | ReadonlyArray<string> | undefined): ReadonlyArray<string> =>
  value === undefined ? [] : Predicate.isString(value) ? [value] : value

/**
 * Read one tsconfig, then its bases, collecting extension → package.
 *
 * A package `extends` (`@acme/tsconfig`) is not resolved: joggle does not read
 * node_modules to answer a question about this project's own configuration, and
 * a mapper declared only there is outside what this scan can see.
 */
const readChain = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  file: string,
  seen: Set<string>,
  into: Map<string, string>,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    const absolute = path.resolve(file)
    if (seen.has(absolute)) return
    seen.add(absolute)
    const text = yield* Effect.orElseSucceed(fs.readFileString(absolute), () => undefined)
    if (text === undefined) return
    const decoded = Result.getOrUndefined(decode(stripJsonc(text)))
    if (decoded === undefined) return
    for (const base of baseFiles(decoded.extends)) {
      if (!base.startsWith(".") && !base.startsWith("/")) continue
      const candidate = path.resolve(path.dirname(absolute), base)
      const named = candidate.endsWith(".json") ? candidate : candidate + ".json"
      const exists = yield* Effect.orElseSucceed(fs.exists(named), () => false)
      yield* readChain(fs, path, exists ? named : candidate, seen, into)
    }
    // The leaf wins: a project that extends a base and re-registers an
    // extension is saying which mapper this project means.
    for (const mapper of decoded.contentMappers ?? []) {
      for (const extension of mapper.extensions) into.set(extension, mapper.package)
    }
  })

/**
 * The content mappers this project declares, merged along its tsconfig chain.
 *
 * @param root - The project root.
 * @returns one entry per mapper package, with the extensions it won.
 */
export const contentMappersOf = (
  root: string,
): Effect.Effect<ReadonlyArray<ContentMapperEntry>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const into = new Map<string, string>()
    yield* readChain(fs, path, path.join(root, "tsconfig.json"), new Set(), into)
    const byPackage = new Map<string, Array<string>>()
    for (const [extension, packageName] of into) {
      const found = byPackage.get(packageName) ?? []
      found.push(extension)
      byPackage.set(packageName, found)
    }
    return [...byPackage.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packageName, extensions]) => ({
        package: packageName,
        extensions: [...extensions].sort((left, right) => left.localeCompare(right)),
      }))
  })
