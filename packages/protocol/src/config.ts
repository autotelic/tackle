/*
 * The config seam: the repo's vocabulary, declared once, read by every tool.
 *
 * Each tool keeps its own config file — a client can adopt `joggle` alone — but the
 * *vocabulary* is shared: where app code lives, how imports alias, which roots are
 * which tier, where tokens come from, how routes own components, which convention
 * packs apply. `cutlist` consumes all of it; `plumb-ui`'s manifest is a projection of
 * it; the pattern packs are parameterized by it. That single schema is what makes
 * "repo-agnostic" a contract instead of an aspiration.
 */

import { arrayOf, bool, isRecord, num, oneOf, str, strings } from "./decode.ts"

/** Where a component sits in the tier pipeline. */
export type TierName = "primitive" | "shared" | "local"

/** The tier roots, most fundamental first. */
export interface Tiers {
  readonly primitive: ReadonlyArray<string>
  readonly shared: ReadonlyArray<string>
  readonly local: ReadonlyArray<string>
}

/** Where the token vocabulary is read from. */
export interface TokenSource {
  /** The Tailwind config, or the CSS entry when the theme lives in `@theme`. */
  readonly from: string
  /** The theme key to read (Tailwind v3, e.g. `extend`). Absent for v4 `@theme`. */
  readonly theme?: string
  /** The stylesheet whose `:root` custom properties are the second token layer. */
  readonly vars?: string
}

/**
 * How a component acquires an owner.
 *
 * `first-segment` collapses a deep route (`projects_.$id.sponsors`) to the domain it
 * belongs to (`projects`). Without it, almost every component imported by two deep
 * route dirs reads as "shared", and the tier stops meaning anything.
 */
export interface Ownership {
  readonly routeOwner: "first-segment" | "full"
  /** Whether an importer's own importers count toward ownership transitively. */
  readonly transitive: boolean
  /**
   * Entry-point suffixes, relative to any source root (`entry.client.tsx`, `root.tsx`).
   * Nothing imports an entry by design, so it is an orphan only when this list forgets it.
   */
  readonly entries?: ReadonlyArray<string>
}

/** The names a composition pattern is spelled with in this repo. */
export interface CompositionPattern {
  readonly providerSuffix: string
  readonly hookPrefix: string
  /**
   * The keys of the object a provider supplies. The canonical pattern is
   * `state/actions/meta`; declaring the shape keeps the catalog from guessing, and lets
   * a repo whose context is `state/dispatch` record that instead of being called broken.
   */
  readonly valueKeys?: ReadonlyArray<string>
}

/** How URL state is read in this repo's router. */
export interface UrlStatePattern {
  readonly router: "remix" | "tanstack" | "next" | "react-router"
  readonly reader: string
}

/** The convention packs a repo opts into, parameterized so they travel. */
export interface Patterns {
  readonly composition?: CompositionPattern
  readonly urlState?: UrlStatePattern
}

/** A repo's vocabulary. The shared half of every tool's config. */
export interface Vocabulary {
  /** Where application code lives, relative to the root. */
  readonly roots: ReadonlyArray<string>
  /** Import alias → paths, read from tsconfig rather than assumed. */
  readonly alias?: Readonly<Record<string, ReadonlyArray<string>>>
  readonly tiers: Tiers
  readonly tokens: TokenSource
  readonly hooks?: { readonly barrel?: string }
  readonly ownership: Ownership
  readonly patterns?: Patterns
}

/** Where `cutlist` writes each rendering of the model. */
export interface CutlistOutput {
  readonly catalog?: string
  readonly manifest?: string
  /** The menu model as JSON. The machine rendering beside its Markdown twin. */
  readonly menuJson?: string
  /** The menu as Markdown. */
  readonly menu?: string
  /** The directory of authored intent records, one JSON file per part name. */
  readonly intent?: string
  /** The pattern language: compositions, primitives, families, and the stable shape. */
  readonly patterns?: string
  /** The same pattern view as JSON, for an agent that wants to sort or filter it. */
  readonly patternsJson?: string
  /** Copyable imports and usage skeletons for features and load-bearing parts. */
  readonly recipes?: string
  /** The same recipes as JSON, for an agent building a mockup. */
  readonly recipesJson?: string
  /**
   * The directory of graph renderings — Mermaid source beside the SVG `pele` drew from it.
   * A directory, not a file, because one viewpoint is one diagram and a repo grows more.
   */
  readonly diagrams?: string
  readonly hooks?: string
  readonly tokens?: string
}

/** `cutlist.config.json`: the vocabulary plus where its renderings go. */
export interface CutlistConfig extends Vocabulary {
  readonly $schema?: string
  readonly output?: CutlistOutput
}

/** A process `jig` drives, or a plugin an existing host already runs. */
export interface EngineRef {
  readonly id: string
  /** `process` is a binary `jig` shells out to; `oxlint-plugin` rides `oxlint`. */
  readonly kind: "process" | "oxlint-plugin" | "internal"
  readonly command?: string
  readonly config?: string
  /**
   * Extra args appended to the engine's invocation. The one thing a project's own layout
   * needs that a shared default cannot know: e.g. scoping the `plumb` engine to
   * `--ignore-pattern examples/**` at a root whose exemplar will not build.
   */
  readonly args?: ReadonlyArray<string>
  readonly enabled?: boolean
}

/** When a run fails. */
export interface Gate {
  readonly mode: "touched-files" | "all"
  /** The committed baseline file, relative to the root. */
  readonly baseline: string
  readonly failOn?: "error" | "warn" | "any-new"
}

/** Every shape a report renders to. One name per host: a human, CI, an editor, a trove. */
export type ReportFormat = "text" | "json" | "jsonl" | "github" | "sarif" | "lsp" | "codeclimate"

/** The shapes a config may name, in the order the CLI's help lists them. */
export const REPORT_FORMATS: ReadonlyArray<ReportFormat> = [
  "text",
  "json",
  "jsonl",
  "github",
  "sarif",
  "lsp",
  "codeclimate",
]

/** `jig.config.json`: which engines are active, and how a run is gated. */
export interface HarnessConfig {
  readonly $schema?: string
  readonly engines: ReadonlyArray<EngineRef>
  readonly gate: Gate
  readonly report?: {
    readonly format?: ReportFormat
    readonly maxWarnings?: number
  }
  /** Where the agent reads from. Both are generated by `jig init`. */
  readonly agent?: {
    readonly cookbook?: string
    readonly onboarding?: string
  }
}

/*
 * Decoders — the authored configs, read as untrusted input.
 *
 * Configs are the one thing a human writes, so a malformed value must not become a crash
 * or a silently wrong vocabulary: the caller substitutes its default (`cutlist`'s
 * `defaultConfig`, `jig`'s `defaultConfig`) when a decode returns `undefined`. Both engines
 * currently decode through their own schema; these are the language-neutral twin, and the
 * two are checked against each other by the schema-conformance suite.
 */

/** Read the tier name set, or `undefined` when malformed. */
export const decodeTiers = (value: unknown): Tiers | undefined => {
  if (!isRecord(value)) return undefined
  const primitive = strings(value.primitive)
  const shared = strings(value.shared)
  const local = strings(value.local)
  if (primitive === undefined || shared === undefined || local === undefined) return undefined
  return { primitive, shared, local }
}

const decodeTokenSource = (value: unknown): TokenSource | undefined => {
  if (!isRecord(value)) return undefined
  const from = str(value.from)
  if (from === undefined) return undefined
  const theme = str(value.theme)
  const vars = str(value.vars)
  return {
    from,
    ...(theme === undefined ? {} : { theme }),
    ...(vars === undefined ? {} : { vars }),
  }
}

const decodeOwnership = (value: unknown): Ownership | undefined => {
  if (!isRecord(value)) return undefined
  const routeOwner = oneOf(value.routeOwner, ["first-segment", "full"] as const)
  const transitive = bool(value.transitive)
  if (routeOwner === undefined || transitive === undefined) return undefined
  const entries = "entries" in value ? strings(value.entries) : undefined
  if ("entries" in value && entries === undefined) return undefined
  return {
    routeOwner,
    transitive,
    ...(entries === undefined ? {} : { entries }),
  }
}

const decodePatterns = (value: unknown): Patterns | undefined => {
  if (!isRecord(value)) return undefined
  let composition: CompositionPattern | undefined
  if ("composition" in value) {
    if (!isRecord(value.composition)) return undefined
    const providerSuffix = str(value.composition.providerSuffix)
    const hookPrefix = str(value.composition.hookPrefix)
    const valueKeys = strings(value.composition.valueKeys)
    if (providerSuffix === undefined || hookPrefix === undefined) return undefined
    composition = {
      providerSuffix,
      hookPrefix,
      ...(valueKeys === undefined ? {} : { valueKeys }),
    }
  }
  let urlState: UrlStatePattern | undefined
  if ("urlState" in value) {
    if (!isRecord(value.urlState)) return undefined
    const router = oneOf(value.urlState.router, [
      "remix",
      "tanstack",
      "next",
      "react-router",
    ] as const)
    const reader = str(value.urlState.reader)
    if (router === undefined || reader === undefined) return undefined
    urlState = { router, reader }
  }
  const patterns: Patterns = {
    ...(composition === undefined ? {} : { composition }),
    ...(urlState === undefined ? {} : { urlState }),
  }
  return patterns
}

const decodeAlias = (
  value: unknown,
): Readonly<Record<string, ReadonlyArray<string>>> | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<string, ReadonlyArray<string>> = {}
  for (const [key, targets] of Object.entries(value)) {
    const decoded = strings(targets)
    if (decoded === undefined) return undefined
    out[key] = decoded
  }
  return out
}

/** Read `cutlist.config.json`, or `undefined` when it does not decode. */
export const decodeCutlistConfig = (value: unknown): CutlistConfig | undefined => {
  if (!isRecord(value)) return undefined
  const roots = strings(value.roots)
  const tiers = decodeTiers(value.tiers)
  const tokens = decodeTokenSource(value.tokens)
  const ownership = decodeOwnership(value.ownership)
  if (
    roots === undefined ||
    roots.length === 0 ||
    tiers === undefined ||
    tokens === undefined ||
    ownership === undefined
  ) {
    return undefined
  }
  const $schema = str(value.$schema)
  const alias = "alias" in value ? decodeAlias(value.alias) : undefined
  if ("alias" in value && alias === undefined) return undefined
  let hooks: { readonly barrel?: string } | undefined
  if ("hooks" in value) {
    if (!isRecord(value.hooks)) return undefined
    const barrel = str(value.hooks.barrel)
    if ("barrel" in value.hooks && barrel === undefined) return undefined
    hooks = barrel === undefined ? {} : { barrel }
  }
  const patterns = "patterns" in value ? decodePatterns(value.patterns) : undefined
  if ("patterns" in value && patterns === undefined) return undefined
  const output = "output" in value ? decodeOutput(value.output) : undefined
  if ("output" in value && output === undefined) return undefined
  return {
    ...($schema === undefined ? {} : { $schema }),
    roots,
    tiers,
    tokens,
    ownership,
    ...(alias === undefined ? {} : { alias }),
    ...(hooks === undefined ? {} : { hooks }),
    ...(patterns === undefined ? {} : { patterns }),
    ...(output === undefined ? {} : { output }),
  }
}

const decodeOutput = (value: unknown): CutlistOutput | undefined => {
  if (!isRecord(value)) return undefined
  const out: Record<string, string> = {}
  for (const key of [
    "catalog",
    "manifest",
    "menuJson",
    "menu",
    "intent",
    "diagrams",
    "hooks",
    "tokens",
  ] as const) {
    if (!(key in value)) continue
    const decoded = str(value[key])
    if (decoded === undefined) return undefined
    out[key] = decoded
  }
  return out
}

const decodeEngineRef = (value: unknown): EngineRef | undefined => {
  if (!isRecord(value)) return undefined
  const id = str(value.id)
  const kind = oneOf(value.kind, ["process", "oxlint-plugin", "internal"] as const)
  if (id === undefined || kind === undefined) return undefined
  const command = str(value.command)
  const config = str(value.config)
  // Strict: an `args` that is present but not a string array is a vocabulary jig cannot
  // trust, so the whole engine ref is refused rather than run with guessed args.
  const args = "args" in value ? strings(value.args) : undefined
  if ("args" in value && args === undefined) return undefined
  const enabled = bool(value.enabled)
  return {
    id,
    kind,
    ...(command === undefined ? {} : { command }),
    ...(config === undefined ? {} : { config }),
    ...(args === undefined ? {} : { args }),
    ...(enabled === undefined ? {} : { enabled }),
  }
}

const decodeGate = (value: unknown): Gate | undefined => {
  if (!isRecord(value)) return undefined
  const mode = oneOf(value.mode, ["touched-files", "all"] as const)
  const baseline = str(value.baseline)
  if (mode === undefined || baseline === undefined) return undefined
  const failOn = oneOf(value.failOn, ["error", "warn", "any-new"] as const)
  return { mode, baseline, ...(failOn === undefined ? {} : { failOn }) }
}

/** Read `jig.config.json`, or `undefined` when it does not decode. */
export const decodeHarnessConfig = (value: unknown): HarnessConfig | undefined => {
  if (!isRecord(value)) return undefined
  const engines = arrayOf(value.engines, decodeEngineRef)
  const gate = decodeGate(value.gate)
  if (engines === undefined || gate === undefined) return undefined
  const $schema = str(value.$schema)
  const report = "report" in value ? decodeReportOptions(value.report) : undefined
  if ("report" in value && report === undefined) return undefined
  const agent = "agent" in value ? decodeAgentOptions(value.agent) : undefined
  if ("agent" in value && agent === undefined) return undefined
  return {
    ...($schema === undefined ? {} : { $schema }),
    engines,
    gate,
    ...(report === undefined ? {} : { report }),
    ...(agent === undefined ? {} : { agent }),
  }
}

const decodeReportOptions = (
  value: unknown,
): { readonly format?: ReportFormat; readonly maxWarnings?: number } | undefined => {
  if (!isRecord(value)) return undefined
  const format = oneOf(value.format, REPORT_FORMATS)
  if ("format" in value && format === undefined) return undefined
  const maxWarnings = num(value.maxWarnings)
  if ("maxWarnings" in value && maxWarnings === undefined) return undefined
  return {
    ...(format === undefined ? {} : { format }),
    ...(maxWarnings === undefined ? {} : { maxWarnings }),
  }
}

const decodeAgentOptions = (
  value: unknown,
): { readonly cookbook?: string; readonly onboarding?: string } | undefined => {
  if (!isRecord(value)) return undefined
  const cookbook = str(value.cookbook)
  const onboarding = str(value.onboarding)
  if ("cookbook" in value && cookbook === undefined) return undefined
  if ("onboarding" in value && onboarding === undefined) return undefined
  return {
    ...(cookbook === undefined ? {} : { cookbook }),
    ...(onboarding === undefined ? {} : { onboarding }),
  }
}
