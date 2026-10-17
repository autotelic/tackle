/**
 * jig as a pi extension.
 *
 * jig is the harness: it runs every conformance engine in a repository and merges them
 * into one report. This extension is a thin shell over the `jig` CLI, so pi can run it
 * in whatever repository pi is working in:
 *
 *   jig_check     run every engine and return the findings
 *   jig_engines   list what is configured, and whether it is on PATH
 *   /jig          run a check from the prompt line
 *
 * Like `joggle`'s extension this file is NOT typechecked by the package (tsconfig
 * includes `src` only): it is a pi package, loaded by pi, which strips the types itself.
 * `pi install /absolute/path/to/tackle/packages/jig-cli` adds it globally.
 */
import { existsSync } from "node:fs"
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

/** How to launch jig: a command and its leading args. */
interface Launcher {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/**
 * How to invoke jig: a `jig` on PATH first (so pi and the shell get the same result),
 * then this checkout's build, then the source through the `development` condition.
 * `JIG_BIN` overrides all of it.
 */
const cli = (): Launcher => {
  const override = process.env.JIG_BIN
  if (override !== undefined && override !== "") return { command: override, args: [] }
  const global = onPath("jig")
  if (global !== undefined) return { command: global, args: [] }
  const built = join(root, "dist", "cli.js")
  if (existsSync(built)) return { command: process.execPath, args: [built] }
  return {
    command: process.execPath,
    args: ["--conditions=development", join(root, "src", "cli.ts")],
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
    timeout: 180_000,
  })
  return { stdout: result.stdout, stderr: result.stderr, code: result.code }
}

interface JsonReport {
  readonly counts: { readonly error: number; readonly warn: number; readonly info: number }
  readonly files: number
  readonly diagnostics: ReadonlyArray<{
    readonly engine: string
    readonly ruleId: string
    readonly severity: string
    readonly message: string
    readonly help?: string
    readonly location: { readonly file: string; readonly line: number; readonly column: number }
  }>
  readonly generators: ReadonlyArray<{
    readonly id: string
    readonly diagnostics: number
    readonly note?: string
  }>
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

/** The report, rendered for a model: the findings and the help that says what to do. */
const render = (report: JsonReport, limit: number): string => {
  const { counts } = report
  const shown = limit > 0 ? report.diagnostics.slice(0, limit) : report.diagnostics
  const lines = [
    `${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} notice(s) in ${report.files} file(s)`,
  ]
  shown.forEach((diagnostic, index) => {
    const { file, line, column } = diagnostic.location
    lines.push("")
    lines.push(
      `${index + 1}. [${diagnostic.severity}] ${diagnostic.engine}/${diagnostic.ruleId} ${file}:${line}:${column}`,
    )
    lines.push(`   ${diagnostic.message}`)
    if (diagnostic.help !== undefined) lines.push(`   help: ${diagnostic.help}`)
  })
  if (shown.length < report.diagnostics.length) {
    lines.push("")
    lines.push(
      `showing ${shown.length} of ${report.diagnostics.length} findings; raise limit to see the rest`,
    )
  }
  // An engine that could not run is the difference between "clean" and "not looked at".
  const notes = report.generators.filter((generator) => generator.note !== undefined)
  if (notes.length > 0) {
    lines.push("")
    for (const generator of notes) lines.push(`note: ${generator.id} - ${generator.note}`)
  }
  return lines.join("\n").trimEnd()
}

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

const checkParameters = Type.Object({
  cwd: Type.Optional(
    Type.String({
      description:
        "Repository to check, absolute or relative to pi's working directory. Default: the working directory pi is running in.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({ description: "Maximum findings to return. 0 returns all of them. Default 50." }),
  ),
})

interface CheckParameters {
  readonly cwd?: string
  readonly limit?: number
}

const targetFor = (cwd: string | undefined, ctx: ExtensionContext): string =>
  cwd === undefined ? ctx.cwd : resolve(ctx.cwd, cwd)

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "jig_check",
    label: "jig Check",
    description:
      "Run every conformance engine configured for this repository (plumb, joggle, cutlist, …) and return one merged report of errors, warnings and notices, plus a note for any engine that could not run. Returns at most 50 findings; pass `limit` to change that (`0` returns all).",
    promptSnippet: "Run every conformance engine in one pass with jig",
    promptGuidelines: [
      "Use jig_check after a batch of edits to see everything the repository enforces at once — lint, cross-file, and vocabulary findings in one report.",
      "A note in the report means an engine did not run: that is 'not looked at', not 'clean'.",
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
        const target = targetFor(params.cwd, ctx)
        const result = await run(pi, target, ["check", "--cwd", target, "--format", "json"], signal)
        const report = parse(result.stdout)
        if (report === undefined) {
          const detail = (result.stderr.trim() === "" ? result.stdout : result.stderr).trim()
          return failed(`jig check failed (exit ${result.code}): ${detail || "no output"}`, {
            code: result.code,
          })
        }
        return ok(render(report, params.limit === undefined ? 50 : params.limit), {
          code: result.code,
          errors: report.counts.error,
          warnings: report.counts.warn,
          cwd: target,
        })
      } catch (error) {
        return failed(`jig could not run: ${reason(error)}`, { command: "jig check" })
      }
    },
  })

  pi.registerTool({
    name: "jig_engines",
    label: "jig Engines",
    description:
      "List the conformance engines jig is configured to run here, and whether each is on PATH.",
    promptSnippet: "List the engines jig runs here",
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({ description: "Repository to read. Default: pi's working directory." }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: { readonly cwd?: string },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      try {
        const target = targetFor(params.cwd, ctx)
        const result = await run(pi, target, ["engines", "--cwd", target], signal)
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        if (result.code !== 0)
          return failed(`jig engines failed (exit ${result.code}): ${text}`, {})
        return ok(text === "" ? "no engines configured" : text, { cwd: target })
      } catch (error) {
        return failed(`jig could not run: ${reason(error)}`, { command: "jig engines" })
      }
    },
  })

  pi.registerCommand("jig", {
    description:
      "Run jig check on this repository. Arguments pass through, e.g. /jig --cwd ../other-repo.",
    handler: async (args: string, ctx: ExtensionContext) => {
      const extra = args.trim() === "" ? [] : args.trim().split(/\s+/)
      const cwdIndex = extra.indexOf("--cwd")
      const named = cwdIndex === -1 ? undefined : extra[cwdIndex + 1]
      const target = named === undefined ? ctx.cwd : resolve(ctx.cwd, named)
      const argv = cwdIndex === -1 ? ["--cwd", target, ...extra] : extra
      try {
        const result = await run(pi, ctx.cwd, ["check", ...argv], ctx.signal)
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        ctx.ui.notify(text === "" ? "jig: no output" : text, result.code === 0 ? "info" : "error")
      } catch (error) {
        ctx.ui.notify(`jig could not run: ${reason(error)}`, "error")
      }
    },
  })
}
