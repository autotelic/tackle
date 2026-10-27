/**
 * jig as a pi extension.
 *
 * jig is the harness: it runs every conformance engine in a repository and merges them
 * into one report. This extension is a thin shell over the `jig` CLI, so pi can run it
 * in whatever repository pi is working in:
 *
 *   jig_check     run every engine and return the findings
 *   jig_engines   list what is configured, and whether it is on PATH
 *   jig_onboard   read the setup plan and prompt without writing anything
 *   jig_init      apply that plan after a human approves it
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

/*
 * There is deliberately no report parser and no renderer here.
 *
 * jig owns the one human form; this extension asks jig for it and hands the text back.
 * A JSON parse plus a numbered list here would be a second renderer, and a second
 * renderer is a second answer — the failure this whole workspace exists to prevent.
 */

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

/**
 * The gate a plan is built for.
 *
 * `touched-files` is the adoption default, but it cannot validate a clean checkout: the
 * working-tree diff is empty, so nothing is in scope and the gate passes while the report
 * still lists findings. A workshop or a first run wants `all`.
 */
const gateParameter = Type.Optional(
  Type.Union([Type.Literal("touched-files"), Type.Literal("all")], {
    description:
      "What the gate enforces: only the change in front of you (default), or every finding in the repo. Use `all` when validating from a clean checkout.",
  }),
)

const targetFor = (cwd: string | undefined, ctx: ExtensionContext): string =>
  cwd === undefined ? ctx.cwd : resolve(ctx.cwd, cwd)

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: "jig_check",
    label: "jig Check",
    description:
      "Run every conformance engine configured for this repository (plumb, joggle, cutlist, …) and return one merged report of errors, warnings and notices, plus a note for any engine that could not run — and whether an engine replayed a cache or skipped a rule, because a note means 'not looked at', never 'clean'. Returns at most 50 findings; pass `limit` to change that (`0` returns all).",
    promptSnippet: "Run every conformance engine in one pass with jig",
    promptGuidelines: [
      "Use jig_check after a batch of edits to see everything the repository enforces at once — lint, cross-file, and vocabulary findings in one report.",
      "A note in the report means an engine did not run, or replayed a cache: that is 'not looked at', not 'clean'.",
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
        const limit = params.limit === undefined ? 50 : params.limit
        const result = await run(
          pi,
          target,
          ["check", "--cwd", target, "--format", "text", "--limit", String(limit)],
          signal,
        )
        // A non-zero exit is a result, not an error: `jig check` exits non-zero on
        // findings, and the report is on stdout either way.
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        return ok(text === "" ? `jig check exited ${result.code}` : text, {
          code: result.code,
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

  pi.registerTool({
    name: "jig_onboard",
    label: "jig Onboard",
    description:
      'Read the setup plan and agent prompt for jig in this repository without writing anything. It names the package manager, the engines that can run, the paths init would write, and where to stop and ask. Run `jig init` (add `--cutlist` for a UI repo) only after a human approves the plan. Pass `gate: "all"` when validating from a clean checkout; `touched-files` reports existing debt but does not enforce it until a file is touched.',
    promptSnippet: "Read the jig setup prompt before initialising",
    promptGuidelines: [
      "Use jig_onboard before changing jig.config.json: it writes nothing and shows the engines and paths the scan found.",
      "After approval, run `jig init` (or `jig init --cutlist`) to apply the plan, then `jig_check`.",
      'For a first run or a workshop on a clean checkout, call jig_onboard with gate "all" so the plan enforces every finding.',
    ],
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({ description: "Repository to inspect. Default: pi's working directory." }),
      ),
      format: Type.Optional(
        Type.Union([Type.Literal("text"), Type.Literal("json")], {
          description: "The prompt alone, or the prompt with the plan as JSON. Default text.",
        }),
      ),
      gate: gateParameter,
      force: Type.Optional(
        Type.Boolean({
          description:
            "Plan a rewrite of jig.config.json, JIG.md and ONBOARD.md; never the baseline. Default false.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        readonly cwd?: string
        readonly format?: "text" | "json"
        readonly gate?: "touched-files" | "all"
        readonly force?: boolean
      },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      try {
        const target = targetFor(params.cwd, ctx)
        const format = params.format === undefined ? "text" : params.format
        const result = await run(
          pi,
          target,
          [
            "onboard",
            "--cwd",
            target,
            "--format",
            format,
            ...(params.gate === undefined ? [] : ["--gate", params.gate]),
            ...(params.force === true ? ["--force"] : []),
          ],
          signal,
        )
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        if (result.code !== 0)
          return failed(`jig onboard failed (exit ${result.code}): ${text}`, {})
        return ok(text === "" ? "jig onboard printed nothing" : text, { cwd: target })
      } catch (error) {
        return failed(`jig could not run: ${reason(error)}`, { command: "jig onboard" })
      }
    },
  })

  pi.registerTool({
    name: "jig_init",
    label: "jig Init",
    description:
      "Apply the jig setup plan: write jig.config.json, the baseline, JIG.md, ONBOARD.md, a starter joggle.config.json, and optionally a cutlist draft. Use only after a human has approved the plan from jig_onboard; this writes files. Pass the same `gate` the plan used so the applied config matches what was approved.",
    promptSnippet: "Apply the jig setup plan after approval",
    promptGuidelines: [
      "Run jig_onboard first and show the plan to the human. Do not call jig_init until they approve it.",
      'Pass the same gate jig_onboard planned with; `gate: "all"` is the honest first-run gate on a clean checkout.',
      "After init, run jig_engines and jig_check; do not run jig baseline without asking.",
    ],
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({ description: "Repository to set up. Default: pi's working directory." }),
      ),
      cutlist: Type.Optional(
        Type.Boolean({
          description: "Also draft cutlist.config.json from detected UI roots. Default false.",
        }),
      ),
      gate: gateParameter,
      force: Type.Optional(
        Type.Boolean({
          description:
            "Rewrite jig.config.json, JIG.md and ONBOARD.md; never the baseline. Default false.",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        readonly cwd?: string
        readonly cutlist?: boolean
        readonly gate?: "touched-files" | "all"
        readonly force?: boolean
      },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      try {
        const target = targetFor(params.cwd, ctx)
        const result = await run(
          pi,
          target,
          [
            "init",
            "--cwd",
            target,
            ...(params.cutlist === true ? ["--cutlist"] : []),
            ...(params.gate === undefined ? [] : ["--gate", params.gate]),
            ...(params.force === true ? ["--force"] : []),
          ],
          signal,
        )
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        if (result.code !== 0) return failed(`jig init failed (exit ${result.code}): ${text}`, {})
        return ok(text === "" ? "jig init wrote nothing" : text, { cwd: target })
      } catch (error) {
        return failed(`jig could not run: ${reason(error)}`, { command: "jig init" })
      }
    },
  })

  pi.registerTool({
    name: "jig_menu",
    label: "jig Menu",
    description:
      "Read the cutlist artifact for this repository: the stable shape, or the parts/features/recipes that answer a query. Use this to find the right component before writing UI; it reads the generated menu, patterns, and recipes instead of re-analysing the tree.",
    promptSnippet: "Find a component or pattern in the cutlist menu",
    promptGuidelines: [
      "Use jig_menu before building a new interface: search for the concept (for example `dialog` or `wizard`) and prefer the recipe's import and shape over inventing a new part.",
      "A recipe is a skeleton, not a generated app; adapt its props and children to the call site.",
    ],
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({ description: "Repository to read. Default: pi's working directory." }),
      ),
      query: Type.Optional(
        Type.String({
          description: "A part, feature, or concept to find. Omit for the stable shape.",
        }),
      ),
      page: Type.Optional(
        Type.String({
          description:
            "What does this page render? A route name, id, or path. Answers with the direct parts and what is reached through them.",
        }),
      ),
      part: Type.Optional(
        Type.String({
          description:
            "Which pages mount this part? A component name, id, or path. Answers with the renderers and the routes above them.",
        }),
      ),
      similar: Type.Optional(
        Type.String({
          description:
            "What already exists like this name? Use before proposing a new part; answers with name and skeleton evidence.",
        }),
      ),
      limit: Type.Optional(Type.Number({ description: "Maximum matches. Default 12." })),
    }),
    async execute(
      _toolCallId: string,
      params: {
        readonly cwd?: string
        readonly query?: string
        readonly page?: string
        readonly part?: string
        readonly similar?: string
        readonly limit?: number
      },
      signal: AbortSignal | undefined,
      _onUpdate: unknown,
      ctx: ExtensionContext,
    ): Promise<ToolResult> {
      try {
        const target = targetFor(params.cwd, ctx)
        const limit = params.limit === undefined ? 12 : params.limit
        const flag = (name: string, value: string | undefined): ReadonlyArray<string> =>
          value === undefined || value === "" ? [] : [`--${name}`, value]
        const args = [
          "menu",
          "--cwd",
          target,
          "--limit",
          String(limit),
          ...flag("page", params.page),
          ...flag("part", params.part),
          ...flag("similar", params.similar),
          ...(params.query === undefined || params.query === "" ? [] : [params.query]),
        ]
        const result = await run(pi, target, args, signal)
        const text = (result.stdout.trim() === "" ? result.stderr : result.stdout).trim()
        return ok(text === "" ? `jig menu exited ${result.code}` : text, {
          code: result.code,
          cwd: target,
        })
      } catch (error) {
        return failed(`jig could not read the menu: ${reason(error)}`, { command: "jig menu" })
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
