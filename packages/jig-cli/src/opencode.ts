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

/** This package's own installed `bin/jig.js`, one directory up from the built `dist/`. */
const ownBin = (): string => join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "jig.js")

const onPath = (name: string): boolean =>
  (process.env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, name)))

/** How to launch jig: a command and its leading args. */
interface Launcher {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

/**
 * How to invoke jig.
 *
 * `PATH` wins so the plugin and the shell get the same answer; `JIG_BIN` overrides both
 * for a checkout under test; the package's own bin is the fallback, so an installed plugin
 * works with no `jig` on `PATH` at all.
 */
const invoke = (): Launcher => {
  const override = process.env.JIG_BIN
  if (override !== undefined && override !== "") return { command: override, args: [] }
  if (onPath("jig")) return { command: "jig", args: [] }
  return { command: process.execPath, args: [ownBin()] }
}

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
          "Run every conformance engine configured for this repository (plumb, joggle, cutlist, …) and return one merged report of errors, warnings, and notices, plus a note for any engine that could not run. A note means 'not looked at', never 'clean'.",
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
