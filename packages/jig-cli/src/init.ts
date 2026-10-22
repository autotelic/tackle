import { existsSync } from "node:fs"
import { join } from "node:path"
import { Effect, FileSystem, Option, Path, PlatformError } from "effect"
import type { CutlistConfig, EngineRef, HarnessConfig } from "@autotelic/protocol"
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts"
import { loadConfig } from "./config.ts"
import { resolveEngineCommand } from "./engines.ts"
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
  readonly facts: ReadonlySet<"ci" | "configured" | "live-judgement" | "typescript" | "workspaces">
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
  /** A cutlist config inferred from the tree, when this looks like a UI. */
  readonly cutlistDraft: CutlistConfig | undefined
}

/** What `init` wrote and what it left alone. */
export interface InitResult {
  readonly profile: RepoProfile
  readonly written: ReadonlyArray<string>
  readonly kept: ReadonlyArray<string>
  readonly joggleConfig: "kept" | "written" | "absent"
  readonly cutlistConfig: "kept" | "written" | "absent"
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
      const file = parent === "" ? "tsconfig.json" : parent + "/tsconfig.json"
      const text = yield* Effect.orElseSucceed(fs.readFileString(path.join(root, file)), () => "")
      for (const match of text.matchAll(/"([^"]+\/\*)"\s*:\s*\[\s*"([^"]+)"/gu)) {
        const key = match[1]
        const target = match[2]
        if (key === undefined || target === undefined) continue
        const resolved = normalise(parent === "" ? target : parent + "/" + target)
        const list = found.get(key) ?? []
        if (!list.includes(resolved)) list.push(resolved)
        found.set(key, list)
      }
    }
    return Object.fromEntries(found)
  })

/** A cutlist config inferred from common UI layouts, for a person to review. */
const cutlistDraftOf = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
): Effect.Effect<CutlistConfig | undefined> =>
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
    const under = (directory: string, file: string): string =>
      directory === "" ? file : directory + "/" + file
    const tokenCandidates: Array<string> = []
    for (const entry of roots) {
      const parent = entry.split("/").slice(0, -1).join("/")
      for (const directory of [entry, parent]) {
        for (const name of ["tailwind.config.ts", "tailwind.config.js", "tailwind.config.mjs"]) {
          tokenCandidates.push(under(directory, name))
        }
      }
      for (const name of ["tailwind.css", "app.css", "styles/app.css", "styles/tailwind.css"]) {
        tokenCandidates.push(under(entry, name))
      }
    }
    tokenCandidates.push("tailwind.config.ts", "tailwind.config.js")
    const tokens = yield* firstOf(fs, path, root, tokenCandidates)
    const from = tokens ?? "tailwind.config.ts"
    const alias = yield* aliasesOf(fs, path, root, roots)
    const draft: CutlistConfig = {
      $schema: "https://autotelic.dev/tackle/protocol/cutlist.config.json",
      roots,
      tiers: { primitive, shared, local },
      tokens: from.endsWith(".css") ? { from, vars: from } : { from },
      ownership: { routeOwner: "first-segment", transitive: false },
    }
    return Object.keys(alias).length === 0 ? draft : { ...draft, alias }
  })

/**
 * Read the repository, then decide what is worth enabling.
 *
 * @param root - The project root.
 * @param options - The gate mode the caller asked for, if any.
 * @returns the profile `init` writes from.
 */
export const inspectRepo = (
  root: string,
  options: { readonly gateMode?: "all" | "touched-files" | undefined } = {},
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
    const jigPinned = localJig || dependencies["@autotelic/jig-cli"] !== undefined
    const jig = jigCommandOf(packageManager, jigPinned)
    if (!jigPinned) {
      notes.push(
        "jig resolves from PATH; pin @autotelic/jig-cli as a devDependency so CI runs the same version",
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
    const cutlistDraft = yield* cutlistDraftOf(fs, path, root)
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

    const engines: Array<EngineRef> = []

    if (lint.tool === "oxlint" && lint.config !== undefined) {
      if (!available({ root, command: "oxlint" })) {
        notes.push("plumb not enabled: oxlint is not installed here (pnpm add -D oxlint)")
      } else if (!loadsPlumb(configText)) {
        notes.push(
          "plumb not enabled: " + lint.config + " does not load @autotelic/plumb in jsPlugins",
        )
      } else {
        engines.push(
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
        engines.push({ id: "joggle", kind: "process", command: "joggle" })
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

    if (files.includes("cutlist.config.json")) {
      if (!available({ root, command: "cutlist" })) {
        notes.push(
          "cutlist not enabled: cutlist.config.json exists but the command is not installed",
        )
      } else {
        engines.push({ id: "cutlist", kind: "process", command: "cutlist" })
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
      ]),
      agentDocs,
      summary,
      commands,
      lint,
      engines,
      notes,
      gateMode: options.gateMode ?? existing?.gate.mode ?? "touched-files",
      baseline: existing?.gate.baseline ?? ".jig-baseline.json",
      cookbook: existing?.agent?.cookbook ?? "JIG.md",
      onboarding: existing?.agent?.onboarding ?? "ONBOARD.md",
      cutlistDraft,
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
${profile.engines.some((engine) => engine.id === "cutlist") ? "| `" + profile.jig + " menu` | the component catalog cutlist built |\n" : ""}${profile.commands.length === 0 ? "" : "\n## The repo's own commands\n\n" + profile.commands.map((command) => "- `" + command.command + "` — the repo's " + command.name + " script").join("\n") + "\n"}

## What runs

- engines: ${engineSummary(profile)}
- gate: \`${profile.gateMode}\`, failing on \`any-new\` identity
- baseline: \`${profile.baseline}\`
${profile.notes.length === 0 ? "" : "\nNotes:\n" + profile.notes.map((note) => "- " + note).join("\n") + "\n"}

${
  profile.gateMode === "touched-files"
    ? "Only findings in the change in front of you fail a run. Existing debt is reported,\nnot enforced, until you touch it."
    : "Every finding in the repository fails a run. Accept the current debt deliberately\nwith `" +
      profile.jig +
      " baseline`, or switch the gate to `touched-files`."
}

${profile.facts.has("ci") ? "## CI\n\nRun `" + profile.jig + " check --format github` in the pull-request workflow. The gate holds new identities only, so the first run explains the debt instead of failing on it.\n\n" : ""}## Judgement

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

/** The agent door: a prompt that starts with the first command, and stops to ask. */
export const onboardingFor = (profile: RepoProfile): string => {
  const notes =
    profile.notes.length === 0 ? "" : "\n" + profile.notes.map((note) => `- ${note}`).join("\n")
  return tighten(`# ONBOARD.md

You are working in ${profile.name}. This repository uses \`jig\` as its conformance
harness. Read this file, then \`JIG.md\`, then start.
${profile.summary === "" ? "" : "\n" + profile.summary + "\n"}
${profile.facts.has("configured") ? "" : "\nThis repository is not initialised yet. Run `" + profile.jig + " init` (or `" + profile.jig + " init --cutlist`) to apply the plan before continuing.\n"}

## Do this first

1. Run \`${profile.jig} engines\`. Confirm every configured engine resolves.
   **STOP and ask** before installing anything, and do not install a tool globally.
2. Run \`${profile.jig} check --limit 20\`. Read the census before the findings: an
   engine marked \`skipped\`, \`replayed\`, or "candidates not judged" did not look at
   everything, and a note is not a pass.
3. Read \`JIG.md\` for the commands and the gate.

## The rules of the ratchet

- **Do not run \`${profile.jig} baseline\` without asking.** It accepts every current
  finding, and a baseline accepted without review is debt made invisible.
- Fix findings in files you are already changing. Do not disable a rule to get green;
  if a rule is wrong for this repo, say so and ask before adding an ignore.
- Use \`${profile.run}\` for package scripts.
- The gate is \`${profile.gateMode}\`: ${
    profile.gateMode === "touched-files"
      ? "only findings in the change in front of you fail the run."
      : "every finding in the repository fails the run."
  }

## What this repo configured

- package manager: ${profile.packageManager}
- engines: ${engineSummary(profile)}
- plumb: ${profile.lint.config === undefined ? "not configured" : profile.lint.config}${profile.lint.script === undefined ? "" : " via `" + profile.run + " " + profile.lint.script + "`"}
- typescript: ${profile.facts.has("typescript") ? "yes" : "no"}
- gate: ${profile.gateMode}
- baseline: ${profile.baseline}${profile.cutlistDraft === undefined ? "" : "\n- cutlist: a draft is available (run `" + profile.jig + " init --cutlist`)"}${notes}

## When you need more

- \`${profile.jig} explain <rule>\` — the rule's findings, help, and history here.
- \`${profile.jig} menu\` — the component catalog, when cutlist is enabled.
- \`${profile.jig} --help\` — every command.

## Stop and ask

- Before installing an engine, changing \`jig.config.json\`, or running
  \`${profile.jig} baseline\`.
- Before changing the gate to \`all\`.
- When a note says an engine could not run: that is a hole in the census, not a
  finding to fix in the code.
`)
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
    `  cutlist          ${
      result.cutlistConfig !== "written"
        ? result.cutlistConfig
        : result.dryRun
          ? "draft would be written — review it after applying"
          : "draft written — review, build, then re-run init --force"
    }`,
    `  ${action.padEnd(16)} ${result.written.length === 0 ? "nothing" : result.written.join(", ")}`,
    ...(result.kept.length === 0 ? [] : [`  ${keptAction.padEnd(16)} ${result.kept.join(", ")}`]),
    ...profile.notes.map((note) => `  note             ${note}`),
    "",
    "Next:",
    ...(result.dryRun
      ? [
          `  1. ${profile.jig} init${result.cutlistConfig === "written" ? " --cutlist" : ""}     write this plan after approval`,
          `  2. ${profile.jig} engines     confirm each command resolves`,
          `  3. ${profile.jig} check --limit 20     census, then the first 20 findings`,
          `  4. point your agent at ${profile.onboarding}`,
        ]
      : profile.engines.length === 0
        ? ["  1. install at least one engine (see the notes above)", "  2. re-run jig init --force"]
        : [
            `  1. ${profile.jig} engines     confirm each command resolves`,
            `  2. ${profile.jig} check --limit 20     census, then the first 20 findings`,
            ...(result.cutlistConfig === "written"
              ? [
                  "  3. cutlist build     review the catalog, commit it, then re-run jig init --force",
                  `  4. point your agent at ${profile.onboarding}`,
                ]
              : [`  3. point your agent at ${profile.onboarding}`]),
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
    accepted: result.accepted,
  }
  return JSON.stringify(
    prompt === undefined ? { profile, plan } : { profile, plan, prompt },
    null,
    2,
  )
}

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
): Effect.Effect<InitResult, PlatformError.PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    let profile = yield* inspectRepo(root, { gateMode: options.gateMode })
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
            "cutlist draft written: review cutlist.config.json, run `cutlist build`, then re-run `jig init --force` to enable it",
          ],
        }
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
        const starter = {
          unavailable: "count" as const,
          evidence: profile.summary === "" ? undefined : { repository: profile.summary },
        }
        if (!dryRun) {
          yield* fs.writeFileString(target, `${JSON.stringify(starter, null, 2)}\n`)
        }
        joggleConfig = "written"
        written.push("joggle.config.json")
      }
    }

    return { profile, written, kept, joggleConfig, cutlistConfig, dryRun, accepted }
  })
