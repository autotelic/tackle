import { existsSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { Schema } from "effect"
import * as Result from "effect/Result"
import { UnknownRecord } from "./schema.ts"

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

const Manifest = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  private: Schema.optional(Schema.Boolean),
  scripts: Schema.optional(UnknownRecord),
  dependencies: Schema.optional(UnknownRecord),
  devDependencies: Schema.optional(UnknownRecord),
  peerDependencies: Schema.optional(UnknownRecord),
  optionalDependencies: Schema.optional(UnknownRecord),
})
type Manifest = typeof Manifest.Type

const stringsOf = (value: Readonly<Record<string, unknown>> | undefined): ReadonlyArray<string> =>
  value === undefined ? [] : Object.keys(value).sort((left, right) => left.localeCompare(right))

const textOf = (value: string | undefined): string => value ?? ""

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

const manifestOf = (text: string): Manifest | undefined => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Manifest))(text)
  return Result.isSuccess(decoded) ? decoded.success : undefined
}

const packageOf = async (input: {
  readonly root: string
  readonly directory: string
}): Promise<AtlasPackage | undefined> => {
  const path = join(input.root, "packages", input.directory)
  const text = await readFile(join(path, "package.json"), "utf8").catch(() => undefined)
  if (text === undefined) return undefined
  const manifest = manifestOf(text)
  if (manifest === undefined) return undefined
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
  ].sort((left, right) => left.localeCompare(right))
  const readme = await readFile(join(path, "README.md"), "utf8").catch(() => "")
  return {
    name,
    version: textOf(manifest.version) || "0.0.0",
    path: "packages/" + input.directory,
    description: textOf(manifest.description),
    private: manifest.private === true,
    scripts: stringsOf(manifest.scripts),
    workspaceDependencies,
    summary: readme === "" ? null : summaryOf(readme),
  }
}

/** Read every workspace package and the workspace-internal dependency edges. */
export const atlasOf = async (input: {
  readonly root: string
  readonly generatedAt: string
}): Promise<Atlas> => {
  const workspace = workspaceRoot(input.root)
  const top = await readdir(join(workspace, "packages"), { withFileTypes: true })
    .then((entries) =>
      entries
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right)),
    )
    .catch(() => [])
  // A board subpackage (the view) is a workspace package one level below packages/*.
  const nested: Array<string> = []
  for (const directory of top) {
    if (!existsSync(join(workspace, "packages", directory, "package.json"))) continue
    const children = await readdir(join(workspace, "packages", directory), {
      withFileTypes: true,
    }).catch(() => [])
    for (const child of children)
      if (
        child.isDirectory() &&
        !child.name.startsWith(".") &&
        existsSync(join(workspace, "packages", directory, child.name, "package.json"))
      )
        nested.push(directory + "/" + child.name)
  }
  const directories = [...top, ...nested.sort((left, right) => left.localeCompare(right))]
  const packages = (
    await Promise.all(directories.map((directory) => packageOf({ root: workspace, directory })))
  ).filter((entry): entry is AtlasPackage => entry !== undefined)
  const names = new Set(packages.map((entry) => entry.name))
  const edges = packages.flatMap((entry) =>
    entry.workspaceDependencies
      .filter((dependency) => names.has(dependency))
      .map((dependency) => ({ from: entry.name, to: dependency })),
  )
  return { generatedAt: input.generatedAt, workspace: ".", packages, edges }
}
