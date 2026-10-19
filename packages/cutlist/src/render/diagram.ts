import { Order } from "effect"
import { render } from "pele"
import type { Catalog, CatalogComponent } from "@autotelic/protocol"

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
 * These are renderings, not models — deliberately not a lexicon. A graph carries no authored
 * intent and nothing downstream parses it, so it earns no schema of its own; it is the
 * catalog seen from one side. `pele` is a rendering dependency, not a seam: nothing else in
 * the workspace reads it, and it never touches the model.
 */

/** One rendered viewpoint: its source and the picture `pele` drew from it. */
export interface Diagram {
  readonly name: string
  readonly mermaid: string
  readonly svg: string
}

/*
 * Colors by node kind. Tiers carry the catalog's own three, so the picture agrees with the
 * report a reader already has; everything else is a second layer of meaning: what a
 * component renders, the hooks it calls, the headless kit it wraps, who owns it.
 */
const CLASS_STYLE: Readonly<Record<string, string>> = {
  primitive: "fill:#eef2ff,stroke:#6366f1,color:#312e81",
  shared: "fill:#ecfdf5,stroke:#10b981,color:#064e3b",
  local: "fill:#fef3c7,stroke:#f59e0b,color:#78350f",
  part: "fill:#f8fafc,stroke:#cbd5e1,color:#334155",
  hook: "fill:#fdf2f8,stroke:#db2777,color:#831843",
  pkg: "fill:#f5f3ff,stroke:#8b5cf6,color:#4c1d95",
  owner: "fill:#f1f5f9,stroke:#64748b,color:#0f172a",
  empty: "fill:#ffffff,stroke:#cbd5e1,color:#64748b",
}
const FALLBACK_STYLE = "fill:#ffffff,stroke:#cbd5e1,color:#64748b"

/** A deterministic flowchart builder: nodes dedupe by label + kind, ids are positional. */
interface Chart {
  readonly node: (label: string, className: string) => string
  readonly edge: (from: string, to: string, dashed?: boolean) => void
  readonly render: () => string
}

const chart = (): Chart => {
  const ids = new Map<string, string>()
  const nodes: Array<readonly [string, string, string]> = []
  const edges: Array<readonly [string, string, boolean]> = []

  const node = (label: string, className: string): string => {
    const key = `${className}\u0000${label}`
    const existing = ids.get(key)
    if (existing !== undefined) return existing
    const id = `n${nodes.length}`
    ids.set(key, id)
    nodes.push([id, label, className])
    return id
  }

  const edge = (from: string, to: string, dashed = false): void => {
    // A tag that names the component itself (a primitive rendering its own element) is a
    // self-loop and only noise; the edge is dropped, the node stays.
    if (from === to) return
    edges.push([from, to, dashed])
  }

  const render = (): string => {
    const lines: Array<string> = ["flowchart LR"]
    if (nodes.length === 0) {
      lines.push('  none["(nothing to draw)"]:::empty', `  classDef empty ${FALLBACK_STYLE};`)
      return `${lines.join("\n")}\n`
    }
    for (const [id, label, className] of nodes) {
      lines.push(`  ${id}["${label.replaceAll('"', "&quot;")}"]:::${className}`)
    }
    for (const [from, to, dashed] of edges) {
      lines.push(`  ${from} ${dashed ? "-.->" : "-->"} ${to}`)
    }
    const used = [...new Set(nodes.map((entry) => entry[2]))].sort(Order.String)
    for (const className of used) {
      lines.push(`  classDef ${className} ${CLASS_STYLE[className] ?? FALLBACK_STYLE};`)
    }
    return `${lines.join("\n")}\n`
  }

  return { node, edge, render }
}

/** Components in name order, so every diagram is byte-stable across crawls. */
const byName = (catalog: Catalog): ReadonlyArray<CatalogComponent> =>
  [...catalog.components].sort((left, right) => Order.String(left.name, right.name))

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
  const components = byName(catalog)
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
  for (const component of byName(catalog)) {
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
  for (const component of byName(catalog)) {
    for (const owner of [...component.owners].sort(Order.String)) {
      graph.edge(graph.node(owner, "owner"), graph.node(component.name, component.tier))
    }
  }
  return graph.render()
}

/**
 * Every viewpoint, rendered. `pele` turns each source into the SVG beside it.
 *
 * A stable `idPrefix` per diagram does two jobs at once: SVG ids stay unique when several
 * diagrams are inlined on one page, and the bytes stop varying run to run — which they must
 * not, because `--check` compares them.
 */
export const renderDiagrams = (catalog: Catalog): ReadonlyArray<Diagram> => {
  const sources: ReadonlyArray<readonly [string, string]> = [
    ["composition", compositionMermaid(catalog)],
    ["hooks", hooksMermaid(catalog)],
    ["owners", ownersMermaid(catalog)],
  ]
  return sources.map(([name, mermaid]) => ({
    name,
    mermaid,
    svg: `${render(mermaid, { idPrefix: `cutlist-${name}` }).svg}\n`,
  }))
}
