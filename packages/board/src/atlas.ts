import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"

/*
 * The atlas is the workspace's own table of contents: one record per package, read
 * from the manifests and READMEs that already exist. It is a read surface, not a
 * second source of truth — nothing here is authored in a config file.
 *
 * The board is usually started from a repo root with `--root .room`, so the scan climbs
 * from the shop root until it finds `packages/`; the artifact stays relative and a
 * checkout can move without changing it.
 */

export interface AtlasPackage {
  readonly name: string
  readonly version: string
  readonly path: string
  readonly description: string
  readonly private: boolean
  readonly scripts: ReadonlyArray<string>
  readonly workspaceDependencies: ReadonlyArray<string>
  readonly summary: string | null
}

export interface AtlasEdge {
  readonly from: string
  readonly to: string
}

export interface Atlas {
  readonly generatedAt: string
  readonly workspace: string
  readonly packages: ReadonlyArray<AtlasPackage>
  readonly edges: ReadonlyArray<AtlasEdge>
}

interface Manifest {
  readonly name?: unknown
  readonly version?: unknown
  readonly description?: unknown
  readonly private?: unknown
  readonly scripts?: unknown
  readonly dependencies?: unknown
  readonly devDependencies?: unknown
  readonly peerDependencies?: unknown
  readonly optionalDependencies?: unknown
}

const recordOf = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const stringsOf = (value: unknown): ReadonlyArray<string> =>
  recordOf(value) === undefined ? [] : Object.keys(recordOf(value) ?? {}).sort()

const textOf = (value: unknown): string => (typeof value === "string" ? value : "")

/** Walk up from the shop root to the directory that owns `packages/`. */
const workspaceRoot = (root: string): string => {
  let current = resolve(root)
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(current, "packages"))) return current
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  return process.cwd()
}

/** The first prose paragraph in a README, with the markdown made plain enough to render. */
export const summaryOf = (text: string): string | null => {
  const withoutFrontMatter = text.startsWith("---")
    ? text.slice(text.indexOf("\n---", 3) + 4)
    : text
  for (const block of withoutFrontMatter.split(/\n\s*\n/)) {
    const lines = block
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line !== "" && !line.startsWith("#"))
    if (lines.length === 0) continue
    const paragraph = lines
      .join(" ")
      .replace(/!\[([^\]]*)\]\([^)]*\)/gu, "$1")
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1")
      .replace(/[*_`]/gu, "")
      .replace(/<[^>]+>/gu, "")
      .trim()
    if (paragraph !== "" && !paragraph.startsWith("```")) return paragraph
  }
  return null
}

const packageOf = async (root: string, directory: string): Promise<AtlasPackage | undefined> => {
  const path = join(root, "packages", directory)
  const text = await readFile(join(path, "package.json"), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  let manifest: Manifest
  try {
    manifest = JSON.parse(text) as Manifest
  } catch {
    return undefined
  }
  const name = textOf(manifest.name)
  if (name === "") return undefined
  const deps = [
    ...stringsOf(manifest.dependencies),
    ...stringsOf(manifest.devDependencies),
    ...stringsOf(manifest.peerDependencies),
    ...stringsOf(manifest.optionalDependencies),
  ]
  const workspaceDependencies = [
    ...new Set(deps.filter((dep) => dep.startsWith("@autotelic/"))),
  ].sort()
  const readme = await readFile(join(path, "README.md"), "utf8").catch(() => "")
  return {
    name,
    version: textOf(manifest.version) || "0.0.0",
    path: "packages/" + directory,
    description: textOf(manifest.description),
    private: manifest.private === true,
    scripts: stringsOf(manifest.scripts),
    workspaceDependencies,
    summary: readme === "" ? null : summaryOf(readme),
  }
}

/** Read every workspace package and the workspace-internal dependency edges. */
export const atlasOf = async (root: string): Promise<Atlas> => {
  const workspace = workspaceRoot(root)
  const directories = await readdir(join(workspace, "packages"), { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort(),
    )
    .catch(() => [])
  const packages = (
    await Promise.all(directories.map((directory) => packageOf(workspace, directory)))
  ).filter((entry): entry is AtlasPackage => entry !== undefined)
  const names = new Set(packages.map((entry) => entry.name))
  const edges = packages.flatMap((entry) =>
    entry.workspaceDependencies
      .filter((dependency) => names.has(dependency))
      .map((dependency) => ({ from: entry.name, to: dependency })),
  )
  return { generatedAt: new Date().toISOString(), workspace: ".", packages, edges }
}
