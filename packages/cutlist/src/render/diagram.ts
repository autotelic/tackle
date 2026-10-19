import { Order } from "effect"
import { render } from "pele"
import type { Catalog, CatalogComponent, TierName } from "@autotelic/protocol"

/*
 * The graph projection: the model's edges, drawn.
 *
 * `menu.json` answers "what is here"; it is a list. The other question the artifact has to
 * answer is "what is this made of, where is this hook called, who owns this" — and those
 * edges are already in the catalog, in each component's `signature` (rendered tags and
 * called hooks) and its `owners`. Nothing here recomputes them: it picks a viewpoint, emits
 * Mermaid, and asks `pele` for the SVG. The source is kept beside the picture because a diff
 * of the source is readable and a diff of the SVG is not.
 *
 * The drawing follows Tufte, because a graph is a graphic before it is a diagram:
 *
 *   - Data-ink. The marks are the data. There is no legend box, no border, no title bar; the
 *     panel's title is its scope and its counts. Tier is carried by weight, not by a palette
 *     of three competing hues. The one accent is a hook call, because that is the one edge
 *     that is a different kind of thing from a render.
 *   - Erasure. An edge drawn twice is one fact, so edges dedupe. A part that renders nothing
 *     and is rendered by nothing is in `MENU.md`, not here: a graph is made of edges.
 *   - Small multiples. A whole-app graph is a hairball and a lie at any size, and `pele`
 *     refuses more than 50,000 characters or 5,000 edges anyway. A view is drawn at the
 *     largest scope that fits, and the scopes are the real units: the owner, then the page.
 *   - Direct labels. A node carries its name; the panel carries its scope and counts. There
 *     is no key to decode and no second name for anything.
 *
 * These are renderings, not models — deliberately not a lexicon. A graph carries no authored
 * intent and nothing downstream parses it, so it earns no schema of its own; it is the
 * catalog seen from one side. `pele` is a rendering dependency, not a seam: nothing else in
 * the workspace reads it, and it never touches the model.
 */

/** `pele`'s guards, not ours to raise: above these it refuses to draw at all. */
const SOURCE_LIMIT = 50_000
const EDGE_LIMIT = 5_000

/**
 * The legibility budget, well below `pele`'s guards.
 *
 * A source that fits is not a picture that reads. Past a couple of hundred edges the lines
 * cross into a hairball, and a node count in the hundreds is a texture, not a set of names.
 * These are Tufte's small-multiple rule made operational: when a panel exceeds either, it is
 * drawn at the next smaller scope instead. The budgets are injectable for tests.
 */
const NODE_BUDGET = 80
const EDGE_BUDGET = 200

/** One rendered viewpoint: its source and the picture `pele` drew from it. */
export interface Diagram {
  readonly name: string
  /** The human scope, `view / owner / page`, for the index and the panel title. */
  readonly scope: string
  readonly mermaid: string
  readonly svg: string
  readonly nodes: number
  readonly edges: number
}

/** The closed set of node kinds a diagram draws. The style table is keyed by it. */
type NodeKind =
  | "primitive"
  | "shared"
  | "local"
  | "part"
  | "hook"
  | "pkg"
  | "owner"
  | "scope"
  | "empty"

/*
 * Grayscale is tier: darker means more foundational, so the picture carries the vocabulary
 * the report already uses without spending three hues on it. `local` is the default because
 * it is the majority; a node pays for a class statement only when it is not the default.
 * The single accent is a hook, and it is used once.
 */
const CLASS_STYLE = {
  primitive: "fill:#ffffff,stroke:#111827,stroke-width:2px,color:#111827",
  shared: "fill:#f3f4f6,stroke:#4b5563,color:#111827",
  local: "fill:#ffffff,stroke:#9ca3af,color:#111827",
  part: "fill:#ffffff,stroke:#e5e7eb,color:#6b7280",
  hook: "fill:#fff1f2,stroke:#e11d48,color:#881337",
  pkg: "fill:#ffffff,stroke:#d1d5db,color:#6b7280",
  owner: "fill:#111827,stroke:#111827,color:#ffffff",
  scope: "fill:#f9fafb,stroke:#111827,stroke-width:2px,color:#111827",
  empty: "fill:#ffffff,stroke:#d1d5db,color:#6b7280",
} satisfies Record<NodeKind, string>

/** `local` is the default class, so it is never written on a node. */
const DEFAULT_KIND: NodeKind = "local"

/** One node in a built flowchart: its positional id, its label, and its kind. */
interface ChartNode {
  readonly id: string
  readonly label: string
  readonly kind: NodeKind
}

/** One edge: endpoints as node ids, and whether it is a call rather than a render. */
interface ChartEdge {
  readonly from: string
  readonly to: string
  readonly dashed: boolean
  /** A count, when the edge is a contracted bundle of several composition edges. */
  readonly label: string | undefined
}

/** A deterministic flowchart builder: nodes dedupe by label + kind, ids are positional. */
interface Chart {
  readonly node: (label: string, kind: NodeKind) => string
  readonly edge: (from: string, to: string, dashed?: boolean, label?: string) => void
  readonly render: () => string
}

const chart = (options: { readonly pruneIsolated?: boolean } = {}): Chart => {
  const pruneIsolated = options.pruneIsolated ?? true
  const ids = new Map<string, string>()
  const nodes: Array<ChartNode> = []
  const edges: Array<ChartEdge> = []
  const seen = new Set<string>()

  const node = (label: string, kind: NodeKind): string => {
    const key = `${kind}\u0000${label}`
    const existing = ids.get(key)
    if (existing !== undefined) return existing
    const id = `n${nodes.length}`
    ids.set(key, id)
    nodes.push({ id, label, kind })
    return id
  }

  const edge = (
    from: string,
    to: string,
    dashed: boolean | undefined = false,
    label: string | undefined = undefined,
  ): void => {
    // A tag that names the component itself (a primitive rendering its own element) is a
    // self-loop and only noise; the edge is dropped.
    if (from === to) return
    // A component that renders the same part twice still renders it once: an edge is a fact
    // about composition, not a count of call sites.
    const key = `${from}\u0000${to}\u0000${dashed}\u0000${label ?? ""}`
    if (seen.has(key)) return
    seen.add(key)
    edges.push({ from, to, dashed, label })
  }

  const render = (): string => {
    const lines: Array<string> = ["flowchart LR"]
    if (nodes.length === 0) {
      lines.push(
        '  none["(nothing to draw)"]',
        "  class none empty",
        `  classDef empty ${CLASS_STYLE.empty};`,
      )
      return `${lines.join("\n")}\n`
    }
    // With edges, the picture is the edges: an isolated part is inventory, and the menu is
    // where inventory lives. A graph with no edges at all degrades to a list of its nodes.
    const used = new Set<string>()
    for (const edge of edges) {
      used.add(edge.from)
      used.add(edge.to)
    }
    const drawn =
      edges.length === 0 || !pruneIsolated ? nodes : nodes.filter((node) => used.has(node.id))
    for (const { id, label } of drawn) {
      lines.push(`  ${id}["${label.replaceAll('"', "&quot;")}"]`)
    }
    for (const { from, to, dashed, label } of edges) {
      const arrow = `${dashed ? "-.->" : "-->"}${label === undefined ? "" : `|${label}|`}`
      lines.push(`  ${from} ${arrow} ${to}`)
    }
    const classes = new Map<NodeKind, Array<string>>()
    for (const { id, kind } of drawn) {
      if (kind === DEFAULT_KIND) continue
      const existing = classes.get(kind)
      if (existing === undefined) classes.set(kind, [id])
      else existing.push(id)
    }
    for (const kind of [...classes.keys()].sort(Order.String)) {
      lines.push(`  class ${classes.get(kind)?.join(",")} ${kind}`)
    }
    const kinds = [...new Set(drawn.map((node) => node.kind))].sort(Order.String)
    lines.push(`  classDef default ${CLASS_STYLE[DEFAULT_KIND]};`)
    for (const kind of kinds) {
      if (kind === DEFAULT_KIND) continue
      lines.push(`  classDef ${kind} ${CLASS_STYLE[kind]};`)
    }
    return `${lines.join("\n")}\n`
  }

  return { node, edge, render }
}

/** Foundations first: the order a reader builds the picture in, and stable across crawls. */
const TIER_RANK = { primitive: 0, shared: 1, local: 2 } satisfies Record<TierName, number>

const ordered = (catalog: Catalog): ReadonlyArray<CatalogComponent> =>
  [...catalog.components].sort(
    (left, right) =>
      TIER_RANK[left.tier] - TIER_RANK[right.tier] ||
      Order.String(left.name, right.name) ||
      Order.String(left.path, right.path),
  )

/**
 * The shape a JSX tag and a file-derived name share: `ProjectToolbar` and `project-toolbar`
 * both become `projecttoolbar`; `ThemeContext.Provider` drops its member to become
 * `themecontext`.
 */
const normalize = (label: string): string =>
  label
    .replace(/\..*$/u, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/gu, "")

/**
 * Resolve a rendered tag to the catalog component it names, when it names one.
 *
 * Only a capitalized tag can be a component — JSX spells components in caps and raw
 * elements in lowercase — so `span`/`button` stay raw parts and never collide with a
 * component that merely shares their name.
 */
const resolver = (
  components: ReadonlyArray<CatalogComponent>,
): ((label: string) => CatalogComponent | undefined) => {
  const index = new Map<string, CatalogComponent>()
  for (const component of components) {
    const key = normalize(component.name)
    if (!index.has(key)) index.set(key, component)
  }
  return (label) => (/^[A-Z]/u.test(label) ? index.get(normalize(label)) : undefined)
}

/**
 * What each component is made of — an edge to every component it renders and every hook it
 * calls. This is the shape the menu flattens: `composedOf` keeps the names but loses whether
 * a part was a tag or a hook, so the graph reads the `signature` they came from.
 */
export const compositionMermaid = (catalog: Catalog): string => {
  const graph = chart()
  const components = ordered(catalog)
  const resolve = resolver(components)
  for (const component of components) {
    const from = graph.node(component.name, component.tier)
    for (const part of component.signature) {
      if (part.startsWith("tag:")) {
        const label = part.slice(4)
        if (normalize(label) === normalize(component.name)) continue
        const target = resolve(label)
        graph.edge(
          from,
          target === undefined ? graph.node(label, "part") : graph.node(target.name, target.tier),
        )
      } else if (part.startsWith("hook:")) {
        graph.edge(from, graph.node(part.slice(5), "hook"), true)
      } else if (part.startsWith("uses:")) {
        graph.edge(from, graph.node(part.slice(5), "pkg"), true)
      }
    }
  }
  return graph.render()
}

/** Where each hook is called: the hook edges inverted, so a hook is the subject. */
export const hooksMermaid = (catalog: Catalog): string => {
  const graph = chart()
  for (const component of ordered(catalog)) {
    for (const part of component.signature) {
      if (part.startsWith("hook:")) {
        graph.edge(graph.node(part.slice(5), "hook"), graph.node(component.name, component.tier))
      }
    }
  }
  return graph.render()
}

/** Who owns what — an edge from each owner to the components it owns. */
export const ownersMermaid = (catalog: Catalog): string => {
  const graph = chart()
  for (const component of ordered(catalog)) {
    for (const owner of [...component.owners].sort(Order.String)) {
      graph.edge(graph.node(owner, "owner"), graph.node(component.name, component.tier))
    }
  }
  return graph.render()
}

/**
 * The tree of trees: one node per owner, one edge per boundary a composition crosses.
 *
 * A whole-app graph is a hairball and does not fit; the answer is not to shrink the marks but
 * to contract each subtree to a node. The label carries the size of the subtree and the edge
 * carries the number of composition edges that cross the boundary, so the overview says how
 * much is behind each node rather than only that a node exists.
 *
 * A part with several owners is drawn under the first in name order: an overview is one node
 * per owner and a part is one mark. The per-owner panels are where multiplicity is visible.
 */
export const scopeMermaid = (catalog: Catalog): string => {
  const graph = chart({ pruneIsolated: false })
  const scopeOf = (component: CatalogComponent): string =>
    component.owners.length === 0
      ? "unowned"
      : ([...component.owners].sort(Order.String)[0] ?? "unowned")

  const counts = new Map<string, number>()
  for (const component of catalog.components) {
    const scope = scopeOf(component)
    counts.set(scope, (counts.get(scope) ?? 0) + 1)
  }
  const nodes = new Map<string, string>()
  for (const [scope, count] of [...counts.entries()].sort(([left], [right]) =>
    Order.String(left, right),
  )) {
    nodes.set(scope, graph.node(`${scope} · ${count}`, "scope"))
  }

  // A tag is a name, and a name is the only identity a part carries today.
  const byName = new Map<string, CatalogComponent>()
  for (const component of catalog.components) {
    const key = normalize(component.name)
    if (!byName.has(key)) byName.set(key, component)
  }

  const crossings = new Map<string, { from: string; to: string; count: number }>()
  for (const component of catalog.components) {
    const from = nodes.get(scopeOf(component))
    if (from === undefined) continue
    for (const part of component.signature) {
      if (!part.startsWith("tag:")) continue
      const target = byName.get(normalize(part.slice(4)))
      if (target === undefined) continue
      const to = nodes.get(scopeOf(target))
      if (to === undefined || to === from) continue
      const key = `${from}\u0000${to}`
      const existing = crossings.get(key)
      if (existing === undefined) crossings.set(key, { from, to, count: 1 })
      else existing.count += 1
    }
  }
  for (const { from, to, count } of [...crossings.values()].sort(
    (left, right) => Order.String(left.from, right.from) || Order.String(left.to, right.to),
  )) {
    graph.edge(from, to, false, count > 1 ? String(count) : undefined)
  }
  return graph.render()
}

/** The viewpoints, each a pure function from the catalog to one source. */
interface Viewpoint {
  readonly name: string
  readonly build: (catalog: Catalog) => string
  readonly groupers: ReadonlyArray<Grouper>
}

/**
 * How small a view has to be before it is drawn; injectable so tests stay small.
 *
 * `source` and `edges` are `pele`'s hard guards; `nodes` and `legibleEdges` are the smaller
 * budgets a panel is held to so that "it fits" also means "it reads."
 */
export interface DiagramLimits {
  readonly source?: number
  readonly edges?: number
  readonly nodes?: number
  readonly legibleEdges?: number
}

/** One scope: a set of components that share a label, and the label. */
interface ScopeGroup {
  readonly key: string
  readonly components: ReadonlyArray<CatalogComponent>
}

const bucket = (
  components: ReadonlyArray<CatalogComponent>,
  keyOf: (component: CatalogComponent) => ReadonlyArray<string>,
): ReadonlyArray<ScopeGroup> => {
  const buckets = new Map<string, Array<CatalogComponent>>()
  for (const component of components) {
    for (const key of keyOf(component)) {
      const existing = buckets.get(key)
      if (existing === undefined) buckets.set(key, [component])
      else existing.push(component)
    }
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => Order.String(left, right))
    .map(([key, group]) => ({ key, components: group }))
}

/** One zoom of a scope, from the components in it to the components in each child scope. */
type Grouper = (components: ReadonlyArray<CatalogComponent>) => ReadonlyArray<ScopeGroup>

/**
 * A component belongs to each owner that imports it; with no importer it is `unowned`.
 *
 * `unowned` is not a feature and not a failure: an entry point (a route, a `main`, a test
 * harness) has no importer by design, and an orphan is a finding. It is a scope like any
 * other, so it is grouped and drawn when it composes something.
 */
const byOwner: Grouper = (components) =>
  bucket(components, (component) =>
    component.owners.length === 0 ? ["unowned"] : component.owners,
  )

/** The route root conventions a page can be read from, most specific first. */
const ROUTE_ROOTS = ["routes/", "pages/"] as const

/**
 * The page a part belongs to: the route segment it sits under, or the directory it sits in.
 *
 * A flat route file (`routes/accounts_.customers_.$id.tsx`) is not a page of its own — that
 * would be one panel per URL, a directory listing rather than small multiples. Its page is
 * the first segment, `accounts`; dots and underscores are Remix's separators. A nested route
 * (`routes/accounts/customers/$id.tsx`) is already segmented by its directory. Anything
 * outside a route root is grouped by its directory, which is the only page-like unit the
 * crawl can infer without another convention.
 */
export const pageOf = (path: string): string => {
  for (const root of ROUTE_ROOTS) {
    const at = path.indexOf(root)
    if (at < 0) continue
    const rest = path.slice(at + root.length)
    const cut = rest.indexOf("/")
    const route = cut < 0 ? rest.replace(/\.[^./]+$/u, "") : rest.slice(0, cut)
    const segment = route.split(/[._]/u).find((part) => part.length > 0) ?? route
    return `${root.slice(0, -1)}/${segment}`
  }
  const cut = path.lastIndexOf("/")
  return cut < 0 ? path : path.slice(0, cut)
}

const byPage: Grouper = (components) => bucket(components, (component) => [pageOf(component.path)])

/** Last resort: halve by name, so a scope always terminates at a drawable size. */
const byHalf: Grouper = (components) => {
  if (components.length < 2) return []
  const sorted = [...components].sort(
    (left, right) => Order.String(left.name, right.name) || Order.String(left.path, right.path),
  )
  const middle = Math.ceil(sorted.length / 2)
  return [
    { key: "first", components: sorted.slice(0, middle) },
    { key: "second", components: sorted.slice(middle) },
  ]
}

/** The zoom order: the whole, its owners, each owner's pages, then a deterministic halving. */
const ZOOMS: ReadonlyArray<Grouper> = [byOwner, byPage, byHalf]

const VIEWPOINTS: ReadonlyArray<Viewpoint> = [
  { name: "composition", build: compositionMermaid, groupers: ZOOMS },
  { name: "hooks", build: hooksMermaid, groupers: ZOOMS },
  { name: "owners", build: ownersMermaid, groupers: ZOOMS },
]

/** A path-safe name for a scope; `--` separates the zooms. */
const slug = (key: string): string =>
  key
    .replaceAll("/", "-")
    .replace(/[^a-zA-Z0-9_.$-]/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")

const prefixOf = (name: string): string => `cutlist-${name.replace(/[^a-zA-Z0-9_-]/gu, "-")}`

const edgesIn = (mermaid: string): number =>
  mermaid.match(/^ {2}n\d+ (?:-->|-\.->)(?:\|[^|]*\|)? n\d+$/gmu)?.length ?? 0

const nodesIn = (mermaid: string): number => mermaid.match(/^ {2}n\d+\[/gmu)?.length ?? 0

/**
 * Every viewpoint, rendered.
 *
 * A stable `idPrefix` per diagram keeps SVG ids unique when several are inlined on one page,
 * and the bytes stop varying run to run — which they must not, because `--check` compares
 * them. Each panel is titled with its scope and its counts, because a small multiple that
 * does not say what it is measuring is decoration.
 */
export const renderDiagrams = (
  catalog: Catalog,
  limits: DiagramLimits = {},
): ReadonlyArray<Diagram> => {
  const sourceLimit = limits.source ?? SOURCE_LIMIT
  const edgeLimit = limits.edges ?? EDGE_LIMIT
  const nodeBudget = limits.nodes ?? NODE_BUDGET
  const edgeBudget = limits.legibleEdges ?? EDGE_BUDGET
  const diagrams: Array<Diagram> = []

  /** The panel without its picture: what the title and the limits are computed from. */
  const panelOf = (name: string, source: string): Omit<Diagram, "svg"> => {
    const nodes = nodesIn(source)
    const edges = edgesIn(source)
    const scope = name.replaceAll("--", " / ")
    const mermaid = `---\ntitle: ${scope} · ${nodes} nodes, ${edges} edges\n---\n${source}`
    return { name, scope, mermaid, nodes, edges }
  }

  const fits = (panel: Omit<Diagram, "svg">): boolean =>
    panel.mermaid.length <= sourceLimit &&
    panel.edges <= edgeLimit &&
    panel.nodes <= nodeBudget &&
    panel.edges <= edgeBudget

  const push = (panel: Omit<Diagram, "svg">): void => {
    diagrams.push({
      ...panel,
      svg: `${render(panel.mermaid, { idPrefix: prefixOf(panel.name) }).svg}\n`,
    })
  }

  const draw = (
    view: Viewpoint,
    name: string,
    components: ReadonlyArray<CatalogComponent>,
    level: number,
  ): void => {
    const panel = panelOf(name, view.build({ ...catalog, components }))
    if (panel.nodes === 0) return
    if (panel.edges === 0) {
      // A scope that composes nothing is not a graph. The whole view is the exception — its
      // node list is the small repository's diagram — but a *scoped* empty graph is a table
      // row and a `MENU.md` entry, not a picture. This is also what stops an `unowned` bucket
      // of entry points from being halved into hundreds of panels with nothing to draw.
      if (level === 0 && fits(panel)) push(panel)
      return
    }
    if (fits(panel)) {
      push(panel)
      return
    }
    const group = view.groupers[level]
    if (group === undefined) {
      // The scope is already a single part, so there is no smaller unit to draw. If `pele`
      // still refuses, its own tagged error is the loud failure; this file has no better
      // answer, and a silent skip would be worse.
      push(panel)
      return
    }
    const groups = group(components)
    if (groups.length < 2) {
      draw(view, name, components, level + 1)
      return
    }
    for (const scoped of groups) {
      draw(view, `${name}--${slug(scoped.key)}`, scoped.components, level + 1)
    }
  }

  for (const view of VIEWPOINTS) {
    const whole = panelOf(view.name, view.build(catalog))
    // Too big to draw as one graph. Contract it to the tree of owners first: the overview is
    // the macro reading the per-owner panels cannot give — how the scopes compose each other.
    // An overview with no crossings is not a contraction; it is the table.
    if (whole.edges > 0 && !fits(whole) && view.name === "composition") {
      const overview = panelOf("composition--overview", scopeMermaid(catalog))
      if (overview.edges > 0 && fits(overview)) push(overview)
    }
    draw(view, view.name, catalog.components, 0)
  }
  return diagrams
}

/** One column of the macro table; numeric columns are right-aligned the way `oxfmt` does. */
interface TableColumn {
  readonly title: string
  readonly align: "left" | "right"
}

/**
 * A Markdown table, already padded to `oxfmt`'s canonical form.
 *
 * `compareText` is byte-exact on purpose — a rendering that a formatter can change is a
 * rendering the staleness gate cannot trust — so the generator, not the formatter, owns the
 * layout. This is the smallest table that keeps that promise.
 */
const markdownTable = (
  columns: ReadonlyArray<TableColumn>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
): ReadonlyArray<string> => {
  const widths = columns.map((column, index) =>
    Math.max(column.title.length, ...rows.map((row) => (row[index] ?? "").length)),
  )
  const cell = (text: string, index: number): string =>
    columns[index]?.align === "right"
      ? text.padStart(widths[index] ?? 0)
      : text.padEnd(widths[index] ?? 0)
  const rule = (column: TableColumn, index: number): string =>
    column.align === "right"
      ? `${"-".repeat((widths[index] ?? 1) - 1)}:`
      : "-".repeat(widths[index] ?? 1)
  return [
    `| ${columns.map((column, index) => cell(column.title, index)).join(" | ")} |`,
    `| ${columns.map(rule).join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ]
}

/**
 * The macro reading: one row per panel.
 *
 * Tufte's table is a graph. The pictures answer "what is this made of"; this answers "which
 * panels are there, and how big is each" without opening one. It also says what the graph
 * leaves out, so a reader does not mistake a panel for the whole.
 */
export const renderDiagramIndex = (diagrams: ReadonlyArray<Diagram>): string => {
  const rows = diagrams.map((diagram) => [
    diagram.scope,
    String(diagram.nodes),
    String(diagram.edges),
    `[source](./${diagram.name}.mmd) · [svg](./${diagram.name}.svg)`,
  ])
  const views = new Map<string, Array<Diagram>>()
  for (const diagram of diagrams) {
    const view = diagram.scope.split(" / ")[0] ?? diagram.scope
    const existing = views.get(view)
    if (existing === undefined) views.set(view, [diagram])
    else existing.push(diagram)
  }
  const atlas = [...views.entries()].flatMap(([view, panels]) => [
    `## ${view}`,
    "",
    ...panels.flatMap((panel) => [
      `### ${panel.scope}`,
      "",
      `![${panel.scope}](./${panel.name}.svg)`,
      "",
      `[source](./${panel.name}.mmd)`,
      "",
    ]),
  ])
  return [
    "# Diagrams",
    "",
    "One panel per scope. A graph draws edges: a part that renders nothing and is rendered by",
    "nothing is in `MENU.md`, not here.",
    "",
    "`pele` refuses a source over 50,000 characters or 5,000 edges. A view too large to draw",
    "as one graph is contracted to its owners first — one node per scope, edges for the",
    "compositions that cross a boundary, counts on both — and then drawn as small multiples",
    "of the scopes it is made of: the owner, then the page. The atlas below is the join: the",
    "overview and its children in one reading order.",
    "",
    "A panel is also held well below `pele`'s guards: past a few hundred edges a graph is a",
    "hairball even when it fits. When a scope exceeds the legibility budget it is drawn at the",
    "next smaller scope instead. A scope that composes nothing is a row in the table below and",
    "a line in `MENU.md`, not a picture; an entry point that nothing imports is still a scope,",
    "but a flat route file is grouped with its route segment rather than drawn one panel per",
    "URL.",
    "",
    "Grayscale is tier (darker is more primitive); the one accent is a hook; a dashed edge is",
    "a call rather than a render.",
    "",
    ...markdownTable(
      [
        { title: "scope", align: "left" },
        { title: "nodes", align: "right" },
        { title: "edges", align: "right" },
        { title: "files", align: "left" },
      ],
      rows,
    ),
    "",
    ...atlas,
  ].join("\n")
}
