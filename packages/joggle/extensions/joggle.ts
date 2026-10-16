/**
 * joggle as a pi extension.
 *
 * joggle is a cross-file linter: it runs in a repository and reports the
 * duplication, naming drift and architecture breaks a single file cannot see.
 * This extension is a thin shell over the CLI in this repository, so pi can run
 * it in whatever repository pi is working in:
 *
 *   joggle_check   run a scoped check and return the findings
 *   joggle_rules   list what the current repository enforces
 *   /joggle        run a check from the prompt line
 *
 * The extension is a pi package. `pi install /absolute/path/to/joggle` adds it
 * globally, and `pi -e /absolute/path/to/joggle` loads it for one run.
 *
 * The report is built from the files on disk, never from a remote, so the
 * changed scope is git's view of the local checkout. That is what makes "cut a
 * PR, then iterate" work: the second run sees the edits made after the first.
 */
import { createHash } from "node:crypto"
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

/** The package this extension ships in: the directory above `extensions/`. */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")

/** The first `name` on PATH, if any. */
const onPath = (name: string): string | undefined => {
  for (const dir of (process.env.PATH ?? "").split(":")) {
    if (dir === "") continue
    const candidate = join(dir, name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * How to invoke joggle.
 *
 * A `joggle` on PATH is the machine's own command, and here it is the wrapper
 * that supplies the model key through doppler -- so it is preferred, and pi and
 * the shell get the same judged results. Otherwise the build in this checkout
 * is used, falling back to the source with the `development` export condition.
 * `JOGGLE_BIN` overrides all of it.
 */
const cli = (): { readonly command: string; readonly args: ReadonlyArray<string> } => {
  const override = process.env.JOGGLE_BIN
  if (override !== undefined && override !== "") return { command: override, args: [] }
  const global = onPath("joggle")
  if (global !== undefined) return { command: global, args: [] }
  const built = join(root, "dist", "main.js")
  if (existsSync(built)) return { command: process.execPath, args: [built] }
  return {
    command: process.execPath,
    args: ["--conditions=development", join(root, "src", "main.ts")],
  }
}

interface ExecOutcome {
  readonly stdout: string
  readonly stderr: string
  readonly code: number
}

const run = async (
  pi: ExtensionAPI,
  cwd: string,
  args: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
): Promise<ExecOutcome> => {
  const { command, args: prefix } = cli()
  const result = await pi.exec(command, [...prefix, ...args], {
    cwd,
    ...(signal === undefined ? {} : { signal }),
    timeout: 120_000,
  })
  return { stdout: result.stdout, stderr: result.stderr, code: result.code }
}

/**
 * The machine cache directory for one analysed root, matching the CLI's own
 * layout so answers and the run cache sit together.
 */
const machineCache = (target: string): string => {
  const base =
    process.env.XDG_CACHE_HOME !== undefined && process.env.XDG_CACHE_HOME !== ""
      ? process.env.XDG_CACHE_HOME
      : process.platform === "darwin"
        ? join(homedir(), "Library", "Caches")
        : join(homedir(), ".cache")
  const key = createHash("sha1").update(target).digest("hex").slice(0, 16)
  return join(base, "joggle", key)
}

/**
 * Where this run's answers go.
 *
 * `.joggle/answers/` is a committed artifact in a repository being
 * onboarded, and a side effect in one being inspected. The extension is global
 * and pi runs it in repositories it does not own, so it only writes the
 * committed cache where one already exists; otherwise the answers go to the
 * machine cache, beside the run cache the CLI already keeps there. Pass an
 * explicit `cacheDir` to override.
 */
const answerCache = (target: string): string | undefined =>
  existsSync(join(target, ".joggle")) ? undefined : machineCache(target)

/* -------------------------------------------------------------------------- */
/* Reading the report                                                          */
/* -------------------------------------------------------------------------- */

interface JsonLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

interface JsonRepair {
  readonly operation: string
  readonly keep?: JsonLocation | undefined
  readonly cascade: ReadonlyArray<unknown>
  readonly settled: string
}

interface JsonDiagnostic {
  readonly ruleId: string
  readonly severity: string
  readonly message: string
  readonly help?: string | undefined
  readonly location: JsonLocation
  readonly judged: boolean
  readonly repair?: JsonRepair | undefined
}

interface JsonNote {
  readonly ruleId: string
  readonly reason: string
}

interface JsonReport {
  readonly diagnostics: ReadonlyArray<JsonDiagnostic>
  readonly summary: {
    readonly problems: number
    readonly errors: number
    readonly warnings: number
    readonly infos: number
    readonly files: number
    readonly skipped: ReadonlyArray<JsonNote>
  }
}

/**
 * The JSON report, rendered for a model.
 *
 * The default text format is for a person reading a terminal: it carries a
 * census, a provenance line and a funnel of notes, and a model pays for all of
 * it on every call. This keeps the finding, the help that says what to do about
 * it, and the repair the rule proposes -- which is the material an agent needs
 * in order to act -- and drops the rest.
 */
const render = (report: JsonReport, limit: number): string => {
  const { summary } = report
  const shown = limit > 0 ? report.diagnostics.slice(0, limit) : report.diagnostics
  const lines = [
    `${summary.problems} problem(s) (${summary.errors} error(s), ${summary.warnings} warning(s), ${summary.infos} notice(s)) across ${summary.files} file(s)`,
  ]
  shown.forEach((diagnostic, index) => {
    const { file, line, column } = diagnostic.location
    const verified = diagnostic.judged ? "" : " (unverified)"
    lines.push("")
    lines.push(
      `${index + 1}. [${diagnostic.severity}] ${diagnostic.ruleId} ${file}:${line}:${column}${verified}`,
    )
    lines.push(`   ${diagnostic.message}`)
    if (diagnostic.help !== undefined) lines.push(`   help: ${diagnostic.help}`)
    const repair = diagnostic.repair
    if (repair !== undefined) {
      const keep =
        repair.keep === undefined ? "" : ` keep ${repair.keep.file}:${repair.keep.line}`
      lines.push(
        `   repair: ${repair.operation}${keep} (${repair.cascade.length} edit(s); ${repair.settled})`,
      )
    }
  })
  // A tool result is context a model pays for on every call. A full-repository
  // run can be thousands of findings; the total is the fact, the first N are
  // the work.
  if (shown.length < report.diagnostics.length) {
    lines.push("")
    lines.push(
      `showing ${shown.length} of ${report.diagnostics.length} findings; narrow the scope, pass rule, or raise limit to see the rest`,
    )
  }
  // A judged rule that never ran is the difference between "clean" and "not
  // looked at", and a model reading the findings cannot tell the two apart.
  if (summary.skipped.length > 0) {
    lines.push("")
    for (const skip of summary.skipped) lines.push(`note: ${skip.ruleId} skipped - ${skip.reason}`)
  }
  return lines.join("\n").trimEnd()
}

const parse = (stdout: string): JsonReport | undefined => {
  try {
    const value = JSON.parse(stdout) as unknown
    if (typeof value === "object" && value !== null && "diagnostics" in value) {
      return value as JsonReport
    }
    return undefined
  } catch {
    return undefined
  }
}

/* -------------------------------------------------------------------------- */
/* Tool results                                                                */
/* -------------------------------------------------------------------------- */

interface ToolResult {
  readonly content: ReadonlyArray<{ readonly type: "text"; readonly text: string }>
  readonly details: Record<string, unknown>
  readonly isError?: boolean
}

const ok = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
})

const failed = (text: string, details: Record<string, unknown>): ToolResult => ({
  content: [{ type: "text", text }],
  details,
  isError: true,
})

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/* -------------------------------------------------------------------------- */
/* The check tool                                                              */
/* -------------------------------------------------------------------------- */

const scope = Type.Union(
  [Type.Literal("changed"), Type.Literal("pr"), Type.Literal("since"), Type.Literal("all")],
  {
    description:
      "What to scope the check to. 'changed' (default) is what moved since joggle last ran here; 'pr' is the current branch's pull request; 'since' needs a git revision; 'all' is the whole project.",
  },
)

const checkParameters = Type.Object({
  scope: Type.Optional(scope),
  since: Type.Optional(
    Type.String({ description: "Git revision to scope against when scope is 'since' (for example origin/main)." }),
  ),
  prNumber: Type.Optional(
    Type.String({ description: "A specific pull request, by number or URL, instead of the current branch's." }),
  ),
  paths: Type.Optional(
    Type.Array(Type.String(), {
      description: "Files or directories to analyse. Default: whatever tsgo says the project is.",
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description:
        "Repository to analyse, absolute or relative to pi's working directory. Default: the working directory pi is running in.",
    }),
  ),
  cacheDir: Type.Optional(
    Type.String({
      description:
        "Where the answer cache lives. Default: the target's .joggle if it already has one, otherwise the machine cache, so a repository without one is never modified.",
    }),
  ),
  rule: Type.Optional(
    Type.String({ description: "Only run these rule ids, comma-separated." }),
  ),
  offline: Type.Optional(
    Type.Boolean({ description: "Answer only from the committed judgement cache; never call the model." }),
  ),
  maxWarnings: Type.Optional(
    Type.Number({ description: "Treat more than this many warnings as a failing run." }),
  ),
  limit: Type.Optional(
    Type.Number({
      description:
        "Maximum findings to return; the total is always reported. Default 50, and 0 returns all of them.",
    }),
  ),
})

interface CheckParameters {
  readonly scope?: "changed" | "pr" | "since" | "all" | undefined
  readonly since?: string | undefined
  readonly prNumber?: string | undefined
  readonly paths?: ReadonlyArray<string> | undefined
  readonly cwd?: string | undefined
  readonly cacheDir?: string | undefined
  readonly rule?: string | undefined
  readonly offline?: boolean | undefined
  readonly maxWarnings?: number | undefined
  readonly limit?: number | undefined
}

const checkArgs = (params: CheckParameters, target: string): ReadonlyArray<string> => {
  const args = ["check", "--format", "json"]
  const chosen = params.scope ?? "changed"
  if (chosen === "changed") {
    args.push("--changed")
  } else if (chosen === "pr") {
    if (params.prNumber !== undefined) args.push("--pr-number", params.prNumber)
    else args.push("--pr")
  } else if (chosen === "since") {
    if (params.since === undefined) throw new Error("scope 'since' needs a `since` revision")
    args.push("--since", params.since)
  }
  if (params.paths !== undefined && params.paths.length > 0) args.push(...params.paths)
  if (params.rule !== undefined) args.push("--rule", params.rule)
  if (params.offline === true) args.push("--offline")
  if (params.maxWarnings !== undefined) args.push("--max-warnings", String(params.maxWarnings))
  // Non-invasive by default: a repository that has never been onboarded gets no
  // `.joggle/` from a tool call.
  if (params.cacheDir !== undefined) {
    args.push("--cache-dir", params.cacheDir)
  } else {
    const fallback = answerCache(target)
    if (fallback !== undefined) args.push("--cache-dir", fallback)
  }
  return args
}

/** The repository a tool call is about: its `cwd`, or pi's working directory. */
const targetFor = (params: { readonly cwd?: string | undefined }, ctx: ExtensionContext): string =>
  params.cwd === undefined ? ctx.cwd : resolve(ctx.cwd, params.cwd)

/* -------------------------------------------------------------------------- */
/* The extension                                                               */
/* -------------------------------------------------------------------------- */

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "joggle_check",
    label: "joggle Check",
    description:
      "Run joggle over this repository and return cross-file duplication, naming drift and architecture findings. Scoped to what changed by default, so it answers what the current batch of work introduced. Returns at most 50 findings; pass `limit` to change that (`0` returns all of them) and the total is always reported.",
    promptSnippet: "Find cross-file duplication and naming drift with joggle",
    promptGuidelines: [
      "Use joggle_check after a batch of edits to find new cross-file duplication and naming drift; it defaults to the changed scope.",
      "Use joggle_check with scope 'pr' after cutting a pull request to see only what the pull request introduced.",
    ],
    parameters: checkParameters,
    async execute(
      _toolCallId: string,
      params: CheckParameters,
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      try {
        const target = targetFor(params, ctx)
        const args = checkArgs(params, target)
        const result = await run(pi, target, args, signal)
        const report = parse(result.stdout)
        if (report === undefined) {
          const detail = (result.stderr.trim() === "" ? result.stdout : result.stderr).trim()
          return failed(`joggle failed (exit ${result.code}): ${detail || "no output"}`, {
            code: result.code,
            command: args.join(" "),
          })
        }
        const warning = result.stderr.trim()
        const body = render(report, params.limit ?? 50)
        return ok(warning === "" ? body : body + "\n\nnote: " + warning, {
          code: result.code,
          problems: report.summary.problems,
          errors: report.summary.errors,
          warnings: report.summary.warnings,
          cwd: target,
          command: args.join(" "),
        })
      } catch (error) {
        return failed(`joggle could not run: ${reason(error)}`, { command: "joggle check" })
      }
    },
  })

  pi.registerTool({
    name: "joggle_rules",
    label: "joggle Rules",
    description: "List the rules a repository enforces, with their severities.",
    promptSnippet: "List the rules joggle enforces here",
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({
          description:
            "Repository to read, absolute or relative to pi's working directory. Default: the working directory pi is running in.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { readonly cwd?: string | undefined },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      try {
        const target = targetFor(params, ctx)
        const result = await run(pi, target, ["rules"], signal)
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        if (result.code !== 0) return failed(`joggle rules failed (exit ${result.code}): ${text}`, {})
        const warning = result.stdout.trim() === "" ? "" : result.stderr.trim()
        const body = text === "" ? "no rules configured" : text
        return ok(warning === "" ? body : body + "\n\nnote: " + warning, {
          cwd: target,
          command: "joggle rules",
        })
      } catch (error) {
        return failed(`joggle could not run: ${reason(error)}`, { command: "joggle rules" })
      }
    },
  })

  pi.registerCommand("joggle", {
    description:
      "Run a joggle check on this repository. Arguments pass through, e.g. /joggle --pr or /joggle --cwd ../other-repo --since origin/main.",
    handler: async (args: string, ctx: ExtensionContext) => {
      const extra = args.trim() === "" ? ["--changed"] : args.trim().split(/\s+/)
      // `--cwd` names the repository the check is about; the cache rule follows
      // it, so the command does not litter a checkout it was pointed at either.
      const cwdIndex = extra.indexOf("--cwd")
      const named = cwdIndex === -1 ? undefined : extra[cwdIndex + 1]
      const target = named === undefined ? ctx.cwd : resolve(ctx.cwd, named)
      const argv = [...extra]
      if (!argv.includes("--cache-dir")) {
        const fallback = answerCache(target)
        if (fallback !== undefined) argv.push("--cache-dir", fallback)
      }
      try {
        const result = await run(pi, ctx.cwd, ["check", ...argv], ctx.signal)
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        ctx.ui.notify(text === "" ? "joggle: no output" : text, result.code === 0 ? "info" : "error")
      } catch (error) {
        ctx.ui.notify(`joggle could not run: ${reason(error)}`, "error")
      }
    },
  })
}
