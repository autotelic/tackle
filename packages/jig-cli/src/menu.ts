import { existsSync, readFileSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import {
  decodeCatalog,
  decodeMenu,
  decodePatternView,
  decodeRecipeView,
  findParts,
  isRecord,
  pagesOfPart,
  partsOfPage,
  similarParts,
  similarToSignature,
  str,
  type Catalog,
  type CatalogComponent,
  type Menu,
  type MenuEntry,
  type Pattern,
  type PatternView,
  type Recipe,
  type RecipeView,
  type SimilarPart,
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
  readonly catalog: string
  readonly menu: string
  readonly menuJson: string
  readonly patterns: string
  readonly patternsJson: string
  readonly recipes: string
  readonly recipesJson: string
}

export interface Artifact {
  readonly paths: ArtifactPaths
  /** Each view is `undefined` when its file is missing or malformed; the key is always present. */
  readonly menu: Menu | undefined
  readonly patterns: PatternView | undefined
  readonly recipes: RecipeView | undefined
  /** The model the three graph questions need: pages, mount points, and similarity. */
  readonly catalog: Catalog | undefined
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
  catalog: "tools/ui-catalog/catalog.json",
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
    catalog: outputPath(root, output, "catalog"),
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
  const menu = decodeMenu(readJson(paths.menuJson))
  const patterns = decodePatternView(readJson(paths.patternsJson))
  const recipes = decodeRecipeView(readJson(paths.recipesJson))
  const catalog = decodeCatalog(readJson(paths.catalog))
  return { paths, menu, patterns, recipes, catalog }
}

const importLine = ({
  path,
  exports,
  name,
}: {
  readonly path: string
  readonly exports: ReadonlyArray<string>
  readonly name: string
}): string => {
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

const mergeMatch = ({
  left,
  right,
}: {
  readonly left: MenuMatch
  readonly right: MenuMatch
}): MenuMatch => ({
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

const matchFromPattern = (pattern: Pattern, kind: MenuMatch["kind"]): MenuMatch => ({
  kind,
  name: pattern.name,
  path: pattern.path,
  tier: pattern.tier,
  ...(pattern.role === undefined ? {} : { role: pattern.role }),
  ...(pattern.summary === undefined ? {} : { summary: pattern.summary }),
  usedBy: pattern.usedBy,
  stability: pattern.stability,
  notes: pattern.relations.map((relation) => `${relation.kind} ${relation.target}`),
})

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

const matchFromRecipe = (recipe: Recipe): MenuMatch => {
  const line = importText({
    from: recipe.import.from,
    binding: recipe.import.binding,
    mode: recipe.import.mode,
  })
  return {
    kind: recipe.kind,
    name: recipe.name,
    path: recipe.path,
    ...(recipe.stability === undefined ? {} : { stability: recipe.stability }),
    importLine: line,
    usage: recipe.usage,
    notes: [...recipe.notes, `source: ${recipe.source}`],
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
  importLine: importLine({ path: entry.path, exports: entry.exports ?? [], name: entry.name }),
  notes: [],
})

/** Every candidate the artifact can answer with, recipes first (they carry the next edit). */
export const candidatesOf = (artifact: Artifact): ReadonlyArray<MenuMatch> => {
  const byPath = new Map<string, MenuMatch>()
  const add = (match: MenuMatch | undefined): void => {
    if (match === undefined) return
    const existing = byPath.get(match.path)
    byPath.set(
      match.path,
      existing === undefined ? match : mergeMatch({ left: existing, right: match }),
    )
  }
  for (const recipe of artifact.recipes?.features ?? []) add(matchFromRecipe(recipe))
  for (const recipe of artifact.recipes?.parts ?? []) add(matchFromRecipe(recipe))
  for (const pattern of artifact.patterns?.stable ?? []) add(matchFromPattern(pattern, "pattern"))
  for (const pattern of artifact.patterns?.compositions ?? [])
    add(matchFromPattern(pattern, "feature"))
  for (const pattern of artifact.patterns?.primitives ?? [])
    add(matchFromPattern(pattern, "pattern"))
  for (const pattern of artifact.patterns?.shared ?? []) add(matchFromPattern(pattern, "pattern"))
  for (const pattern of artifact.patterns?.families ?? []) add(matchFromPattern(pattern, "pattern"))
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

/*
 * The three graph questions, at the agent's door.
 *
 * They read `catalog.json` rather than re-deriving a render graph from `menu.json`: the
 * edges live on the model, and `composedOf` is a bag of names that cannot say which module
 * a tag meant. Sharing `protocol`'s queries is what keeps this door's answer identical to
 * `cutlist ask`'s.
 */

export type GraphQuestion =
  | { readonly kind: "page"; readonly ref: string }
  | { readonly kind: "part"; readonly ref: string }
  | { readonly kind: "similar"; readonly ref: string }

export type GraphAnswer =
  | { readonly ok: false; readonly problem: string }
  | { readonly ok: true; readonly question: GraphQuestion; readonly answer: unknown }

const resolveOne = (
  catalog: Catalog,
  ref: string,
): { readonly component: CatalogComponent } | { readonly problem: string } => {
  const matches = findParts(catalog, ref)
  const [only] = matches
  if (only === undefined) return { problem: `no part matches "${ref}"` }
  if (matches.length > 1) {
    return {
      problem: `"${ref}" is ${matches.length} parts; pass a path: ${matches
        .slice(0, 6)
        .map((component) => component.path)
        .join(", ")}`,
    }
  }
  return { component: only }
}

/** Answer a graph question, or say why the catalog cannot. */
export const answerGraph = (artifact: Artifact, question: GraphQuestion): GraphAnswer => {
  const { catalog } = artifact
  if (catalog === undefined) {
    return {
      ok: false,
      problem: `no readable catalog at ${artifact.paths.catalog}; run \`cutlist build\``,
    }
  }
  if (question.kind === "page") {
    const resolved = resolveOne(catalog, question.ref)
    if ("problem" in resolved) return { ok: false, problem: resolved.problem }
    const view = partsOfPage({ catalog, page: resolved.component.path })
    if (view === undefined) return { ok: false, problem: `no part matches "${question.ref}"` }
    return { ok: true, question, answer: view }
  }
  if (question.kind === "part") {
    const resolved = resolveOne(catalog, question.ref)
    if ("problem" in resolved) return { ok: false, problem: resolved.problem }
    const view = pagesOfPart({ catalog, part: resolved.component.path })
    if (view === undefined) return { ok: false, problem: `no part matches "${question.ref}"` }
    return { ok: true, question, answer: view }
  }
  const resolved = resolveOne(catalog, question.ref)
  const candidates: ReadonlyArray<SimilarPart> =
    "component" in resolved
      ? similarParts({ catalog, part: resolved.component.path })
      : similarToSignature({ catalog, signature: [], name: question.ref })
  return { ok: true, question, answer: { subject: question.ref, similar: candidates } }
}

/** The evidence line: which signal spoke, and how strongly. */
const evidenceOf = (candidate: SimilarPart): string => {
  if (candidate.basis === "name+skeleton") {
    return `name ${candidate.nameScore.toFixed(2)}, skeleton ${candidate.skeletonScore.toFixed(2)}`
  }
  if (candidate.basis === "skeleton") return `skeleton ${candidate.skeletonScore.toFixed(2)}`
  return `name ${candidate.nameScore.toFixed(2)}`
}

/** A terse reading of an answer: the agent has the JSON for detail. */
export const renderGraphAnswer = (answer: GraphAnswer): string => {
  if (!answer.ok) return `jig menu: ${answer.problem}`
  const { question, answer: value } = answer
  if (question.kind === "similar") {
    const { subject, similar } = value as { subject: string; similar: ReadonlyArray<SimilarPart> }
    if (similar.length === 0) return `jig menu: nothing resembles "${subject}"`
    const lines = [`jig menu: ${similar.length} part(s) resemble "${subject}"`]
    for (const candidate of similar) {
      const evidence = evidenceOf(candidate)
      lines.push(`- \`${candidate.name}\` — \`${candidate.path}\` — ${evidence}`)
      if (candidate.shared.length > 0) lines.push(`  shares: ${candidate.shared.join(", ")}`)
    }
    return lines.join("\n")
  }
  const view = value as {
    readonly page?: { readonly path: string; readonly name: string }
    readonly part?: { readonly path: string; readonly name: string }
    readonly edges?: boolean
    readonly direct: ReadonlyArray<{
      readonly path: string
      readonly name: string
      readonly via?: string
    }>
    readonly transitive?: ReadonlyArray<{
      readonly path: string
      readonly name: string
      readonly via?: string
    }>
    readonly routes?: ReadonlyArray<{
      readonly path: string
      readonly name: string
      readonly via: ReadonlyArray<string>
    }>
  }
  if (question.kind === "page" && view.page !== undefined) {
    const lines = [`jig menu: page \`${view.page.name}\` — ${view.page.path}`]
    if (view.edges === false) {
      lines.push(
        "this catalog carries no render edges; rebuild it with the current cutlist to answer this question.",
      )
    }
    lines.push(`direct: ${view.direct.map((edge) => `\`${edge.name}\``).join(", ") || "none"}`)
    if ((view.transitive ?? []).length > 0) {
      lines.push(
        `reached: ${(view.transitive ?? [])
          .map((edge) =>
            edge.via === undefined ? `\`${edge.name}\`` : `\`${edge.name}\` via \`${edge.via}\``,
          )
          .join(", ")}`,
      )
    }
    return lines.join("\n")
  }
  if (question.kind === "part" && view.part !== undefined) {
    const lines = [`jig menu: part \`${view.part.name}\` — ${view.part.path}`]
    if (view.edges === false) {
      lines.push(
        "this catalog carries no render edges; rebuild it with the current cutlist to answer this question.",
      )
    }
    lines.push(`direct: ${view.direct.map((edge) => `\`${edge.name}\``).join(", ") || "none"}`)
    lines.push(
      `routes: ${
        (view.routes ?? [])
          .map(
            (route) =>
              `\`${route.name}\`${route.via.length === 0 ? "" : ` via ${route.via.map((step) => `\`${step}\``).join(" › ")}`}`,
          )
          .join(", ") || "none"
      }`,
    )
    return lines.join("\n")
  }
  return JSON.stringify(value, null, 2)
}
