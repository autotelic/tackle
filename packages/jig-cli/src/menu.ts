import { existsSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import {
  decodeMenu,
  isRecord,
  num,
  str,
  strings,
  type Menu,
  type MenuEntry,
} from "@autotelic/protocol"

/*
 * The agent door to the cutlist artifact.
 *
 * `jig menu` reads the files cutlist wrote; it does not import cutlist and does not re-analyse
 * the tree. The artifact is the seam: a menu for the whole inventory, a pattern view for the
 * shape, and recipes for the next edit. This module is a query over those records — the one
 * place an agent can ask "which component do I reach for?" without opening a 300 KB menu.
 */

export interface ArtifactPaths {
  readonly dir: string
  readonly menu: string
  readonly menuJson: string
  readonly patterns: string
  readonly patternsJson: string
  readonly recipes: string
  readonly recipesJson: string
}

export interface Artifact {
  readonly paths: ArtifactPaths
  readonly menu?: Menu
  readonly patterns?: Record<string, unknown>
  readonly recipes?: Record<string, unknown>
}

export interface MenuMatch {
  readonly kind: "entry" | "feature" | "part" | "pattern"
  readonly name: string
  readonly path: string
  readonly tier?: string
  readonly role?: string
  readonly summary?: string
  readonly usedBy?: number
  readonly stability?: number
  readonly importLine?: string
  readonly usage?: string
  readonly notes: ReadonlyArray<string>
}

const OUTPUT_DEFAULTS = {
  menu: "tools/ui-catalog/MENU.md",
  menuJson: "tools/ui-catalog/menu.json",
  patterns: "tools/ui-catalog/PATTERNS.md",
  patternsJson: "tools/ui-catalog/patterns.json",
  recipes: "tools/ui-catalog/RECIPES.md",
  recipesJson: "tools/ui-catalog/recipes.json",
} as const

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as unknown
  } catch {
    return undefined
  }
}

const outputPath = (
  root: string,
  output: Record<string, unknown> | undefined,
  key: keyof typeof OUTPUT_DEFAULTS,
): string => {
  const configured = output === undefined ? undefined : str(output[key])
  return resolve(root, configured ?? OUTPUT_DEFAULTS[key])
}

/** Resolve the artifacts the same way cutlist's config does. */
export const artifactPaths = (root: string): ArtifactPaths => {
  const config = readJson(join(root, "cutlist.config.json"))
  const output = isRecord(config) && isRecord(config.output) ? config.output : undefined
  const menu = outputPath(root, output, "menu")
  return {
    dir: resolve(menu, ".."),
    menu,
    menuJson: outputPath(root, output, "menuJson"),
    patterns: outputPath(root, output, "patterns"),
    patternsJson: outputPath(root, output, "patternsJson"),
    recipes: outputPath(root, output, "recipes"),
    recipesJson: outputPath(root, output, "recipesJson"),
  }
}

/** Read the artifact, or the parts of it that exist. A missing file is a miss, not a throw. */
export const readArtifact = (root: string): Artifact => {
  const paths = artifactPaths(root)
  const menuValue = readJson(paths.menuJson)
  const menu = decodeMenu(menuValue)
  const patternsValue = readJson(paths.patternsJson)
  const recipesValue = readJson(paths.recipesJson)
  return {
    paths,
    ...(menu === undefined ? {} : { menu }),
    ...(isRecord(patternsValue) ? { patterns: patternsValue } : {}),
    ...(isRecord(recipesValue) ? { recipes: recipesValue } : {}),
  }
}

const arrayAt = (value: unknown, key: string): ReadonlyArray<Record<string, unknown>> => {
  if (!isRecord(value) || !Array.isArray(value[key])) return []
  return (value[key] as ReadonlyArray<unknown>).filter(isRecord)
}

const importLine = (path: string, exports: ReadonlyArray<string>, name: string): string => {
  const from = path.replace(/\.(?:tsx?|jsx?)$/u, "")
  const binding = /^[A-Za-z_$][\w$]*$/u.test(name)
    ? name
    : name
        .split(/[^A-Za-z0-9_$]+/u)
        .filter((part) => part !== "")
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join("") || "Part"
  const normalized = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/gu, "")
  const exact = exports.find(
    (candidate) => candidate !== "default" && normalized(candidate) === normalized(name),
  )
  if (exact !== undefined) return `import { ${exact} } from "${from}"`
  if (exports.includes("default")) return `import ${binding} from "${from}"`
  const named =
    exports.find((candidate) => candidate !== "default" && /^[A-Z]/u.test(candidate)) ??
    exports.find((candidate) => candidate !== "default" && candidate.startsWith("use")) ??
    exports.find((candidate) => candidate !== "default")
  if (named !== undefined) return `import { ${named} } from "${from}"`
  return `import * as ${binding} from "${from}"`
}

const mergeMatch = (left: MenuMatch, right: MenuMatch): MenuMatch => ({
  ...right,
  ...left,
  ...(left.summary === undefined && right.summary !== undefined ? { summary: right.summary } : {}),
  ...(left.stability === undefined && right.stability !== undefined
    ? { stability: right.stability }
    : {}),
  ...(left.usedBy === undefined && right.usedBy !== undefined ? { usedBy: right.usedBy } : {}),
  ...(left.tier === undefined && right.tier !== undefined ? { tier: right.tier } : {}),
  ...(left.role === undefined && right.role !== undefined ? { role: right.role } : {}),
})

const matchFromPattern = (
  record: Record<string, unknown>,
  kind: MenuMatch["kind"],
): MenuMatch | undefined => {
  const name = str(record.name)
  const path = str(record.path)
  if (name === undefined || path === undefined) return undefined
  const summary = str(record.summary)
  const stability = num(record.stability)
  const usedBy = num(record.usedBy)
  const tier = str(record.tier)
  const role = str(record.role)
  return {
    kind,
    name,
    path,
    ...(tier === undefined ? {} : { tier }),
    ...(role === undefined ? {} : { role }),
    ...(summary === undefined ? {} : { summary }),
    ...(usedBy === undefined ? {} : { usedBy }),
    ...(stability === undefined ? {} : { stability }),
    notes: [],
  }
}

const importText = ({
  from,
  binding,
  mode,
}: {
  readonly from: string
  readonly binding: string
  readonly mode: string | undefined
}): string => {
  if (mode === "namespace") return `import * as ${binding} from "${from}"`
  if (mode === "default") return `import ${binding} from "${from}"`
  return `import { ${binding} } from "${from}"`
}

const matchFromRecipe = (
  record: Record<string, unknown>,
  kind: "feature" | "part",
): MenuMatch | undefined => {
  const name = str(record.name)
  const path = str(record.path)
  if (name === undefined || path === undefined) return undefined
  const source = str(record.source)
  const usage = str(record.usage)
  const stability = num(record.stability)
  const notes = strings(record.notes) ?? []
  const importRecord = isRecord(record.import) ? record.import : undefined
  const from = importRecord === undefined ? undefined : str(importRecord.from)
  const binding = importRecord === undefined ? undefined : str(importRecord.binding)
  const mode = importRecord === undefined ? undefined : str(importRecord.mode)
  const line =
    from === undefined || binding === undefined ? undefined : importText({ from, binding, mode })
  const noteList = source === undefined ? notes : [...notes, `source: ${source}`]
  return {
    kind,
    name,
    path,
    ...(stability === undefined ? {} : { stability }),
    ...(line === undefined ? {} : { importLine: line }),
    ...(usage === undefined ? {} : { usage }),
    notes: noteList,
  }
}

const matchFromEntry = (entry: MenuEntry): MenuMatch => ({
  kind: "entry",
  name: entry.name,
  path: entry.path,
  tier: entry.tier,
  ...(entry.kind === undefined ? {} : { role: entry.kind }),
  ...(entry.summary === undefined ? {} : { summary: entry.summary }),
  ...(entry.usedBy === undefined ? {} : { usedBy: entry.usedBy }),
  importLine: importLine(entry.path, entry.exports ?? [], entry.name),
  notes: [],
})

/** Every candidate the artifact can answer with, recipes first (they carry the next edit). */
export const candidatesOf = (artifact: Artifact): ReadonlyArray<MenuMatch> => {
  const byPath = new Map<string, MenuMatch>()
  const add = (match: MenuMatch | undefined): void => {
    if (match === undefined) return
    const existing = byPath.get(match.path)
    byPath.set(match.path, existing === undefined ? match : mergeMatch(existing, match))
  }
  for (const record of arrayAt(artifact.recipes, "features"))
    add(matchFromRecipe(record, "feature"))
  for (const record of arrayAt(artifact.recipes, "parts")) add(matchFromRecipe(record, "part"))
  for (const section of ["stable", "compositions", "primitives", "shared", "families"]) {
    for (const record of arrayAt(artifact.patterns, section)) {
      add(matchFromPattern(record, section === "compositions" ? "feature" : "pattern"))
    }
  }
  for (const entry of artifact.menu?.entries ?? []) add(matchFromEntry(entry))
  return [...byPath.values()]
}

const scoreOf = (match: MenuMatch, query: string): number => {
  const name = match.name.toLowerCase()
  const path = match.path.toLowerCase()
  const haystack = [match.summary ?? "", match.role ?? "", match.tier ?? ""].join(" ").toLowerCase()
  if (name === query) return 100
  if (name.startsWith(query)) return 80
  if (name.includes(query)) return 60
  if (path.includes(query)) return 40
  if (haystack.includes(query)) return 20
  return 0
}

/** Rank the artifact for a prose query. An empty query asks for the stable shape. */
export const findMatches = (
  artifact: Artifact,
  query: string | undefined,
  limit: number,
): ReadonlyArray<MenuMatch> => {
  const candidates = candidatesOf(artifact)
  const trimmed = (query ?? "").trim().toLowerCase()
  if (trimmed === "") {
    const stable = [...candidates]
      .filter((match) => match.stability !== undefined)
      .sort(
        (left, right) =>
          (right.stability ?? 0) - (left.stability ?? 0) ||
          (right.usedBy ?? 0) - (left.usedBy ?? 0),
      )
    if (stable.length > 0) return stable.slice(0, limit)
    return [...candidates]
      .sort((left, right) => (right.usedBy ?? 0) - (left.usedBy ?? 0))
      .slice(0, limit)
  }
  return candidates
    .map((match) => ({ match, score: scoreOf(match, trimmed) }))
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        (right.match.usedBy ?? 0) - (left.match.usedBy ?? 0) ||
        (right.match.stability ?? 0) - (left.match.stability ?? 0) ||
        left.match.name.localeCompare(right.match.name),
    )
    .slice(0, limit)
    .map((entry) => entry.match)
}

const artifactFiles = (artifact: Artifact): ReadonlyArray<string> =>
  [
    artifact.paths.menu,
    artifact.paths.menuJson,
    artifact.paths.patterns,
    artifact.paths.patternsJson,
    artifact.paths.recipes,
    artifact.paths.recipesJson,
  ].filter((path) => existsSync(path))

/** A compact summary for a human or an agent that has not asked a question yet. */
export const renderSummary = (artifact: Artifact, limit: number): string => {
  const files = artifactFiles(artifact)
  if (artifact.menu === undefined && artifact.patterns === undefined && files.length === 0) {
    return `jig menu: no cutlist artifact under ${relative(process.cwd(), artifact.paths.dir) || "."}; run \`cutlist build\``
  }
  const lines: Array<string> = [`cutlist artifact: ${artifact.paths.dir}`]
  if (artifact.menu?.health !== undefined) {
    const health = artifact.menu.health
    lines.push(
      `${health.parts} parts; ${health.documented} documented; ${Math.round(health.sharedReach * 100)}% of local UI modules reach a shared part; ${health.localOnly} local-only; ${health.duplicateClusters} duplicate clusters`,
    )
  }
  const stable = findMatches(artifact, undefined, limit)
  if (stable.length > 0) {
    lines.push("", "stable shape:")
    for (const match of stable) {
      lines.push(
        `- \`${match.name}\` — \`${match.path}\`${match.stability === undefined ? "" : ` — stability ${match.stability.toFixed(2)}`}${match.usedBy === undefined ? "" : ` · ${match.usedBy} importers`}${match.summary === undefined ? "" : ` — ${match.summary}`}`,
      )
    }
  }
  lines.push("")
  lines.push(
    `files: ${files.map((path) => relative(artifact.paths.dir, path)).join(", ") || "none"}`,
  )
  lines.push(
    "hint: `jig menu <query>` finds a part; `jig menu --format json` returns the same view.",
  )
  return lines.join("\n")
}

/** Search results, with the import and the next shape when a recipe has one. */
export const renderMatches = (
  artifact: Artifact,
  matches: ReadonlyArray<MenuMatch>,
  query: string,
): string => {
  const lines: Array<string> = [`jig menu: ${matches.length} match(es) for "${query}"`]
  for (const match of matches) {
    const context = [
      match.kind,
      match.tier,
      match.role,
      match.stability === undefined ? undefined : `stability ${match.stability.toFixed(2)}`,
      match.usedBy === undefined ? undefined : `${match.usedBy} importers`,
    ]
      .filter((part): part is string => part !== undefined && part !== "")
      .join(" · ")
    lines.push(
      "",
      `- \`${match.name}\` — \`${match.path}\`${context === "" ? "" : ` — ${context}`}`,
    )
    if (match.summary !== undefined) lines.push(`  ${match.summary}`)
    if (match.importLine !== undefined) lines.push(`  ${match.importLine}`)
    if (match.usage !== undefined) lines.push(`  use: ${match.usage}`)
    for (const note of match.notes) lines.push(`  - ${note}`)
  }
  return lines.join("\n")
}

/** The machine form: paths, health, and the ranked matches. */
export const renderMenuJson = (
  artifact: Artifact,
  matches: ReadonlyArray<MenuMatch>,
  query: string,
): string =>
  `${JSON.stringify(
    {
      artifact: artifact.paths,
      ...(artifact.menu?.health === undefined ? {} : { health: artifact.menu.health }),
      query,
      matches,
    },
    null,
    2,
  )}\n`
