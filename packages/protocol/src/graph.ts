import {
  comparableSignatureOf,
  similarityOf,
  type Catalog,
  type CatalogComponent,
  type PartRole,
  type RenderEdge,
} from "./catalog.ts"

/*
 * The render graph, as questions.
 *
 * The catalog records one direction — each part's resolved render edges — because both
 * directions are projections of that one list. Writing the inverse into the artifact
 * would double the bytes and give a reader two facts to keep in step.
 *
 * These are pure functions over a decoded catalog, so `cutlist` and `jig` answer the same
 * question the same way without either importing the other. That is the seam: they agree
 * on the record, not on a query implementation.
 *
 * They return `undefined` for "no such part" rather than `Option`: this package has no
 * dependencies, and the Effect-shaped rule that would prefer `Option` does not apply at the
 * dependency-free seam. `compatibility.md` is the record of that constraint.
 */

/** A part addressed by the two fields a reader has: what it is called, and where it lives. */
export interface PartRef {
  readonly path: string
  readonly name: string
}

/** A part reached from another, and the edge that reached it. */
export interface ReachedPart extends PartRef {
  /** The tag as the reaching module spelled it. */
  readonly tag: string
  /** One-based line in the reaching module. */
  readonly line: number
  /**
   * The direct child the walk passed through, when the part is not a direct child.
   * Absent on a direct edge: there is nothing between the page and what it renders.
   */
  readonly via?: string
}

/** Whether this catalog carries render edges at all — a catalog written before they landed does not. */
export const hasRenderEdges = (catalog: Catalog): boolean =>
  catalog.components.some((component) => component.renders !== undefined)

/** What a page renders, read as two lists rather than one graph. */
export interface PageView {
  readonly page: PartRef
  /** Parts the page's own JSX names. */
  readonly direct: ReadonlyArray<ReachedPart>
  /** Parts reached through those, closest first. A page's parts are not only its tags. */
  readonly transitive: ReadonlyArray<ReachedPart>
  /**
   * Whether the catalog could answer at all.
   *
   * An empty `direct` is ambiguous — a leaf renders nothing, and a catalog built before
   * edges existed renders nothing *for every part*. Reporting the second as the first is a
   * false finding, so the view carries the distinction instead of leaving it to a reader.
   */
  readonly edges: boolean
}

/** One route that mounts a part, and the chain of parts between them. */
export interface RouteReach extends PartRef {
  /** Child-to-parent chain from the route down, excluding the route and the subject. */
  readonly via: ReadonlyArray<string>
}

/** Where a part appears on screen. */
export interface PartView {
  readonly part: PartRef
  /** Modules whose JSX names it: the direct renderers, routes included. */
  readonly direct: ReadonlyArray<PartRef>
  /** Routes that mount it, directly or through other parts. */
  readonly routes: ReadonlyArray<RouteReach>
  /** See `PageView.edges`: an empty answer is not the same as an answer we could not give. */
  readonly edges: boolean
}

/** One candidate for "does something like this already exist?". */
export interface SimilarPart extends PartRef {
  readonly score: number
  /**
   * Which evidence produced the score.
   *
   * A name that reads alike and a skeleton that composes alike are different arguments.
   * Keeping them apart lets the answer say "they render the same parts" instead of "0.62",
   * which is the difference between reviewable evidence and a number to argue with.
   */
  readonly basis: "name" | "skeleton" | "name+skeleton"
  readonly nameScore: number
  readonly skeletonScore: number
  /** Composition the two share: the evidence for a skeleton match. */
  readonly shared: ReadonlyArray<string>
  /** Composition the subject has that the candidate lacks. */
  readonly unshared: ReadonlyArray<string>
}

const refOf = (component: CatalogComponent): PartRef => ({
  path: component.path,
  name: component.name,
})

const SOURCE_EXTENSION = /\.(?:tsx?|jsx?)$/u

const normalize = (value: string): string => value.trim().toLowerCase()

/**
 * Every part the query could mean, most specific tier first.
 *
 * Tiers rather than one fuzzy score: an id or a path is an address, a name is a guess, and
 * a suffix is a guess with an address's tail. Keeping them apart is what lets a caller say
 * "three parts are called Button" instead of picking one silently.
 */
export const findParts = (catalog: Catalog, query: string): ReadonlyArray<CatalogComponent> => {
  const needle = normalize(query)
  if (needle === "") return []
  const withoutExtension = needle.replace(SOURCE_EXTENSION, "")
  const matches: ReadonlyArray<(component: CatalogComponent) => boolean> = [
    (component) =>
      component.id !== undefined &&
      (normalize(component.id) === needle || normalize(component.id) === withoutExtension),
    (component) =>
      normalize(component.path) === needle || normalize(component.path) === withoutExtension,
    (component) => normalize(component.name) === needle,
    (component) => {
      const path = normalize(component.path).replace(SOURCE_EXTENSION, "")
      return path.endsWith(`/${withoutExtension}`)
    },
  ]
  for (const test of matches) {
    const found = catalog.components
      .filter(test)
      .sort((left, right) => left.path.localeCompare(right.path))
    if (found.length > 0) return found
  }
  return []
}

const componentAt = (catalog: Catalog, path: string): CatalogComponent | undefined =>
  catalog.components.find((component) => component.path === path)

/**
 * `page -> parts`, as a person asks it: "what does this screen render today?"
 *
 * Direct children are what the route's own JSX names. The transitive list is the rest of
 * what appears on screen — a mock author who stops at the direct list re-invents `Table`
 * because `SetupTable` renders it one level down. Breadth-first, edge order preserved, so
 * the answer is the reading order of the file rather than a hash's.
 */
export const partsOfPage = ({
  catalog,
  page,
}: {
  readonly catalog: Catalog
  readonly page: string
}): PageView | undefined => {
  const subject = componentAt(catalog, page)
  if (subject === undefined) return undefined
  const nameOf = new Map(catalog.components.map((component) => [component.path, component.name]))
  const reached = (edge: RenderEdge, via?: string): ReachedPart => ({
    path: edge.part,
    name: nameOf.get(edge.part) ?? edge.part,
    tag: edge.tag,
    line: edge.line,
    ...(via === undefined ? {} : { via }),
  })
  const direct = (subject.renders ?? []).map((edge) => reached(edge))
  const seen = new Set<string>([subject.path, ...direct.map((edge) => edge.path)])
  const transitive: Array<ReachedPart> = []
  // A queue of (path, via) pairs: the `via` a part is reached through is the direct child
  // whose subtree contains it, which is the thing a person navigates by.
  const queue: Array<{ readonly path: string; readonly via: string }> = direct.map((edge) => ({
    path: edge.path,
    via: edge.path,
  }))
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    const component = componentAt(catalog, current.path)
    for (const edge of component?.renders ?? []) {
      if (seen.has(edge.part)) continue
      seen.add(edge.part)
      transitive.push(reached(edge, current.via))
      queue.push({ path: edge.part, via: current.via })
    }
  }
  return { page: refOf(subject), direct, transitive, edges: hasRenderEdges(catalog) }
}

/**
 * `part -> pages`, as a mock reviewer asks it: "where does this appear on screen?"
 *
 * The import graph answers with modules; a reviewer wants routes. Walking the render edges
 * upward stops at the route rather than continuing into whatever imports it, because a
 * route is where the question ends — it is the thing a person can open.
 */
export const pagesOfPart = ({
  catalog,
  part,
}: {
  readonly catalog: Catalog
  readonly part: string
}): PartView | undefined => {
  const subject = componentAt(catalog, part)
  if (subject === undefined) return undefined
  const parents = new Map<string, Set<string>>()
  for (const component of catalog.components) {
    for (const edge of component.renders ?? []) {
      const set = parents.get(edge.part) ?? new Set<string>()
      set.add(component.path)
      parents.set(edge.part, set)
    }
  }
  const nameOf = new Map(catalog.components.map((component) => [component.path, component.name]))
  const direct = [...(parents.get(part) ?? [])]
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ path, name: nameOf.get(path) ?? path }))

  const routes: Array<RouteReach> = []
  const visited = new Set<string>([part])
  const queue: Array<{ readonly path: string; readonly via: ReadonlyArray<string> }> = direct.map(
    (parent) => ({ path: parent.path, via: [] }),
  )
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    if (visited.has(current.path)) continue
    visited.add(current.path)
    const component = componentAt(catalog, current.path)
    if (component === undefined) continue
    if (component.kind === "route") {
      routes.push({
        path: component.path,
        name: component.name,
        // The chain is recorded child-to-parent while walking up; a reader reads it down.
        via: [...current.via].reverse(),
      })
      continue
    }
    for (const parent of parents.get(current.path) ?? []) {
      queue.push({ path: parent, via: [...current.via, component.path] })
    }
  }
  routes.sort((left, right) => left.path.localeCompare(right.path))
  return { part: refOf(subject), direct, routes, edges: hasRenderEdges(catalog) }
}

/**
 * The words in a part's name, lowercased and singular.
 *
 * `TablePanel` → `table`, `panel`; `PerTreeRatesSection` → `per`, `tree`, `rate`, `section`.
 * Splitting is mechanical (case boundaries and separators) and the "s" strip is the one
 * piece of English this does: `Rates` and `Rate` are the same word, and a mock author
 * spelling one of them plural is not evidence of a different concept.
 *
 * No synonym table. `Modal` is not `Dialog` by any rule this can defend; a tool that
 * guessed would be confidently wrong exactly where the author is least able to check.
 */
const nameTokens = (name: string): ReadonlySet<string> => {
  const spaced = name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .toLowerCase()
  const tokens = new Set<string>()
  for (const token of spaced.split(/[^a-z0-9]+/u)) {
    if (token.length < 2) continue
    tokens.add(token.length > 3 && token.endsWith("s") ? token.slice(0, -1) : token)
  }
  return tokens
}

/**
 * How much two names share, 0–1.
 *
 * The denominator is the smaller name, not the union: `TablePanel` after `Table` is not a
 * worse match because it added a word, and a union would punish exactly that. A token
 * counts when the other side has it or a word containing it (`map` in `mapbox`), because
 * a compound spelling is how this vocabulary grows.
 */
export const nameSimilarity = ({
  left,
  right,
}: {
  readonly left: string
  readonly right: string
}): number => {
  if (normalize(left) === normalize(right)) return 1
  const a = nameTokens(left)
  const b = nameTokens(right)
  if (a.size === 0 || b.size === 0) return 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const token of small) {
    // A four-letter prefix is a compound spelling (`field` in `fieldwork`), not a
    // coincidence. Below that, `tab` sits inside `table` and the rule starts inventing
    // evidence, so the shorter side must be exact.
    if (
      [...large].some((other) => other === token || (token.length >= 4 && other.startsWith(token)))
    ) {
      shared += 1
    }
  }
  return shared / large.size
}

/**
 * Rank the catalog against a signature.
 *
 * The structural metric is the duplicate join's, not a second one: if `similar` used props,
 * or the raw skeleton with React's own hooks, it would answer differently from the duplicate
 * report a reviewer already trusts. `shared` is returned because "why" is what a person acts
 * on; a score alone is not reviewable.
 */
export const similarToSignature = ({
  catalog,
  signature,
  name,
  exclude,
  kinds,
  limit = 10,
  threshold = 0.2,
}: {
  readonly catalog: Catalog
  readonly signature: ReadonlyArray<string>
  /** The subject's name, when it has one. A sketch's declaration name is the other signal. */
  readonly name?: string
  readonly exclude?: string
  /** Restrict the field of comparison. Default: components and providers. */
  readonly kinds?: ReadonlyArray<PartRole>
  readonly limit?: number
  readonly threshold?: number
}): ReadonlyArray<SimilarPart> => {
  const subject = comparableSignatureOf(signature)
  if (subject.size === 0 && name === undefined) return []
  const field = new Set<PartRole>(kinds ?? ["component", "provider"])
  const scored: Array<SimilarPart> = []
  for (const component of catalog.components) {
    if (component.path === exclude) continue
    if (!field.has(component.kind ?? "component")) continue
    const candidate = comparableSignatureOf(component.signature)
    const skeletonScore =
      subject.size === 0 || candidate.size === 0
        ? 0
        : similarityOf({ left: subject, right: candidate })
    const nameScore = name === undefined ? 0 : nameSimilarity({ left: name, right: component.name })
    const score = Math.max(skeletonScore, nameScore)
    if (score < threshold) continue
    const basis =
      nameScore >= threshold && skeletonScore >= threshold
        ? ("name+skeleton" as const)
        : skeletonScore >= nameScore && skeletonScore >= threshold
          ? ("skeleton" as const)
          : ("name" as const)
    scored.push({
      path: component.path,
      name: component.name,
      score,
      basis,
      nameScore,
      skeletonScore,
      shared: [...subject]
        .filter((token) => candidate.has(token))
        .sort((left, right) => left.localeCompare(right)),
      unshared: [...subject]
        .filter((token) => !candidate.has(token))
        .sort((left, right) => left.localeCompare(right)),
    })
  }
  return scored
    .sort(
      (left, right) =>
        right.score - left.score ||
        (componentAt(catalog, right.path)?.usedBy ?? 0) -
          (componentAt(catalog, left.path)?.usedBy ?? 0) ||
        left.path.localeCompare(right.path),
    )
    .slice(0, limit)
}

/** `similar <part>`, the catalog-only case: the subject is a part the crawler already saw. */
export const similarParts = ({
  catalog,
  part,
  limit,
  threshold,
}: {
  readonly catalog: Catalog
  readonly part: string
  readonly limit?: number
  readonly threshold?: number
}): ReadonlyArray<SimilarPart> => {
  const subject = componentAt(catalog, part)
  if (subject === undefined) return []
  return similarToSignature({
    catalog,
    signature: subject.signature,
    name: subject.name,
    exclude: subject.path,
    kinds: [subject.kind ?? "component"],
    ...(limit === undefined ? {} : { limit }),
    ...(threshold === undefined ? {} : { threshold }),
  })
}
