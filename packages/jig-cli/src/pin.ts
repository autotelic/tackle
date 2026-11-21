import { parse } from "yaml"

/** A repo's assertion about one resolved dependency; derived from the lockfile, never hand-written. */
export interface RepoPin {
  readonly name: string
  readonly version: string
  readonly integrity: string | null
  readonly importer: string
  readonly lockfile: "pnpm-lock.yaml"
}

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
export const derivePin = (lockText: string, name: string): RepoPin | undefined => {
  const lock = parse(lockText) as Lockfile
  for (const [importer, entry] of Object.entries(lock.importers ?? {})) {
    for (const group of GROUPS) {
      const dependency = entry[group]?.[name]
      if (dependency?.version === undefined) continue
      const version = dependency.version.replace(/\(.*\)$/u, "")
      const integrity = lock.packages?.[`${name}@${version}`]?.resolution?.integrity ?? null
      return { name, version, integrity, importer, lockfile: "pnpm-lock.yaml" }
    }
  }
  return undefined
}

/** The pin is a fact about the lockfile; a stored pin that differs is drift, not a preference. */
export const pinMatches = (stored: RepoPin, derived: RepoPin): boolean =>
  stored.name === derived.name &&
  stored.version === derived.version &&
  stored.integrity === derived.integrity &&
  stored.lockfile === derived.lockfile
