import type { Catalog, PageView, PartView, SimilarPart } from "@autotelic/protocol"
import { bindingOfComponent, importLine } from "./recipes.ts"

/*
 * The three questions a mock asks the catalog, rendered.
 *
 * They live beside the other renderings because they are renderings: the answer is computed
 * by `protocol`'s graph queries over the artifact, and nothing here re-derives it. Keeping
 * the text in a renderer (rather than in `cli.ts`) is the house rule — the command parses,
 * the core answers, the renderer writes.
 */

/** A part, addressed the way a reviewer reads it: name, tier, and how to import it. */
const describe = (catalog: Catalog, path: string): string => {
  const component = catalog.components.find((candidate) => candidate.path === path)
  if (component === undefined) return `\`${path}\` (not in this catalog)`
  const facts = [
    component.tier,
    component.usedBy === undefined ? undefined : `${component.usedBy} importers`,
  ]
    .filter((fact): fact is string => fact !== undefined)
    .join(" · ")
  return `\`${component.name}\` — ${facts}`
}

/** `parts.<page>`: what a screen renders, direct first, then the rest of what is on it. */
export const renderPageView = ({
  catalog,
  view,
}: {
  readonly catalog: Catalog
  readonly view: PageView
}): string => {
  const lines: Array<string> = [`page ${describe(catalog, view.page.path)}`, view.page.path, ""]
  if (!view.edges) {
    lines.push(
      "this catalog carries no render edges; rebuild it with the current cutlist to answer this question.",
      "",
    )
  }
  lines.push(`renders directly (${view.direct.length}):`)
  for (const edge of view.direct) {
    lines.push(`- ${describe(catalog, edge.path)} — \`${edge.tag}\` line ${edge.line}`)
    const component = catalog.components.find((candidate) => candidate.path === edge.path)
    if (component !== undefined) lines.push(`  ${importLine(bindingOfComponent(component))}`)
  }
  if (view.transitive.length > 0) {
    lines.push("", `reached through them (${view.transitive.length}):`)
    for (const edge of view.transitive) {
      const via = edge.via === undefined ? "" : ` via \`${edge.via}\``
      lines.push(`- ${describe(catalog, edge.path)} — \`${edge.tag}\` line ${edge.line}${via}`)
    }
  }
  return lines.join("\n")
}

/** `pages.<part>`: where a part appears, nearest first, with the routes that mount it. */
export const renderPartView = ({
  catalog,
  view,
}: {
  readonly catalog: Catalog
  readonly view: PartView
}): string => {
  const lines: Array<string> = [`part ${describe(catalog, view.part.path)}`, view.part.path, ""]
  if (!view.edges) {
    lines.push(
      "this catalog carries no render edges; rebuild it with the current cutlist to answer this question.",
      "",
    )
  }
  lines.push(`rendered directly by (${view.direct.length}):`)
  for (const parent of view.direct) lines.push(`- ${describe(catalog, parent.path)}`)
  if (view.routes.length > 0) {
    lines.push("", `mounted by routes (${view.routes.length}):`)
    for (const route of view.routes) {
      const via =
        route.via.length === 0 ? "" : ` — via ${route.via.map((step) => `\`${step}\``).join(" › ")}`
      lines.push(`- \`${route.name}\` — \`${route.path}\`${via}`)
    }
  } else {
    lines.push("", "no route mounts it; it is reached only by other parts.")
  }
  return lines.join("\n")
}

const scoreOf = (score: number): string => score.toFixed(2)

/** The evidence line: which signal spoke, and how strongly. */
const evidenceOf = (candidate: SimilarPart): string => {
  if (candidate.basis === "name+skeleton") {
    return `name ${scoreOf(candidate.nameScore)} + skeleton ${scoreOf(candidate.skeletonScore)}`
  }
  if (candidate.basis === "skeleton") return `skeleton ${scoreOf(candidate.skeletonScore)}`
  return `name ${scoreOf(candidate.nameScore)}`
}

const renderCandidate = (catalog: Catalog, candidate: SimilarPart): Array<string> => {
  const lines = [`- ${describe(catalog, candidate.path)} — ${evidenceOf(candidate)}`]
  if (candidate.shared.length > 0) lines.push(`  shares: ${candidate.shared.join(", ")}`)
  if (candidate.unshared.length > 0) lines.push(`  only here: ${candidate.unshared.join(", ")}`)
  return lines
}

/** `similar.<part>`: the ranked answer to "does something like this already exist?" */
export const renderSimilar = ({
  catalog,
  subject,
  candidates,
}: {
  readonly catalog: Catalog
  readonly subject: string
  readonly candidates: ReadonlyArray<SimilarPart>
}): string => {
  const lines = [`similar to ${subject}`]
  if (candidates.length === 0) {
    lines.push("", "nothing in the catalog shares this composition; it looks new.")
    return lines.join("\n")
  }
  for (const candidate of candidates) lines.push("", ...renderCandidate(catalog, candidate))
  return lines.join("\n")
}

/**
 * `similar --file`: a sketch that is not in the catalog yet.
 *
 * This is the shape the question actually arrives in — a mock author has written the thing
 * once and wants to know whether it already exists. The sketch is parsed, not committed, so
 * the catalog stays a description of the app rather than of the mockups.
 */
export const renderFileSimilar = ({
  catalog,
  file,
  groups,
}: {
  readonly catalog: Catalog
  readonly file: string
  readonly groups: ReadonlyArray<{
    readonly name: string
    readonly candidates: ReadonlyArray<SimilarPart>
  }>
}): string => {
  const lines = [`sketch: ${file}`]
  for (const group of groups) {
    lines.push("", `${group.name}:`)
    if (group.candidates.length === 0) {
      lines.push("  nothing in the catalog shares this composition.")
      continue
    }
    for (const candidate of group.candidates) {
      lines.push(...renderCandidate(catalog, candidate).map((line) => `  ${line}`))
    }
  }
  return lines.join("\n")
}
