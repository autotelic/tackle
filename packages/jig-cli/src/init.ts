import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect, FileSystem, Option, Path, PlatformError } from "effect"
import {
  cutlistDefaultOutput,
  decodeCutlistConfig,
  parseJson,
  isRecord,
  type CutlistConfig,
  type CutlistOutput,
  type EngineRef,
  type HarnessConfig,
  type ResolvedCutlistOutput,
} from "@autotelic/protocol"
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts"
import { loadConfig } from "./config.ts"
import { resolveEngineCommand } from "./engines.ts"
import { exec, type Spawner } from "./exec.ts"
import {
  GENERATED_BEGIN,
  GENERATED_END,
  generatedRules,
  mergeGitattributes,
  type GitattributesAction,
} from "./gitattributes.ts"
import { packageJsonOf } from "./package-json.ts"

/*
 * What `jig init` learns about a repository before it writes anything.
 *
 * A scaffold that writes the same four files everywhere is a template, not an
 * onboarding. The exemplar this follows (Alchemy's agent prompt) is specific:
 * it names the exact command, the first thing to run, where to stop and ask,
 * and the docs index to consult. The same information is knowable here -- the
 * package manager, the lint gate the repo already runs, whether a tool is
 * installed -- so `init` reads it and writes a config for THIS repo.
 *
 * Two rules shape the decisions:
 *
 *   - An engine that is not installed is not enabled. A config full of dead
 *     engines makes `jig check` look clean when nothing ran.
 *   - A repo's existing gate wins over a generic one. A strict `oxlint -c` the
 *     team already runs is the `plumb` engine; the broad advisory config is not.
 */

type PackageManager = "bun" | "npm" | "pnpm" | "yarn"

/** joggle's own ledger: identities are `rule + file set`, so a moved line does not re-fail. */
const JOGGLE_BASELINE = ".joggle-baseline.json"

/** What a repository already has, and therefore what `init` should enable. */
export interface RepoProfile {
  readonly root: string
  readonly name: string
  readonly packageManager: PackageManager
  /** The command that runs a package script here: `pnpm`, `npm`, `yarn`, `bun`. */
  readonly run: string
  /** The command that runs jig: `pnpm jig` when it is a local dependency, else `jig`. */
  readonly jig: string
  /** Facts about the repo that change what the docs say. A set, not flags that can disagree. */
  readonly facts: ReadonlySet<
    "ci" | "configured" | "live-judgement" | "room" | "typescript" | "workspaces"
  >
  readonly agentDocs: ReadonlyArray<string>
  /** A short, factual sentence about the repository, from AGENTS.md, README or package.json. */
  readonly summary: string
  /** The repo's own scripts, for the cookbook. */
  readonly commands: ReadonlyArray<{ readonly name: string; readonly command: string }>
  readonly lint: {
    readonly tool: "biome" | "eslint" | "none" | "oxlint"
    readonly config?: string | undefined
    readonly script?: string | undefined
  }
  readonly engines: ReadonlyArray<EngineRef>
  readonly notes: ReadonlyArray<string>
  readonly gateMode: "all" | "touched-files"
  /** The paths the existing config names, so a re-run does not write a second ledger. */
  readonly baseline: string
  readonly cookbook: string
  readonly onboarding: string
  /** Where this machine installs the CLI from: this checkout when it builds jig, else npm. */
  readonly jigSource: string
  /** Agent hosts this repository already wires, so the prompt does not ask for them twice. */
  readonly hosts: ReadonlySet<"opencode" | "pi">
  /** A cutlist config inferred from the tree, when this looks like a UI. */
  readonly cutlistDraft: CutlistConfig | undefined
  /** Layers proposed from the workspace, with no `forbid`: a person supplies the judgement. */
  readonly architectureDraft?:
    | {
        readonly layers: ReadonlyArray<{
          readonly name: string
          readonly include: ReadonlyArray<string>
        }>
      }
    | undefined
  /** Where cutlist writes, with its defaults filled in. Absent when this repo has no cutlist. */
  readonly cutlistOutput?: ResolvedCutlistOutput | undefined
  /** The cutlist config this repo already keeps, and the directory its engine scans. */
  readonly cutlistExisting?: { readonly path: string; readonly directory: string } | undefined
}

/** What `init` wrote and what it left alone. */
export interface InitResult {
  readonly profile: RepoProfile
  readonly written: ReadonlyArray<string>
  readonly kept: ReadonlyArray<string>
  /** Written paths this repository's .gitignore keeps out of git, so nobody can review them. */
  readonly ignored: ReadonlyArray<string>
  /** Engine-owned ledgers: the ratchet is born accepted, once, and never rewritten. */
  readonly engineBaselines: ReadonlyArray<{
    readonly id: string
    readonly path: string
    readonly accepted: number
    readonly action: "kept" | "written" | "would accept"
  }>
  readonly joggleConfig: "kept" | "written" | "absent"
  readonly cutlistConfig: "kept" | "written" | "absent"
  /** What happened to `.gitattributes`: the generated-artifact block, never the whole file. */
  readonly gitattributes: GitattributesAction | "absent"
  /** True when nothing was written: this is the plan an operator or agent reviews. */
  readonly dryRun: boolean
  /** Findings already accepted in the baseline, when one was kept. */
  readonly accepted: number
}

/** Whether a command resolves from the project or the ambient PATH. */
const onPath = (name: string): boolean =>
  (process.env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, name)))

const available = (input: { readonly root: string; readonly command: string }): boolean =>
  resolveEngineCommand(input) !== input.command || onPath(input.command)

/** The package manager, from the field a repo pins or the lockfile it committed. */
const packageManagerOf = (
  field: string | undefined,
  files: ReadonlyArray<string>,
): PackageManager => {
  if (field?.startsWith("pnpm@") === true) return "pnpm"
  if (field?.startsWith("yarn@") === true) return "yarn"
  if (field?.startsWith("bun@") === true) return "bun"
  if (field?.startsWith("npm@") === true) return "npm"
  if (files.includes("pnpm-lock.yaml") || files.includes("pnpm-workspace.yaml")) return "pnpm"
  if (files.includes("yarn.lock")) return "yarn"
  if (files.includes("bun.lockb") || files.includes("bun.lock")) return "bun"
  return "npm"
}

/** The command that runs jig, preferring the repo's own install. */
const jigCommandOf = (manager: PackageManager, local: boolean): string => {
  if (!local) return "jig"
  switch (manager) {
    case "pnpm":
      return "pnpm jig"
    case "yarn":
      return "yarn jig"
    case "bun":
      return "bunx jig"
    case "npm":
      return "npx jig"
  }
}

/** One `oxlint` invocation the repo already runs, with the config it names. */
interface OxlintInvocation {
  readonly script: string
  readonly config: string | undefined
  /** The script's own scope and flags, without the config or the output format. */
  readonly args: ReadonlyArray<string>
}

/** The strictest oxlint script, preferring one that names a config and a gate. */
const oxlintScriptOf = (
  scripts: Readonly<Record<string, string>>,
): Option.Option<OxlintInvocation> => {
  const candidates: Array<OxlintInvocation & { readonly score: number }> = []
  for (const [name, command] of Object.entries(scripts)) {
    if (!command.includes("oxlint") || command.includes("--fix")) continue
    const tokens = command.split(/\s+/u)
    const start = tokens.findIndex((token) => token === "oxlint" || token.endsWith("/oxlint"))
    if (start < 0) continue
    const rest = tokens.slice(start + 1)
    const index = rest.findIndex((token) => token === "-c" || token === "--config")
    const config = index >= 0 ? rest[index + 1] : undefined
    // Keep the script's own scope (`src`, `--ignore-pattern …`), but drop the
    // config (jig passes it) and the format (jig asks for JSON).
    const args: Array<string> = []
    for (let cursor = 0; cursor < rest.length; cursor += 1) {
      const token = rest[cursor]
      if (token === "-c" || token === "--config") {
        cursor += 1
        continue
      }
      if (token === "--format" || token === "-f") {
        cursor += 1
        continue
      }
      if (token === "--fix") continue
      if (token !== undefined) args.push(token)
    }
    const score = (config === undefined ? 0 : 2) + (/error|gate|strict/iu.test(name) ? 2 : 0)
    candidates.push({ script: name, config, args, score })
  }
  return Option.fromUndefinedOr(candidates.sort((left, right) => right.score - left.score)[0])
}

/** The oxlint config a repo keeps, preferring one whose name says "gate". */
const oxlintConfigOf = (files: ReadonlyArray<string>): Option.Option<string> => {
  const configs = files.filter(
    (name) =>
      (name.includes("oxlint") || name === ".oxlintrc") &&
      /\.(?:json|ts|js|mjs|cjs|mts|cts)$/u.test(name),
  )
  return Option.fromUndefinedOr(
    configs.sort((left, right) => {
      const score = (name: string): number =>
        /error|gate|strict/iu.test(name) ? 2 : name === ".oxlintrc.json" ? 1 : 0
      return score(right) - score(left) || left.localeCompare(right)
    })[0],
  )
}

/** Whether a config loads plumb, so the `plumb` engine is not a misnamed oxlint. */
const loadsPlumb = (text: string): boolean => text.includes("@autotelic/plumb")

/** Whether a tsconfig exists at the root or one level under a common workspace directory. */
const hasTypeScript = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  files: ReadonlyArray<string>,
): Effect.Effect<boolean> =>
  Effect.gen(function* () {
    if (files.includes("tsconfig.json")) return true
    for (const directory of ["apps", "packages", "services"]) {
      if (!files.includes(directory)) continue
      const children: ReadonlyArray<string> = yield* Effect.orElseSucceed(
        fs.readDirectory(path.join(root, directory)),
        () => [],
      )
      for (const child of children) {
        const exists = yield* Effect.orElseSucceed(
          fs.exists(path.join(root, directory, child, "tsconfig.json")),
          () => false,
        )
        if (exists) return true
      }
    }
    return false
  })

/** The first sentence or two that describe the repository, from prose it already keeps. */
const repositorySummaryOf = (input: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly root: string
  readonly files: ReadonlyArray<string>
  readonly fallback: string | undefined
}): Effect.Effect<string> =>
  Effect.gen(function* () {
    for (const file of ["AGENTS.md", "README.md"]) {
      if (!input.files.includes(file)) continue
      const text = yield* Effect.orElseSucceed(
        input.fs.readFileString(input.path.join(input.root, file)),
        () => "",
      )
      const lines = text.split("\n").map((line) => line.trim())
      const project = lines.find((line) => line.startsWith("**Project**:"))
      const stack = lines.find((line) => line.startsWith("**Stack**:"))
      if (project !== undefined || stack !== undefined) {
        return [project, stack]
          .filter((line): line is string => line !== undefined)
          .join(" ")
          .replaceAll("**", "")
          .slice(0, 600)
      }
      const paragraph = text
        .split(/\n\s*\n/u)
        .map((part) => part.trim())
        .find((part) => part.length > 0 && !part.startsWith("#") && !part.startsWith("!["))
      if (paragraph !== undefined) {
        return paragraph.replace(/\s+/gu, " ").slice(0, 600)
      }
    }
    return input.fallback === undefined ? "" : input.fallback
  })

/* -------------------------------------------------------------------------- */
/* Cutlist                                                                     */
/* -------------------------------------------------------------------------- */

/** Directories a UI scan never descends into. */
const NOT_UI = new Set([
  ".git",
  ".next",
  ".turbo",
  ".cache",
  "build",
  "coverage",
  "dist",
  "examples",
  "fixtures",
  "test",
  "tests",
  "node_modules",
  "out",
  "repos",
  "tools",
])

/** Whether a directory exists. */
const existsAt = (input: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly root: string
  readonly relative: string
}): Effect.Effect<boolean> =>
  Effect.orElseSucceed(input.fs.exists(input.path.join(input.root, input.relative)), () => false)

/** The directories that look like UI roots: one holding `components` or `routes`. */
const uiRootsOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
): Effect.Effect<ReadonlyArray<string>> =>
  Effect.gen(function* () {
    const found: Array<string> = []
    const walk = (relative: string, depth: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (found.length >= 8 || depth > 4) return
        const entries: ReadonlyArray<string> = yield* Effect.orElseSucceed(
          fs.readDirectory(relative === "" ? root : path.join(root, relative)),
          () => [],
        )
        // `routes` alone is an API: a server router has routes and no components.
        // A UI root is the one that owns components.
        if (entries.includes("components")) {
          found.push(relative === "" ? "." : relative)
          return
        }
        for (const entry of entries) {
          if (NOT_UI.has(entry)) continue
          const child = relative === "" ? entry : relative + "/" + entry
          const directory = yield* Effect.orElseSucceed(
            fs.stat(path.join(root, child)).pipe(Effect.map((info) => info.type === "Directory")),
            () => false,
          )
          if (directory) yield* walk(child, depth + 1)
        }
      })
    yield* walk("", 0)
    return found
  })

/** The first file that exists among the candidates. */
const firstOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  candidates: ReadonlyArray<string>,
): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    for (const candidate of candidates) {
      if (yield* existsAt({ fs, path, root, relative: candidate })) return candidate
    }
    return undefined
  })

/** The alias targets a root's parent tsconfig declares, resolved to the repository. */
const aliasesOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  roots: ReadonlyArray<string>,
): Effect.Effect<Readonly<Record<string, ReadonlyArray<string>>>> =>
  Effect.gen(function* () {
    const normalise = (value: string): string => {
      const parts: Array<string> = []
      for (const part of value.split("/")) {
        if (part === "" || part === ".") continue
        if (part === "..") {
          parts.pop()
          continue
        }
        parts.push(part)
      }
      return parts.join("/")
    }
    const found = new Map<string, Array<string>>()
    for (const entry of roots) {
      const parent = entry.split("/").slice(0, -1).join("/")
      // A root that *is* the app directory keeps its tsconfig inside it (`apps/web`),
      // while a root one level down (`libs/ui/src`) keeps it in the parent. Reading only
      // the parent made every `@/…` import in a flat app unresolved: on a 7k-file
      // monorepo that was 3,484 orphans and a use-graph with almost no edges.
      const candidates = [
        entry === "." ? "tsconfig.json" : entry + "/tsconfig.json",
        parent === "" ? "tsconfig.json" : parent + "/tsconfig.json",
      ]
      for (const file of candidates) {
        const text = yield* Effect.orElseSucceed(fs.readFileString(path.join(root, file)), () => "")
        const directory = file.includes("/") ? file.slice(0, file.lastIndexOf("/")) : ""
        let matched = false
        for (const match of text.matchAll(/"([^"]+\/\*)"\s*:\s*\[\s*"([^"]+)"/gu)) {
          const key = match[1]
          const target = match[2]
          if (key === undefined || target === undefined) continue
          const resolved = normalise(directory === "" ? target : directory + "/" + target)
          const list = found.get(key) ?? []
          if (!list.includes(resolved)) list.push(resolved)
          found.set(key, list)
          matched = true
        }
        // The nearest config that declares paths wins; a config that only `extends`
        // another contributes nothing here, so the parent is still read.
        if (matched) break
      }
    }
    return Object.fromEntries(found)
  })

/** What one UI root's stylesheets and its tailwind config say about the design system. */
const tokensFor = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  roots: ReadonlyArray<string>,
): Effect.Effect<{
  readonly config: CutlistConfig["tokens"]
  readonly note?: string | undefined
}> =>
  Effect.gen(function* () {
    const CONFIGS = ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]
    const STYLES = [
      "app/tailwind.css",
      "app.css",
      "styles/app.css",
      "app/styles/app.css",
      "tailwind.css",
    ]
    const scores: Array<{
      readonly entry: string
      readonly from: string
      readonly vars: string | undefined
      readonly properties: number
      readonly colours: number
      readonly rootLayer: boolean
      readonly score: number
    }> = []
    for (const entry of roots) {
      const parent = entry.split("/").slice(0, -1).join("/")
      const config = yield* firstOf(
        fs,
        path,
        root,
        [entry, parent].flatMap((directory) =>
          CONFIGS.map((name) => (directory === "" ? name : directory + "/" + name)),
        ),
      )
      const css = yield* firstOf(
        fs,
        path,
        root,
        STYLES.map((name) => entry + "/" + name),
      )
      const configText =
        config === undefined
          ? ""
          : yield* Effect.orElseSucceed(fs.readFileString(path.join(root, config)), () => "")
      const cssText =
        css === undefined
          ? ""
          : yield* Effect.orElseSucceed(fs.readFileString(path.join(root, css)), () => "")
      const properties = [...cssText.matchAll(/--[\w-]+\s*:/gu)].length
      const colours = [...configText.matchAll(/#[0-9a-f]{3,8}\b/giu)].length
      const rootLayer = /:root\s*\{/u.test(cssText)
      scores.push({
        entry,
        from: config ?? css ?? "tailwind.config.ts",
        vars: css === undefined || config === undefined ? undefined : css,
        properties,
        colours,
        rootLayer,
        // A token layer is the thing being chosen: `:root` plus the properties it declares,
        // weighted against the palette its tailwind config carries. The first root alphabetically
        // used to win, which on a two-app repo picked the app with 7 tokens over the one with 31.
        score: (rootLayer ? 3 : 0) + properties + colours,
      })
    }
    const best = [...scores].sort(
      (left, right) => right.score - left.score || left.entry.localeCompare(right.entry),
    )[0]
    if (best === undefined) return { config: { from: "tailwind.config.ts" } }
    const config: CutlistConfig["tokens"] =
      best.vars === undefined ? { from: best.from } : { from: best.from, vars: best.vars }
    const other = scores.find((candidate) => candidate.entry !== best.entry)
    if (other === undefined || other.score === 0) return { config }
    // A two-app repo has two palettes and the draft describes one: say which one it left out,
    // with the numbers, so a person can disagree with the choice instead of finding it at 7 tokens.
    return {
      config,
      note:
        "tokens come from " +
        best.entry +
        " (" +
        String(best.colours) +
        " colour key(s), " +
        String(best.properties) +
        " custom propert" +
        (best.properties === 1 ? "y" : "ies") +
        (best.rootLayer ? ", a :root layer" : "") +
        "); " +
        other.entry +
        " keeps its own palette (" +
        String(other.colours) +
        " colour key(s), " +
        String(other.properties) +
        " custom propert" +
        (other.properties === 1 ? "y" : "ies") +
        (other.rootLayer ? "" : ", behind [data-theme]") +
        ") that this vocabulary does not describe",
    }
  })

/** A cutlist config inferred from common UI layouts, for a person to review. */
const cutlistDraftOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
): Effect.Effect<
  { readonly config: CutlistConfig; readonly note?: string | undefined } | undefined
> =>
  Effect.gen(function* () {
    const roots = yield* uiRootsOf(fs, path, root)
    if (roots.length === 0) return undefined
    const anyUnder = (suffix: string): Effect.Effect<boolean> =>
      Effect.map(
        Effect.forEach(roots, (entry) => existsAt({ fs, path, root, relative: entry + suffix })),
        (values) => values.some(Boolean),
      )
    const primitive = (yield* anyUnder("/components/ui")) ? ["components/ui"] : []
    const shared = (yield* anyUnder("/components")) ? ["components"] : []
    const local = (yield* anyUnder("/routes")) ? ["routes"] : []
    const alias = yield* aliasesOf(fs, path, root, roots)
    const tokens = yield* tokensFor(fs, path, root, roots)
    const draft: CutlistConfig = {
      $schema: "https://autotelic.dev/tackle/protocol/cutlist.config.json",
      roots,
      tiers: { primitive, shared, local },
      tokens: tokens.config,
      ownership: { routeOwner: "first-segment", transitive: false },
      // Spell the paths out: a reviewer should see what `build` will write, and
      // `jig init` uses the same map for `.gitattributes`.
      output: cutlistDefaultOutput,
    }
    const config = Object.keys(alias).length === 0 ? draft : { ...draft, alias }
    return tokens.note === undefined ? { config } : { config, note: tokens.note }
  })

/** The workspace directories a pnpm/npm workspace declares that actually hold a package. */
const workspaceDirsOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<string>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const text = files.includes("pnpm-workspace.yaml")
      ? yield* Effect.orElseSucceed(
          fs.readFileString(path.join(root, "pnpm-workspace.yaml")),
          () => "",
        )
      : ""
    const globs = [...text.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/gmu)]
      .map((match) => match[1])
      .filter((glob): glob is string => glob !== undefined && glob.endsWith("/*"))
    const found: Array<string> = []
    for (const glob of globs) {
      const prefix = glob.slice(0, -2)
      const entries = yield* Effect.orElseSucceed(
        fs.readDirectory(path.join(root, prefix)),
        () => [] as ReadonlyArray<string>,
      )
      for (const entry of [...entries].sort((left, right) => left.localeCompare(right))) {
        const relative = prefix + "/" + entry + "/package.json"
        if (yield* existsAt({ fs, path, root, relative })) found.push(prefix + "/" + entry)
      }
    }
    return found
  })

/**
 * Layers proposed from the workspace, and nothing more.
 *
 * A repo with no `architecture` block gets none of joggle's `layer-direction`
 * and `layer-purity` findings -- 184 real ones on the first adopter -- because nobody told it
 * that a domain package may not import React. The *include* set is decidable: the workspace
 * globs plus a package.json. The *order* and the `forbid` sets are judgement, so this draft
 * writes neither, and a person adds `forbid` where it is true.
 */
const architectureDraftOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  files: ReadonlyArray<string>,
): Effect.Effect<RepoProfile["architectureDraft"], never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const dirs = yield* workspaceDirsOf(fs, path, root, files)
    if (dirs.length < 2) return undefined
    const layers: Array<{ readonly name: string; readonly include: ReadonlyArray<string> }> =
      dirs.map((dir) => ({
        name: dir.slice(dir.lastIndexOf("/") + 1),
        include: [dir + "/**"],
      }))
    // A UI root that owns `components/ui` → `components` → `routes` is three layers, not one:
    // a single `services/ui/**` layer cannot see the direction the majority of findings live in.
    const uiRoots = yield* uiRootsOf(fs, path, root)
    for (const entry of uiRoots) {
      const name = entry.split("/").at(-1) ?? entry
      for (const [tier, directory] of [
        ["primitive", "components/ui"],
        ["shared", "components"],
        ["local", "routes"],
      ] as const) {
        if (yield* existsAt({ fs, path, root, relative: entry + "/" + directory })) {
          layers.push({ name: name + "-" + tier, include: [entry + "/" + directory + "/**"] })
        }
      }
    }
    return { layers }
  })

/** A repo's declared output paths with `cutlist`'s defaults filled in under them. */
const resolvedOutput = (declared: CutlistOutput | undefined): ResolvedCutlistOutput => {
  const values = Object.entries(cutlistDefaultOutput).map(([key, fallback]) => [
    key,
    (declared as Readonly<Record<string, string | undefined>> | undefined)?.[key] ?? fallback,
  ])
  // `diagrams` is opt-in, so it is copied rather than defaulted: no path, no rendering.
  return {
    ...(Object.fromEntries(values) as Required<Omit<CutlistOutput, "diagrams">>),
    diagrams: declared?.diagrams,
  }
}

/**
 * The directory a configured `cutlist` engine runs in, from its own `--cwd`.
 *
 * A repo may catalogue a tree that is not the root -- this repository catalyses its own
 * exemplar -- and cutlist reads its config from the directory it scans, not from the root.
 * `""` means the root, where cutlist's own default applies.
 */
const cutlistCwdOf = (configured: ReadonlyArray<EngineRef>): string => {
  const engine = configured.find((ref) => ref.id === "cutlist")
  const args = engine?.args ?? []
  const index = args.findIndex((arg) => arg === "--cwd")
  const directory = index < 0 ? "" : (args[index + 1] ?? "")
  return directory === "." ? "" : directory.replace(/\/+$/u, "")
}

/** Cutlist's output paths, seen from the repository root rather than the directory it scans. */
const underDirectory = (
  output: ResolvedCutlistOutput,
  directory: string,
): ResolvedCutlistOutput => {
  if (directory === "") return output
  const under = (path: string): string => directory + "/" + path
  const moved: Omit<ResolvedCutlistOutput, "diagrams"> = {
    catalog: under(output.catalog),
    manifest: under(output.manifest),
    menuJson: under(output.menuJson),
    menu: under(output.menu),
    intent: under(output.intent),
    patterns: under(output.patterns),
    patternsJson: under(output.patternsJson),
    recipes: under(output.recipes),
    recipesJson: under(output.recipesJson),
    hooks: under(output.hooks),
    tokens: under(output.tokens),
  }
  const diagrams = output.diagrams
  return diagrams === undefined ? moved : { ...moved, diagrams: under(diagrams) }
}

/**
 * The engines a plan carries: the ones the repo configured, plus what this run detected.
 *
 * A repo's own entry wins for the same id -- detection cannot reproduce the `args` a project
 * chose (`--ignore-pattern examples/**`, a second `oxlint` config for one package) -- and a
 * configured engine whose command no longer resolves is dropped, because an engine that
 * cannot run makes a report look clean when nothing ran.
 */
const mergeEngines = (input: {
  readonly configured: ReadonlyArray<EngineRef>
  readonly detected: ReadonlyArray<EngineRef>
  readonly root: string
  readonly notes: Array<string>
}): ReadonlyArray<EngineRef> => {
  const kept: Array<EngineRef> = []
  for (const engine of input.configured) {
    const command = engine.command ?? engine.id
    // `enabled: false` is the repo's own decision, and it needs no command to honour it.
    if (engine.enabled === false || available({ root: input.root, command })) {
      kept.push(engine)
      continue
    }
    input.notes.push(
      "engine `" +
        engine.id +
        "` is configured but `" +
        command +
        "` does not resolve; it was dropped from the plan",
    )
  }
  const ids = new Set(kept.map((engine) => engine.id))
  return [...kept, ...input.detected.filter((engine) => !ids.has(engine.id))]
}

/**
 * Read the repository, then decide what is worth enabling.
 *
 * @param root - The project root.
 * @param options - The gate mode the caller asked for, and whether a write may replace the config.
 * @returns the profile `init` writes from.
 */
export const inspectRepo = (
  root: string,
  options: {
    readonly gateMode?: "all" | "touched-files" | undefined
    readonly force?: boolean | undefined
  } = {},
): Effect.Effect<RepoProfile, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const files: ReadonlyArray<string> = yield* Effect.orElseSucceed(
      fs.readDirectory(root),
      () => [],
    )
    const configFile = path.join(root, "jig.config.json")
    const hasConfig = yield* Effect.orElseSucceed(fs.exists(configFile), () => false)
    const existing = hasConfig ? yield* loadConfig(configFile) : undefined
    const packageJson = yield* packageJsonOf(root)
    const packageManager = packageManagerOf(packageJson.packageManager, files)
    const scripts = packageJson.scripts
    const dependencies = packageJson.dependencies
    const localJig =
      files.includes("node_modules") &&
      (yield* Effect.orElseSucceed(
        fs.exists(path.join(root, "node_modules", ".bin", "jig")),
        () => false,
      ))
    const notes: Array<string> = []
    // A kept config is the effective config: do not show a gate the applied file does not
    // have. Only `--force` rewrites it, so only `--force` may change the gate here.
    const gateMode =
      existing !== undefined && options.force !== true
        ? existing.gate.mode
        : (options.gateMode ?? existing?.gate.mode ?? "touched-files")
    if (
      existing !== undefined &&
      options.force !== true &&
      options.gateMode !== undefined &&
      options.gateMode !== existing.gate.mode
    ) {
      notes.push(
        `jig.config.json keeps its \`${existing.gate.mode}\` gate; pass --force to apply \`${options.gateMode}\``,
      )
    }
    const jigPinned = localJig || dependencies["@autotelic/jig-cli"] !== undefined
    const jig = jigCommandOf(packageManager, jigPinned)
    // The CLI has to be on the machine before any of this runs. A tree that builds jig is
    // the honest source for it -- the package is not on npm -- and a repo that only depends
    // on it wants the published one.
    const jigSource = (yield* existsAt({
      fs,
      path,
      root,
      relative: "packages/jig-cli/package.json",
    }))
      ? "./packages/jig-cli"
      : "@autotelic/jig-cli"
    // Agent surfaces already wired: the prompt says "keep this", not "add another".
    const hosts = new Set<"opencode" | "pi">()
    if (yield* existsAt({ fs, path, root, relative: ".pi/settings.json" })) hosts.add("pi")
    if (
      files.includes("opencode.json") ||
      (yield* existsAt({ fs, path, root, relative: ".opencode/plugins" }))
    ) {
      hosts.add("opencode")
    }
    if (!jigPinned) {
      notes.push(
        "jig resolves from PATH; pin @autotelic/jig-cli as a devDependency so CI runs the same version",
      )
    }
    // A repo that already gates these findings with its own ledger (an oxlint baseline, say)
    // does not want a second one silently: two ledgers over one rule set means neither is the
    // record of what was reviewed.
    const ownLedger = existing?.gate.baseline ?? ".jig-baseline.json"
    const otherLedgers = files.filter(
      (file) => file !== ownLedger && file.endsWith(".json") && /baseline/iu.test(file),
    )
    if (otherLedgers.length > 0) {
      notes.push(
        "another ledger is already here (" +
          otherLedgers.join(", ") +
          "); jig keeps `" +
          ownLedger +
          "` — decide which one owns these findings before enabling the gate",
      )
    }
    const agentDocs = ["AGENTS.md", "CLAUDE.md", ".cursorrules"].filter((file) =>
      files.includes(file),
    )
    const typescript = yield* hasTypeScript(fs, path, root, files)
    const ci = yield* Effect.orElseSucceed(
      fs.exists(path.join(root, ".github", "workflows")),
      () => false,
    )
    const cutlist = yield* cutlistDraftOf(fs, path, root)
    const cutlistDraft = cutlist?.config
    if (cutlist?.note !== undefined) notes.push(cutlist.note)
    const architectureDraft = yield* architectureDraftOf(fs, path, root, files)
    const summary = yield* repositorySummaryOf({
      fs,
      path,
      root,
      files,
      fallback: packageJson.description,
    })
    const liveJudgement =
      process.env.TYPESAFE_API_KEY !== undefined && process.env.TYPESAFE_API_KEY !== ""
    const script = Option.getOrUndefined(oxlintScriptOf(scripts))
    const config = script?.config ?? Option.getOrUndefined(oxlintConfigOf(files))
    const configText =
      config === undefined
        ? ""
        : yield* Effect.orElseSucceed(fs.readFileString(path.join(root, config)), () => "")
    const lint =
      config !== undefined || script !== undefined
        ? { tool: "oxlint" as const, config, script: script?.script }
        : files.includes("eslint.config.mjs") ||
            files.includes("eslint.config.js") ||
            files.includes("eslint.config.cjs") ||
            files.includes("eslint.config.ts") ||
            files.includes("eslint.config.mts") ||
            files.includes(".eslintrc.json") ||
            files.includes(".eslintrc.yml") ||
            files.includes(".eslintrc.yaml") ||
            files.includes(".eslintrc.cjs") ||
            files.includes(".eslintrc")
          ? { tool: "eslint" as const, config: undefined, script: undefined }
          : files.includes("biome.json") || files.includes("biome.jsonc")
            ? { tool: "biome" as const, config: "biome.json", script: undefined }
            : { tool: "none" as const, config: undefined, script: undefined }

    const commandNames = ["lint", "typecheck", "test", "format", "check"].filter(
      (name) => scripts[name] !== undefined,
    )
    if (
      script?.script !== undefined &&
      !commandNames.includes(script.script) &&
      scripts[script.script] !== undefined
    ) {
      commandNames.push(script.script)
    }
    const commands = commandNames.map((name) => ({
      name,
      command: packageManager + " " + name,
    }))

    const detected: Array<EngineRef> = []

    if (lint.tool === "oxlint" && lint.config !== undefined) {
      if (!available({ root, command: "oxlint" })) {
        notes.push("plumb not enabled: oxlint is not installed here (pnpm add -D oxlint)")
      } else if (!loadsPlumb(configText)) {
        notes.push(
          "plumb not enabled: " + lint.config + " does not load @autotelic/plumb in jsPlugins",
        )
      } else {
        detected.push(
          script?.args === undefined || script.args.length === 0
            ? { id: "plumb", kind: "oxlint-plugin", command: "oxlint", config: lint.config }
            : {
                id: "plumb",
                kind: "oxlint-plugin",
                command: "oxlint",
                config: lint.config,
                args: script.args,
              },
        )
        if (
          resolveEngineCommand({ root, command: "oxlint" }) === "oxlint" &&
          dependencies["oxlint"] === undefined
        ) {
          notes.push(
            "oxlint resolves from PATH; pin it as a devDependency so CI uses the same version",
          )
        }
      }
    } else if (lint.tool === "eslint" || lint.tool === "biome") {
      notes.push(
        "plumb not enabled: this repo lints with " + lint.tool + ", and plumb is an oxlint plugin",
      )
    } else {
      notes.push("plumb not enabled: no oxlint config found")
    }

    if (typescript) {
      if (!available({ root, command: "joggle" })) {
        notes.push(
          "joggle not enabled: joggle is not installed here (pnpm add -D @autotelic/joggle)",
        )
      } else {
        // A replay is not a look, and an untyped check misses the Effect rules: both are
        // correctness, not taste. `--typecheck` stays off on purpose -- its tsgo run ignores
        // each package's tsconfig (`jsx`, `paths`) and reports tens of thousands of false
        // errors on a monorepo. The engine owns its own baseline so the ratchet key is
        // `rule + file set`, which does not churn when a line moves.
        detected.push({
          id: "joggle",
          kind: "process",
          command: "joggle",
          config: "joggle.config.json",
          args: [...(typescript ? ["--types"] : []), "--no-replay", "--baseline", JOGGLE_BASELINE],
        })
        if (
          resolveEngineCommand({ root, command: "joggle" }) === "joggle" &&
          dependencies["@autotelic/joggle"] === undefined
        ) {
          notes.push(
            "joggle resolves from PATH; pin @autotelic/joggle as a devDependency so CI uses the same version",
          )
        }
      }
    } else {
      notes.push("joggle not enabled: no tsconfig found")
    }

    const mapperConfig = ["tsconfig.json", "tsconfig.base.json"].find((file) =>
      files.includes(file),
    )
    if (mapperConfig !== undefined) {
      const text = yield* Effect.orElseSucceed(
        fs.readFileString(path.join(root, mapperConfig)),
        () => "",
      )
      if (text.includes("contentMappers")) {
        notes.push(
          "content mappers are declared in " +
            mapperConfig +
            ": joggle will report the extensions it cannot index; runExternalCode stays off until trusted",
        )
      }
    }

    // The configured paths, not the defaults, are what `.gitattributes` must describe: a
    // repo that moved the artifact still gets its own files collapsed. The config is read
    // where the engine scans, so a catalog generated under `examples/` is described too.
    const cutlistDirectory = cutlistCwdOf(existing?.engines ?? [])
    const cutlistPath =
      cutlistDirectory === "" ? "cutlist.config.json" : cutlistDirectory + "/cutlist.config.json"
    const keepsCutlist = yield* existsAt({ fs, path, root, relative: cutlistPath })
    const installedCutlist = keepsCutlist
      ? decodeCutlistConfig(
          parseJson(
            yield* Effect.orElseSucceed(fs.readFileString(path.join(root, cutlistPath)), () => ""),
          ),
        )
      : undefined
    const cutlistExisting =
      installedCutlist === undefined || keepsCutlist !== true
        ? undefined
        : { path: cutlistPath, directory: cutlistDirectory }
    const cutlistOutput =
      installedCutlist === undefined && cutlistDraft === undefined
        ? undefined
        : underDirectory(
            resolvedOutput(installedCutlist?.output ?? cutlistDraft?.output),
            cutlistDirectory,
          )

    if (files.includes("cutlist.config.json")) {
      if (!available({ root, command: "cutlist" })) {
        notes.push(
          "cutlist not enabled: cutlist.config.json exists but the command is not installed",
        )
      } else {
        detected.push({ id: "cutlist", kind: "process", command: "cutlist" })
        if (
          resolveEngineCommand({ root, command: "cutlist" }) === "cutlist" &&
          dependencies["@autotelic/cutlist"] === undefined
        ) {
          notes.push(
            "cutlist resolves from PATH; pin @autotelic/cutlist as a devDependency so CI uses the same version",
          )
        }
      }
    } else if (cutlistDraft !== undefined) {
      notes.push(
        "cutlist not enabled: no cutlist.config.json, though this looks like a UI (" +
          cutlistDraft.roots.join(", ") +
          "); run `jig init --cutlist` to draft one",
      )
    }

    // The room is the same product as the harness: a repo that keeps one -- or builds one --
    // wants its commands in the docs, and a room without a config is "not initialised", not
    // "configured".
    const room =
      files.includes("room.config.json") ||
      dependencies["@autotelic/room"] !== undefined ||
      (yield* existsAt({ fs, path, root, relative: "packages/room/package.json" }))
    if (room && !files.includes("room.config.json")) {
      notes.push(
        "room not initialised: no room.config.json; `" +
          jig +
          " room plan` prints the init it would run",
      )
    }

    // A repo's engine list is a decision, not a detection artefact: a forced run adds what
    // this run found and drops what no longer resolves, but it never erases an engine the
    // repo configured.
    const engines = mergeEngines({
      configured: existing?.engines ?? [],
      detected,
      root,
      notes,
    })

    return {
      root,
      name: path.basename(root),
      packageManager,
      run: packageManager,
      jig,
      facts: new Set([
        ...(files.includes("pnpm-workspace.yaml") || files.includes("lerna.json")
          ? (["workspaces"] as const)
          : []),
        ...(typescript ? (["typescript"] as const) : []),
        ...(liveJudgement ? (["live-judgement"] as const) : []),
        ...(ci ? (["ci"] as const) : []),
        ...(hasConfig ? (["configured"] as const) : []),
        ...(room ? (["room"] as const) : []),
      ]),
      agentDocs,
      summary,
      commands,
      lint,
      engines,
      notes,
      gateMode,
      baseline: existing?.gate.baseline ?? ".jig-baseline.json",
      cookbook: existing?.agent?.cookbook ?? "JIG.md",
      onboarding: existing?.agent?.onboarding ?? "ONBOARD.md",
      jigSource,
      hosts,
      cutlistDraft,
      architectureDraft,
      cutlistOutput,
      cutlistExisting,
    }
  })

/** The config `init` writes: only the engines that resolved, and the friendly gate. */
export const configFor = (profile: RepoProfile): HarnessConfig => ({
  $schema: "https://autotelic.dev/tackle/protocol/jig.config.json",
  engines: profile.engines,
  gate: { mode: profile.gateMode, baseline: profile.baseline, failOn: "any-new" },
  report: { format: "text", maxWarnings: -1 },
  agent: { cookbook: profile.cookbook, onboarding: profile.onboarding },
})

/** One line per engine, for the summary and the generated docs. */
const engineSummary = (profile: RepoProfile): string =>
  profile.engines.length === 0
    ? "none — see the notes below"
    : profile.engines
        .map((engine) =>
          engine.config === undefined ? engine.id : `${engine.id} (${engine.config})`,
        )
        .join(", ")

/** The room's commands, for the repositories that run one. */
const roomSection = (profile: RepoProfile): string =>
  profile.facts.has("room")
    ? `## The room

\`jig room\` is this repo's listener: one ledger per Linear project, a daemon on each
machine, and a review job that runs \`${profile.jig}\`, a Pi, and one fenced post.

- \`${profile.jig} room plan\` — read the repo, the token, and the rooms; print the init it would run
- \`${profile.jig} room init\` — write \`room.config.json\` and register the room
- \`${profile.jig} room doctor\` — prove the loop: config, identity, celld, pi, the forward, the room
- \`${profile.jig} room dev\` — run the room locally with \`celld dev\`
- \`${profile.jig} room webhook\` — print the \`gh webhook forward\` command for this room
- \`${profile.jig} room daemon\` — claim jobs, run reviews, wake the project session
- \`${profile.jig} room work --pr N\` — a worktree, an app, and an attachable Pi session
- \`${profile.jig} room board\` — jobs, chits, and presence

\`${profile.jig} room doctor\` names the prerequisites this machine is missing — \`celld\`,
the \`gh webhook\` extension, a Linear token at \`~/.linearis/token\`, \`pi\` on PATH — so the
list never goes stale here. \`hc\` (herdr-core) is only needed by \`room work\`.

`
    : ""

/** One blank line between sections, however the template was assembled. */
const tighten = (text: string): string => text.replace(/\n{3,}/gu, "\n\n")

/** The durable cookbook: what the commands are, and what the gate means. */
export const cookbookFor = (profile: RepoProfile): string =>
  tighten(`# JIG.md

The conformance harness for ${profile.name}. \`jig\` runs the engines this repo
configures, merges their output into one report, and holds the ratchet: a run fails
on new findings, not on debt this repo has already accepted.
${profile.summary === "" ? "" : "\n" + profile.summary + "\n"}

## Commands

| Command | What it does |
| --- | --- |
| \`${profile.jig} check\` | every engine, one report, fail on what is new |
| \`${profile.jig} check --limit 50\` | the census and the first 50 findings |
| \`${profile.jig} engines\` | what is configured, and whether each command resolves |
| \`${profile.jig} baseline\` | accept the current findings; the ledger only shrinks after that |
| \`${profile.jig} explain <rule>\` | everything jig knows about one rule, here, now |
${profile.facts.has("room") ? "| `" + profile.jig + " room board` | the room: jobs, chits, and presence |\n" : ""}${profile.engines.some((engine) => engine.id === "cutlist") ? "| `" + profile.jig + " menu` | the component catalog cutlist built |\n" : ""}${profile.commands.length === 0 ? "" : "\n## The repo's own commands\n\n" + profile.commands.map((command) => "- `" + command.command + "` — the repo's " + command.name + " script").join("\n") + "\n"}

## What runs

- engines: ${engineSummary(profile)}
- gate: \`${profile.gateMode}\`, failing on \`any-new\` identity
- baseline: \`${profile.baseline}\`
${profile.notes.length === 0 ? "" : "\nNotes:\n" + profile.notes.map((note) => "- " + note).join("\n") + "\n"}
${roomSection(profile)}${
    profile.gateMode === "touched-files"
      ? "Only findings in the change in front of you fail a run. Existing debt is reported,\nnot enforced, until you touch it."
      : "Every finding in the repository fails a run. Accept the current debt deliberately\nwith `" +
        profile.jig +
        " baseline`, or switch the gate to `touched-files`."
  }

${profile.facts.has("ci") ? "## CI\n\nRun `" + profile.jig + " check --format github` in the pull-request workflow. The gate holds new identities only, so the first run explains the debt instead of failing on it. For machine output (`--format json`, `sarif`, `github`), use `" + profile.run + " exec jig`: `" + profile.run + " jig` prepends the package manager's own engine warning to stdout and corrupts the document.\n\n" : ""}## Judgement

joggle judges candidates with the TypeSafe model. ${profile.facts.has("live-judgement") ? "A TYPESAFE_API_KEY is present in this environment, so a run can judge." : "No TYPESAFE_API_KEY is present in this environment, so unjudged candidates are counted, not printed. Set the key to judge, or keep the count in CI."}

## Reading a finding

A finding is a place, a sentence, and a rule id. \`${profile.jig} explain <rule>\` shows
the rule's findings here, the help text, and whether it is one you can fix now.

A **note** on an engine means "not looked at": a missing command, a skipped rule, or
candidates the model did not judge. It is never "clean".

## The one rule

Do not run \`${profile.jig} baseline\` to make a run green without reading what it
accepts. The baseline is a reviewed ledger, not a mute button.
`)

/**
 * How a person types a tool in this repo: through the package manager when the project has
 * its own copy, plainly when a global one is the only one there is. `jig engines` already
 * resolves this for spawning; the next steps a human reads must agree with it, or the paste
 * tells them to type a command that is not on PATH.
 */
const invocationOf = (input: {
  readonly profile: RepoProfile
  readonly tool: string
  readonly args: string
}): string =>
  resolveEngineCommand({ root: input.profile.root, command: input.tool }) === input.tool
    ? input.tool + " " + input.args
    : input.profile.run + " exec " + input.tool + " " + input.args

/** The `init` invocation that reproduces this plan, including the gate it chose. */
const initCommandFor = (profile: RepoProfile): string =>
  `${profile.jig} init${profile.gateMode === "all" ? " --gate all" : ""}${profile.cutlistDraft === undefined ? "" : " --cutlist"}`

// Keyed by manager so the compiler, not a reader, proves every case is covered: the
// global install verb, the devDependency verb, and where the bins land are each different.
const GLOBAL_INSTALL = {
  bun: (spec: string) => `bun add -g ${spec}`,
  npm: (spec: string) => `npm install -g ${spec}`,
  pnpm: (spec: string) => `pnpm add -g ${spec}`,
  yarn: (spec: string) => `yarn global add ${spec}`,
} satisfies Readonly<Record<PackageManager, (spec: string) => string>>

const DEV_INSTALL = {
  bun: "bun add -D",
  npm: "npm install -D",
  pnpm: "pnpm add -D",
  yarn: "yarn add -D",
} satisfies Readonly<Record<PackageManager, string>>

/** Installing a devDependency here: a pnpm workspace root refuses it without `-w`. */
const devInstallOf = (profile: RepoProfile): string =>
  profile.packageManager === "pnpm" && profile.facts.has("workspaces")
    ? "pnpm add -Dw"
    : DEV_INSTALL[profile.packageManager]

const GLOBAL_BIN_HINT = {
  bun: "`bun` links bins into `$HOME/.bun/bin`: add it to PATH, open a new shell, and try again",
  npm: "add `$(npm prefix -g)/bin` to PATH, open a new shell, and try again",
  pnpm: "run `pnpm setup` (it puts `pnpm bin -g` on PATH), open a new shell, and try again",
  yarn: "add `$(yarn global bin)` to PATH, open a new shell, and try again",
} satisfies Readonly<Record<PackageManager, string>>

/**
 * The agent door: one prompt, pasted whole, that sets the harness up end to end.
 *
 * The shape is the one that works -- Alchemy's and rat-stack's: a line of intent, one
 * named command per step, the doc to read before acting, and an explicit place to stop
 * and ask. Nothing is left as "see the README": a prompt that stops at "run init" leaves
 * the person to discover the CLI install, the agent wiring, and the room alone. `JIG.md`
 * stays the reference; this is the door.
 */
export const onboardingFor = (profile: RepoProfile): string => {
  let counted = 0
  const section = (title: string): string => `## ${(counted += 1)}. ${title}`
  const summary = profile.summary === "" ? "" : "\n\n" + profile.summary
  const source = profile.jigSource.startsWith(".")
    ? `\n\n\`${profile.jigSource}\` is this checkout: build it first (\`${profile.run} build\`, or \`${profile.run} --filter @autotelic/jig-cli build\`), and build again after a change to the CLI -- the installed bin runs \`dist/\`, not the source.`
    : ""
  const engines = profile.engines.length === 0 ? "none yet" : engineSummary(profile)
  const readFirst = [
    `- \`${profile.cookbook}\` — the commands, the gate, and what a note means. Read it before you run anything.`,
    `- \`jig.config.json\` — engines: ${engines}; gate: \`${profile.gateMode}\`; baseline: \`${profile.baseline}\`.`,
    ...(profile.agentDocs.length === 0
      ? []
      : [
          `- ${profile.agentDocs.map((doc) => "`" + doc + "`").join(", ")} — how this repository wants to be worked in.`,
        ]),
  ].join("\n")
  const initialise = [
    profile.facts.has("configured")
      ? `\`jig.config.json\` is already here, and nothing needs applying: a re-run keeps it. \`${initCommandFor(profile)} --force\` rewrites the config and the two docs — never the baseline — so run that only when the plan changes.`
      : `This repository is not initialised yet. Run \`${initCommandFor(profile)}\`: it writes \`jig.config.json\`, an empty \`${profile.baseline}\`, \`${profile.cookbook}\`, and \`${profile.onboarding}\`.`,
    profile.cutlistDraft === undefined
      ? ""
      : `The same command drafts \`cutlist.config.json\`, because this tree looks like a UI. Review the vocabulary it infers, run \`${invocationOf({ profile, tool: "cutlist", args: "build" })}\`, commit the catalog, then re-run with \`--force\`. A draft is not enabled before a person has read it.`,
    `Init writes each engine's own ledger too (joggle's is born accepted, and is never rewritten), so day one is "nothing new" rather than a pile nobody has judged.`,
    profile.architectureDraft === undefined
      ? ""
      : `The same run drafts \`architecture.layers\` in \`joggle.config.json\` from this workspace: includes only, in directory order, with \`layer-direction\`/\`layer-purity\` off, because neither the order nor the \`forbid\` sets can be inferred from a tree. Order the layers by what depends on what, add \`forbid\` where it is true, then turn those two rules on -- until then a clean architecture report means nothing looked.`,
    `Then \`${profile.jig} check --limit 20\`: read the census before the findings. An engine marked \`skipped\`, \`replayed\`, or "candidates not judged" did not look, and a note is never a pass.`,
    "Secrets are the environment and the host owns them: if a run needs a key this session was not started with, say so and stop. Never add a loader, and never nest a second `doppler run` from this directory -- it resolves the project from the working directory's `doppler.yaml`, so the layer you think you added is not the one that wins.",
  ]
    .filter((line) => line !== "")
    .join("\n\n")
  const piWired = profile.hosts.has("pi")
  const opencodeWired = profile.hosts.has("opencode")
  const wire = [
    piWired
      ? "- **pi** is already wired here (`.pi/settings.json`): run `pi update --extensions` rather than adding a second entry."
      : `- **pi**: \`pi install ${profile.jigSource} --local\` writes \`.pi/settings.json\`, and the package's extension adds \`jig_check\`, \`jig_engines\`, \`jig_onboard\`, \`jig_init\`, and \`jig_menu\`.`,
    opencodeWired
      ? '- **OpenCode** is already wired here: keep the existing `"plugin"` entry or `.opencode/plugins/` file rather than adding another.'
      : '- **opencode**: add `"@autotelic/jig-cli/opencode"` to `"plugin"` in `opencode.json`, and the plugin adds `jig.check`, `jig.engines`, `jig.menu`, `jig.onboard`, and `jig.init`.',
    // A repo that denies every tool by default makes a plugin that adds tools invisible, and
    // the failure looks like "the plugin did not load" rather than "the tools are off".
    opencodeWired
      ? ""
      : '- If that OpenCode config denies tools wholesale (`"tools": { "*": false }`), allow `jig.*` explicitly or the plugin\'s tools stay invisible.',
    piWired || opencodeWired ? "" : "Ask me which host I use if neither file exists.",
  ]
    .filter((line) => line !== "")
    .join("\n")
  const room = (): string =>
    profile.facts.has("room")
      ? `${section("The room — **STOP and ask**")}

This repository keeps a project room: one ledger per Linear project, a daemon on this
machine, and a review job that runs jig, a Pi, and one fenced post.

\`\`\`sh
${profile.jig} room plan            # read it, then show me the init line and wait
${profile.jig} room init            # only after I approve: writes room.config.json, registers the room
${profile.jig} room doctor          # names what is missing on this machine
${profile.jig} room dev             # the room, locally
${profile.jig} room webhook | sh    # forward GitHub events to it
${profile.jig} room daemon          # its own terminal: claims jobs, wakes the session
\`\`\`

Ask before installing anything doctor names. What the checks mean:

- \`celld\` — the room itself: \`curl -fsSL https://celld.dev/install.sh | sh\`
- \`gh webhook\` — the GitHub forward: \`gh extension install cli/gh-webhook\`
- a Linear token at \`~/.linearis/token\` (\`linearis\`), when this room watches Linear
- \`pi\` — the review and the session wake both run it, so it has to be on PATH

\`hc\` (herdr-core) is only needed by \`${profile.jig} room work\`, and the wake needs the machine
awake: a sleeping laptop is a hosting problem, not a bug.

`
      : ""
  const notes = (): string =>
    profile.notes.length === 0
      ? ""
      : `${section("What this scan already found")}

${profile.notes.map((note) => "- " + note).join("\n")}`
  return tighten(`# ${profile.onboarding}

> Paste this whole file into your coding agent at the root of \`${profile.name}\`. It sets the
> harness up end to end; nothing here is applied until the agent runs it.

Set \`${profile.name}\` up with \`jig\`, the conformance harness this repository configures: every
engine in one report, and a gate that fails on what is new.${summary}

Run the steps in order, running the commands yourself. When a step says **STOP and ask**,
stop and wait for me.

${section("Put `jig` on this machine")}

The CLI is the one thing that belongs to the machine rather than the repository.

\`\`\`sh
${GLOBAL_INSTALL[profile.packageManager](profile.jigSource)}
jig --version
\`\`\`

If \`jig\` is not found, the global bin directory is not on PATH: ${GLOBAL_BIN_HINT[profile.packageManager]}.${source}

If the install itself fails with a 404, the package is not on the registry yet: ask me for a checkout and link it instead (\`${devInstallOf(profile)} link:<checkout>/packages/jig-cli\`), then point pi at the linked copy (\`pi install ./node_modules/@autotelic/jig-cli --local\`) — an unpublished name is treated as a relative path.

${section("Read what this repository already decided")}

${readFirst}

${profile.facts.has("configured") ? "" : "`" + profile.cookbook + "` and `jig.config.json` do not exist yet: step 4 writes them, and what is written is the plan's defaults. Read both the moment they land.\n\n"}Then run \`${profile.jig} engines\` and confirm every configured engine resolves.

${section("Install what is missing — **STOP and ask**")}

Engines are devDependencies here, never global installs: \`${devInstallOf(profile)} <package>\`, then \`${profile.jig} engines\` again. Before you install anything, tell me the engine, the package, and what the census says is missing.

${section("Initialise, then read the census")}

${initialise}

${section("Commit it, or say it is local-only — **STOP and ask**")}

\`git status\` after init: the harness is config, two docs, a ledger, and a generated block. If any of them is *ignored* here, stop and tell me, because a harness git cannot see gates this machine and nothing else — no CI, no reviewer, no second machine. Do not edit \`.gitignore\` without asking; the baseline and the gate are worth nothing to anyone who cannot check out the record.

${section("Wire this agent")}

${wire}

${room()}${section("Report, then stop")}

Tell me what you installed, what \`${profile.jig} init\` wrote and kept, the census, and the first findings. Then wait for me.

${section("Never, without asking me")}

- \`${profile.jig} baseline\` — it accepts every current finding, and an unreviewed baseline is debt made invisible.
- Changing the gate ${profile.gateMode === "all" ? "back to `touched-files`" : "to `all`"}, or adding an ignore to get green.
- Installing an engine, or anything else globally. Step 1 is the one exception.
${profile.facts.has("room") ? "- `" + profile.jig + " room init`, which registers the room against Linear.\n" : ""}- Changing \`jig.config.json\` by hand instead of re-running \`init\`.

${notes()}

An engine marked \`skipped\`, \`replayed\`, or "no command" is a hole in the census, not a pass and not a finding to fix in the code.
`)
}

/** What happened to cutlist: a config it already keeps, a draft it wants reviewed, or nothing. */
const cutlistSummary = (result: InitResult): string => {
  if (result.cutlistConfig === "written") {
    return result.dryRun
      ? "draft would be written — review it after applying"
      : "draft written — review, build, then re-run init --force"
  }
  const existing = result.profile.cutlistExisting
  return existing === undefined ? result.cutlistConfig : `configured (${existing.path})`
}

/** The human summary `init` prints, before the next steps. */
export const summaryFor = (result: InitResult): string => {
  const { profile } = result
  const action = result.dryRun ? "would write" : "wrote"
  const keptAction = result.dryRun ? "would keep" : "kept"
  const lines = [
    `${result.dryRun ? "jig: plan for" : "jig: initialised"} ${profile.root}`,
    "",
    `  package manager  ${profile.packageManager}`,
    `  workspaces       ${profile.facts.has("workspaces") ? "yes" : "no"}`,
    `  typescript       ${profile.facts.has("typescript") ? "yes" : "no"}`,
    `  lint             ${profile.lint.config ?? profile.lint.tool}${profile.lint.script === undefined ? "" : " via `" + profile.run + " " + profile.lint.script + "`"}`,
    `  agent docs       ${profile.agentDocs.length === 0 ? "none found" : profile.agentDocs.join(", ") + " (left untouched)"}`,
    `  engines          ${engineSummary(profile)}`,
    `  gate             ${profile.gateMode}`,
    `  baseline         ${profile.baseline} (${result.accepted} accepted finding(s))`,
    `  cutlist          ${cutlistSummary(result)}`,
    ...(result.gitattributes === "absent"
      ? []
      : [`  gitattributes    ${result.gitattributes} (generated block only)`]),
    `  ${action.padEnd(16)} ${result.written.length === 0 ? "nothing" : result.written.join(", ")}`,
    ...(result.kept.length === 0 ? [] : [`  ${keptAction.padEnd(16)} ${result.kept.join(", ")}`]),
    ...result.engineBaselines.map(
      (baseline) =>
        `  ${"engine ledger".padEnd(16)} ${baseline.path} — ${baseline.action}${baseline.accepted === 0 ? "" : ` ${baseline.accepted} finding(s)`}`,
    ),
    ...(result.ignored.length === 0
      ? []
      : [
          `  ${"gitignored".padEnd(16)} ${result.ignored.join(", ")} — local-only: no CI can run what git cannot see`,
        ]),
    ...profile.notes.map((note) => `  note             ${note}`),
    "",
    "Next:",
    ...(result.dryRun
      ? [
          `  1. ${profile.jig} init${profile.gateMode === "all" ? " --gate all" : ""}${result.cutlistConfig === "written" ? " --cutlist" : ""}     write this plan after approval`,
          `  2. ${profile.jig} engines     confirm each command resolves`,
          `  3. ${profile.jig} check --limit 20     census, then the first 20 findings`,
          `  4. paste ${profile.onboarding} into your agent`,
        ]
      : profile.engines.length === 0
        ? ["  1. install at least one engine (see the notes above)", "  2. re-run jig init --force"]
        : [
            `  1. ${profile.jig} engines     confirm each command resolves`,
            `  2. ${profile.jig} check --limit 20     census, then the first 20 findings`,
            ...(result.cutlistConfig === "written"
              ? [
                  `  3. ${invocationOf({ profile, tool: "cutlist", args: "build" })}     review the catalog, commit it, then re-run jig init --force`,
                  `  4. paste ${profile.onboarding} into your agent`,
                ]
              : [`  3. paste ${profile.onboarding} into your agent`]),
          ]),
  ]
  return lines.join("\n")
}

/** The plan as data, for a host that wants to reason about it rather than read prose. */
export const initJson = (result: InitResult, prompt?: string): string => {
  const profile = { ...result.profile, facts: [...result.profile.facts] }
  const plan = {
    dryRun: result.dryRun,
    written: result.written,
    kept: result.kept,
    joggleConfig: result.joggleConfig,
    cutlistConfig: result.cutlistConfig,
    gitattributes: result.gitattributes,
    accepted: result.accepted,
  }
  return JSON.stringify(
    prompt === undefined ? { profile, plan } : { profile, plan, prompt },
    null,
    2,
  )
}

/**
 * The written paths git here refuses to track.
 *
 * `jig init` writes a config, two docs, a ledger, and a generated block. A repository can
 * ignore every one of them -- the first adopter we ran against ignores all seven -- and then
 * the harness is local-only: no CI runs it, the baseline never reaches a reviewer, and
 * `JIG.md`'s "run `jig check --format github` in the pull-request workflow" cannot be done.
 * `init` cannot change the ignore rules; it can refuse to call that a clean write.
 *
 * @param input - The repository root and the paths to test.
 * @returns The paths git reports as ignored; empty when git cannot answer.
 */
const ignoredByGit = (input: {
  readonly root: string
  readonly files: ReadonlyArray<string>
}): Effect.Effect<ReadonlyArray<string>, never, Spawner> =>
  input.files.length === 0
    ? Effect.succeed([])
    : Effect.match(
        exec({ binary: "git", args: ["check-ignore", "--", ...input.files], cwd: input.root }),
        {
          onFailure: () => [],
          onSuccess: (outcome) =>
            outcome.code === 0
              ? outcome.stdout
                  .split("\n")
                  .map((line) => line.trim())
                  .filter((line) => line !== "")
              : [],
        },
      )

/** Write one generated file unless it already exists, and record which happened. */
const writeIfAbsent = (input: {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly root: string
  readonly file: string
  readonly body: string
  readonly force: boolean
  readonly write: boolean
  readonly written: Array<string>
  readonly kept: Array<string>
}) =>
  Effect.gen(function* () {
    const target = input.path.join(input.root, input.file)
    const exists = yield* Effect.orElseSucceed(input.fs.exists(target), () => false)
    if (exists && !input.force) {
      input.kept.push(input.file)
      return
    }
    if (input.write) yield* input.fs.writeFileString(target, input.body)
    input.written.push(input.file)
  })

/**
 * Inspect a repository and write the harness it should have.
 *
 * @param root - The project root.
 * @param options - Gate mode, and whether generated files may be rewritten.
 * @returns the profile, and what was written versus kept.
 */
export const initialise = (
  root: string,
  options: {
    readonly force?: boolean | undefined
    readonly gateMode?: "all" | "touched-files" | undefined
    readonly cutlist?: boolean | undefined
    readonly dryRun?: boolean | undefined
  } = {},
): Effect.Effect<
  InitResult,
  PlatformError.PlatformError,
  FileSystem.FileSystem | Path.Path | Spawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let profile = yield* inspectRepo(root, {
      gateMode: options.gateMode,
      force: options.force,
    })
    const written: Array<string> = []
    const kept: Array<string> = []
    const force = options.force === true
    const dryRun = options.dryRun === true

    yield* writeIfAbsent({
      fs,
      path,
      root,
      file: "jig.config.json",
      body: `${JSON.stringify(configFor(profile), null, 2)}\n`,
      force,
      write: !dryRun,
      written,
      kept,
    })
    let cutlistConfig: InitResult["cutlistConfig"] = "absent"
    if (profile.cutlistDraft !== undefined) {
      const target = path.join(root, "cutlist.config.json")
      if (yield* Effect.orElseSucceed(fs.exists(target), () => false)) {
        cutlistConfig = "kept"
        kept.push("cutlist.config.json")
      } else if (options.cutlist === true) {
        if (!dryRun) {
          yield* fs.writeFileString(target, `${JSON.stringify(profile.cutlistDraft, null, 2)}\n`)
        }
        cutlistConfig = "written"
        written.push("cutlist.config.json")
        profile = {
          ...profile,
          notes: [
            ...profile.notes.filter((note) => !note.startsWith("cutlist not enabled")),
            "cutlist draft written: review cutlist.config.json, run `" +
              invocationOf({ profile, tool: "cutlist", args: "build" }) +
              "`, then re-run `jig init --force` to enable it",
          ],
        }
      }
    }

    // `.gitattributes` is shared with the repo, so this merges one marked block and
    // never replaces the file. The fact that it does not need the artifact to exist is
    // what lets it run before the first build.
    let gitattributes: InitResult["gitattributes"] = "absent"
    if (profile.cutlistOutput !== undefined) {
      const target = path.join(root, ".gitattributes")
      const existing = yield* Effect.orElseSucceed(fs.readFileString(target), () => undefined)
      const merged = mergeGitattributes(existing, generatedRules(profile.cutlistOutput))
      gitattributes = merged.action
      if (merged.action === "malformed") {
        kept.push(".gitattributes")
        profile = {
          ...profile,
          notes: [
            ...profile.notes,
            `.gitattributes has a "${GENERATED_BEGIN}" block with no "${GENERATED_END}"; add it and re-run init`,
          ],
        }
      } else if (merged.action === "unchanged") {
        kept.push(".gitattributes")
      } else {
        if (!dryRun) yield* fs.writeFileString(target, merged.body)
        written.push(".gitattributes")
      }
    }

    // The baseline is a reviewed ledger. Even `--force` does not replace it.
    const baseline = path.join(root, profile.baseline)
    if (yield* Effect.orElseSucceed(fs.exists(baseline), () => false)) {
      kept.push(profile.baseline)
    } else {
      if (!dryRun) yield* writeBaseline(baseline, emptyBaseline)
      written.push(profile.baseline)
    }
    yield* writeIfAbsent({
      fs,
      path,
      root,
      file: profile.cookbook,
      body: cookbookFor(profile),
      force,
      write: !dryRun,
      written,
      kept,
    })
    yield* writeIfAbsent({
      fs,
      path,
      root,
      file: profile.onboarding,
      body: onboardingFor(profile),
      force,
      write: !dryRun,
      written,
      kept,
    })

    const accepted = yield* readBaseline(baseline).pipe(
      Effect.map((value) => value.identities.length),
      Effect.orElseSucceed(() => 0),
    )
    let joggleConfig: InitResult["joggleConfig"] = "absent"
    if (profile.engines.some((engine) => engine.id === "joggle")) {
      const target = path.join(root, "joggle.config.json")
      if (yield* Effect.orElseSucceed(fs.exists(target), () => false)) {
        joggleConfig = "kept"
        kept.push("joggle.config.json")
      } else {
        // A repository without a model key should not print every unjudged candidate
        // as a warning. `count` keeps the census honest and the output usable; a repo
        // with a key can change it to `report` when it wants the candidates listed.
        // The repository summary is the one piece of prose a judged rule can use, and
        // it is already written down in the repo's own agent docs or README.
        // JSON.stringify drops the undefined keys, so an absent draft or summary never reaches
        // the file -- and the object keeps its literal type instead of widening to a dictionary.
        const starter = {
          unavailable: "count" as const,
          architecture: profile.architectureDraft,
          // The draft is includes only: the order and the `forbid` sets are judgement, so the
          // rules that would read them stay off until someone sets them. An alphabetical draft
          // that silently reports 0 is worse than no draft at all.
          rules:
            profile.architectureDraft === undefined
              ? undefined
              : { "joggle/layer-direction": "off" as const, "joggle/layer-purity": "off" as const },
          evidence: profile.summary === "" ? undefined : { repository: profile.summary },
        }
        if (!dryRun) {
          yield* fs.writeFileString(target, `${JSON.stringify(starter, null, 2)}\n`)
        }
        joggleConfig = "written"
        written.push("joggle.config.json")
      }
    }

    // Born accepted: an engine with its own ledger gets one written once, so day one is
    // "nothing new" instead of a pile a person must judge before the gate means anything.
    // Never rewritten, for the same reason `.jig-baseline.json` is never rewritten.
    const engineBaselines: Array<{
      readonly id: string
      readonly path: string
      readonly accepted: number
      readonly action: "kept" | "written" | "would accept"
    }> = []
    const joggle = profile.engines.find((engine) => engine.id === "joggle")
    // Only when the effective config will actually read it: a ledger nothing references is a
    // second answer waiting to disagree with the first.
    const wantsLedger = (joggle?.args ?? []).includes("--baseline")
    if (joggle !== undefined && wantsLedger) {
      const target = path.join(root, JOGGLE_BASELINE)
      const exists = yield* Effect.orElseSucceed(fs.exists(target), () => false)
      if (exists) {
        kept.push(JOGGLE_BASELINE)
        engineBaselines.push({ id: "joggle", path: JOGGLE_BASELINE, accepted: 0, action: "kept" })
      } else if (dryRun) {
        engineBaselines.push({
          id: "joggle",
          path: JOGGLE_BASELINE,
          accepted: 0,
          action: "would accept",
        })
      } else {
        const outcome = yield* Effect.orElseSucceed(
          exec({
            binary: resolveEngineCommand({ root, command: "joggle" }),
            args: ["check", ...(joggle.args ?? []), "--update-baseline", JOGGLE_BASELINE],
            cwd: root,
          }),
          () => undefined,
        )
        const wrote = yield* Effect.orElseSucceed(fs.exists(target), () => false)
        if (!wrote) {
          profile = {
            ...profile,
            notes: [
              ...profile.notes,
              "joggle did not write " +
                JOGGLE_BASELINE +
                (outcome === undefined
                  ? " (the command did not start)"
                  : " (exit " + String(outcome.code) + ")") +
                "; run `joggle check --update-baseline " +
                JOGGLE_BASELINE +
                "` by hand",
            ],
          }
        } else {
          const text = yield* Effect.orElseSucceed(fs.readFileString(target), () => "")
          const parsed = parseJson(text)
          const identities =
            isRecord(parsed) && Array.isArray(parsed["identities"]) ? parsed["identities"] : []
          written.push(JOGGLE_BASELINE)
          engineBaselines.push({
            id: "joggle",
            path: JOGGLE_BASELINE,
            accepted: identities.length,
            action: "written",
          })
        }
      }
    }

    // The write is done; whether anyone can commit it is a separate question, and one the
    // person only learns when the branch is pushed and the config is not in it.
    // Ask about the rulebooks too: a ledger git can see while its config it cannot is worse
    // than a local-only harness -- the record travels and the rules that produced it do not.
    const rulebooks = [
      "jig.config.json",
      ...(profile.engines.some((engine) => engine.id === "joggle") ? ["joggle.config.json"] : []),
      ...(profile.cutlistExisting === undefined ? [] : [profile.cutlistExisting.path]),
    ]
    const ledgers = [
      profile.baseline,
      ...(profile.engines.some((engine) => engine.id === "joggle") ? [JOGGLE_BASELINE] : []),
    ]
    const ignored = yield* ignoredByGit({
      root,
      files: [...new Set([...written, ...kept, profile.baseline, ...rulebooks])],
    })
    const ignoredSet = new Set(ignored)
    const committable = [...written, ...kept]
    const hiddenRulebook = rulebooks.find((file) => ignoredSet.has(file))
    const visibleLedger = ledgers.find(
      (file) => committable.includes(file) && !ignoredSet.has(file),
    )
    const split =
      hiddenRulebook === undefined || visibleLedger === undefined
        ? undefined
        : "`" +
          visibleLedger +
          "` can be committed while `" +
          hiddenRulebook +
          "` cannot: the record travels, the rules that produced it do not"
    const added = [
      ...(ignored.length === 0
        ? []
        : [
            `${ignored.length} path(s) here are gitignored (${ignored.join(", ")}): the harness is local-only, so it gates this machine and nothing else`,
          ]),
      ...(split === undefined ? [] : [split]),
    ]
    const noted = added.length === 0 ? profile : { ...profile, notes: [...profile.notes, ...added] }
    return {
      profile: noted,
      written,
      kept,
      ignored,
      engineBaselines,
      joggleConfig,
      cutlistConfig,
      gitattributes,
      dryRun,
      accepted,
    }
  })
