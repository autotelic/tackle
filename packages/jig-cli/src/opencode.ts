import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { Plugin } from "@opencode/plugin"

/*
 * jig as an OpenCode plugin.
 *
 * The same rule as the pi extension: this file owns no analysis and re-implements no
 * report. It shells out to the `jig` binary and hands the model exactly what a human's
 * terminal shows, because "the agent gets a different answer than CI" is the failure this
 * whole workspace exists to prevent. The plugin is a transport, not a second renderer.
 *
 * Published as `@autotelic/jig-cli/opencode`; OpenCode loads it from `plugins` in
 * `opencode.json`. `@opencode/plugin` is an optional peer — nothing else here needs it.
 */

const run = promisify(execFile)

/** The package root: the directory above `src/` (source) or `dist/` (built). */
const packageRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), "..")

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

/** The facts the fallback decision reads, injected so it can be tested without spawning. */
export interface LaunchEnvironment {
  readonly override: string | undefined
  readonly onPath: (name: string) => string | undefined
  readonly execPath: string
  readonly exists: (path: string) => boolean
  readonly root: string
}

/**
 * How to invoke jig.
 *
 * `PATH` wins so the plugin and the shell get the same answer; `JIG_BIN` overrides both.
 * The fallback runs this package's own build, and it must name a real interpreter rather
 * than `process.execPath`: the OpenCode server is a bun-compiled binary, so there
 * `process.execPath` is OpenCode, not Node — launching `process.execPath <jig.js>` runs
 * OpenCode, which prints its own help. Prefer a `jig` on `PATH`, then this checkout's build,
 * then its source, each under a Node found on `PATH` (or, if none, whatever runs us).
 */
export const resolveLauncher = (env: LaunchEnvironment): Launcher => {
  if (env.override !== undefined && env.override !== "") return { command: env.override, args: [] }
  if (env.onPath("jig") !== undefined) return { command: "jig", args: [] }
  const node = env.onPath("node") ?? env.execPath
  const built = join(env.root, "dist", "cli.js")
  if (env.exists(built)) return { command: node, args: [built] }
  const source = join(env.root, "src", "cli.ts")
  if (env.exists(source)) return { command: node, args: ["--conditions=development", source] }
  // `bin/jig.js` forwards to `dist/cli.js`, so this arm only runs with nothing to run.
  return { command: node, args: [join(env.root, "bin", "jig.js")] }
}

const invoke = (): Launcher =>
  resolveLauncher({
    override: process.env.JIG_BIN,
    onPath,
    execPath: process.execPath,
    exists: existsSync,
    root: packageRoot(),
  })

/** The report and the exit code. A non-zero exit is a result, not a thrown tool call. */
interface Outcome {
  readonly output: string
  readonly code: number
}

const runJig = async (
  cwd: string,
  args: ReadonlyArray<string>,
  signal: AbortSignal | undefined,
): Promise<Outcome> => {
  const { command, args: prefix } = invoke()
  try {
    const { stdout, stderr } = await run(command, [...prefix, ...args], {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
      ...(signal === undefined ? {} : { signal }),
    })
    return { output: (stdout.trim() === "" ? stderr : stdout).trim(), code: 0 }
  } catch (error) {
    // `execFile` rejects on a non-zero exit, and `jig check` exits non-zero on findings.
    // The report is on stdout either way; only a failed spawn has neither stream.
    const failed = error as { code?: number; stdout?: string; stderr?: string; message?: string }
    const output =
      (failed.stdout ?? "").trim() !== ""
        ? (failed.stdout ?? "").trim()
        : (failed.stderr ?? "").trim()
    return {
      output: output === "" ? (failed.message ?? "jig failed to run") : output,
      code: typeof failed.code === "number" ? failed.code : 1,
    }
  }
}

const directoryFor = (value: unknown, root: string): string =>
  typeof value === "string" && value !== "" ? resolve(root, value) : root

export default Plugin.define({
  id: "autotelic.jig",

  async setup(ctx) {
    /** The location the plugin was loaded in — the repository an agent is working in. */
    const root = ctx.location.directory

    await ctx.tool.transform((editor) => {
      editor.namespace({
        name: "jig",
        description:
          "Run every conformance engine in this repository in one pass and read the merged report.",
      })

      editor.add({
        name: "check",
        description:
          "Run every conformance engine configured for this repository (plumb, joggle, cutlist, …) and return one merged report of errors, warnings, and notices, plus a note for any engine that could not run — and whether an engine replayed a cache or skipped a rule, because a note means 'not looked at', never 'clean'.",
        input: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description:
                "Repository to check, relative to this location. Default: this location's directory.",
            },
            format: {
              type: "string",
              enum: ["text", "github", "json"],
              description: "How to render the report. Default: text.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "jig", codemode: true },
        execute: async (input, context) => {
          const options = (input ?? {}) as { readonly cwd?: unknown; readonly format?: unknown }
          const directory = directoryFor(options.cwd, root)
          const format = typeof options.format === "string" ? options.format : "text"
          const outcome = await runJig(
            directory,
            ["check", "--cwd", directory, "--format", format],
            context.signal,
          )
          return {
            content: outcome.output === "" ? `jig check exited ${outcome.code}` : outcome.output,
            metadata: { exitCode: outcome.code, cwd: directory },
          }
        },
      })

      editor.add({
        name: "onboard",
        description:
          "Read the setup plan and agent prompt for jig in this repository without writing anything. It names the package manager, the engines that can run, the paths init would write, and where to stop and ask. Run `jig init` only after a human approves the plan.",
        input: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description:
                "Repository to inspect, relative to this location. Default: this location's directory.",
            },
            format: {
              type: "string",
              enum: ["text", "json"],
              description: "The prompt alone, or the prompt with the plan as JSON. Default: text.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "jig", codemode: true },
        execute: async (input, context) => {
          const options = (input ?? {}) as { readonly cwd?: unknown; readonly format?: unknown }
          const directory = directoryFor(options.cwd, root)
          const format = options.format === "json" ? "json" : "text"
          const outcome = await runJig(
            directory,
            ["onboard", "--cwd", directory, "--format", format],
            context.signal,
          )
          return {
            content: outcome.output === "" ? `jig onboard exited ${outcome.code}` : outcome.output,
            metadata: { exitCode: outcome.code, cwd: directory },
          }
        },
      })

      editor.add({
        name: "init",
        description:
          "Apply the jig setup plan: write jig.config.json, the baseline, JIG.md, ONBOARD.md, a starter joggle.config.json, and optionally a cutlist draft. Use only after a human has approved the plan from `jig.onboard`; this writes files.",
        input: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description:
                "Repository to set up, relative to this location. Default: this location.",
            },
            cutlist: {
              type: "boolean",
              description: "Also draft cutlist.config.json from detected UI roots. Default false.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "jig", codemode: true },
        execute: async (input, context) => {
          const options = (input ?? {}) as { readonly cwd?: unknown; readonly cutlist?: unknown }
          const directory = directoryFor(options.cwd, root)
          const outcome = await runJig(
            directory,
            ["init", "--cwd", directory, ...(options.cutlist === true ? ["--cutlist"] : [])],
            context.signal,
          )
          return {
            content: outcome.output === "" ? `jig init exited ${outcome.code}` : outcome.output,
            metadata: { exitCode: outcome.code, cwd: directory },
          }
        },
      })

      editor.add({
        name: "menu",
        description:
          "Read the cutlist artifact for this repository: the stable shape, or the parts/features/recipes that answer a query. Use this before building UI; it reads the generated menu, patterns, and recipes.",
        input: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Repository to read, relative to this location. Default: this location.",
            },
            query: {
              type: "string",
              description: "A part, feature, or concept to find. Omit for the stable shape.",
            },
            limit: {
              type: "number",
              description: "Maximum matches. Default 12.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "jig", codemode: true },
        execute: async (input, context) => {
          const options = (input ?? {}) as {
            readonly cwd?: unknown
            readonly query?: unknown
            readonly limit?: unknown
          }
          const directory = directoryFor(options.cwd, root)
          const query = typeof options.query === "string" ? options.query : undefined
          const limit = typeof options.limit === "number" ? options.limit : 12
          const outcome = await runJig(
            directory,
            [
              "menu",
              "--cwd",
              directory,
              "--limit",
              String(limit),
              ...(query === undefined || query === "" ? [] : [query]),
            ],
            context.signal,
          )
          return {
            content: outcome.output === "" ? `jig menu exited ${outcome.code}` : outcome.output,
            metadata: { exitCode: outcome.code, cwd: directory },
          }
        },
      })

      editor.add({
        name: "engines",
        description:
          "List the conformance engines jig is configured to run here, and whether each engine's command is on PATH.",
        input: {
          type: "object",
          properties: {
            cwd: {
              type: "string",
              description: "Repository to read, relative to this location. Default: this location.",
            },
          },
          additionalProperties: false,
        },
        options: { namespace: "jig", codemode: true },
        execute: async (input, context) => {
          const options = (input ?? {}) as { readonly cwd?: unknown }
          const directory = directoryFor(options.cwd, root)
          const outcome = await runJig(directory, ["engines", "--cwd", directory], context.signal)
          return {
            content: outcome.output === "" ? "no engines configured" : outcome.output,
            metadata: { exitCode: outcome.code, cwd: directory },
          }
        },
      })
    })

    await ctx.command.transform((editor) => {
      editor.add({
        name: "jig",
        description: "Run `jig check` here and feed the report back to the session.",
        execute: async ({ sessionID, prompt, delivery }) => {
          const outcome = await runJig(root, ["check", "--cwd", root], undefined)
          // The report replaces what the user typed, but their attachments still belong to
          // the turn. `CommandInvocation.prompt` is the schema prompt; `ctx.session.prompt`
          // takes the wire prompt. They describe the same bytes and differ only under
          // `exactOptionalPropertyTypes`, where the schema keeps a `| undefined` arm on every
          // optional field the wire type drops. Rebuilding each attachment without that arm is
          // the whole of the difference — a bare `...prompt` does not compile.
          await ctx.session.prompt({
            sessionID,
            text: `Here is the conformance report for this repository:\n\n${outcome.output}`,
            delivery,
            ...(prompt.files === undefined
              ? {}
              : {
                  files: prompt.files.map(({ uri, name, description, mention }) => ({
                    uri,
                    ...(name === undefined ? {} : { name }),
                    ...(description === undefined ? {} : { description }),
                    ...(mention === undefined ? {} : { mention }),
                  })),
                }),
            ...(prompt.agents === undefined
              ? {}
              : {
                  agents: prompt.agents.map(({ name, mention }) => ({
                    name,
                    ...(mention === undefined ? {} : { mention }),
                  })),
                }),
            ...(prompt.skills === undefined
              ? {}
              : {
                  skills: prompt.skills.map(({ id, mention }) => ({
                    id,
                    ...(mention === undefined ? {} : { mention }),
                  })),
                }),
          })
        },
      })
    })
  },
})
