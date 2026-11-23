import { Option, Predicate, Schema } from "effect"
import { parse } from "yaml"

/** A repo's assertion about one resolved dependency; derived from the lockfile, never hand-written. */
export const RepoPinSchema = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  integrity: Schema.NullOr(Schema.String),
  importer: Schema.String,
  lockfile: Schema.Literal("pnpm-lock.yaml"),
})
export type RepoPin = typeof RepoPinSchema.Type

interface LockEntry {
  readonly version?: string
}
interface LockImporter {
  readonly dependencies?: Record<string, LockEntry>
  readonly devDependencies?: Record<string, LockEntry>
  readonly optionalDependencies?: Record<string, LockEntry>
}
interface LockPackage {
  readonly resolution?: { readonly integrity?: string }
}
interface Lockfile {
  readonly importers?: Record<string, LockImporter>
  readonly packages?: Record<string, LockPackage>
}

const GROUPS = ["dependencies", "devDependencies", "optionalDependencies"] as const

/** Derive the pin of one package from the lockfile; the first importer that names it wins. */
export const derivePin = (input: {
  readonly lockText: string
  readonly name: string
}): Option.Option<RepoPin> => {
  const lock: Lockfile = parse(input.lockText)
  for (const [importer, entry] of Object.entries(lock.importers ?? {})) {
    for (const group of GROUPS) {
      const dependency = entry[group]?.[input.name]
      if (dependency?.version === undefined) continue
      const version = dependency.version.replace(/\(.*\)$/u, "")
      const integrity = lock.packages?.[`${input.name}@${version}`]?.resolution?.integrity ?? null
      return Option.some({
        name: input.name,
        version,
        integrity,
        importer,
        lockfile: "pnpm-lock.yaml",
      })
    }
  }
  return Option.none()
}

/** The pin is a fact about the lockfile; a stored pin that differs is drift, not a preference. */
export const pinMatches: Predicate.Predicate<{
  readonly stored: RepoPin
  readonly derived: RepoPin
}> = (input) =>
  input.stored.name === input.derived.name &&
  input.stored.version === input.derived.version &&
  input.stored.integrity === input.derived.integrity &&
  input.stored.lockfile === input.derived.lockfile
