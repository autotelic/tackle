import { existsSync } from "node:fs"
import { join } from "node:path"
import { Console, Effect, FileSystem, Option, Path } from "effect"
import { Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { accept } from "@autotelic/protocol"
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts"
import { defaultConfig, loadConfig } from "./config.ts"
import { renderGithub, renderJson, renderText } from "./render.ts"
import { harnessRun } from "./run.ts"

/** One line through Effect's Console, newline-normalized. */
const write = (text: string): Effect.Effect<void> =>
  Console.log(text.endsWith("\n") ? text.slice(0, -1) : text)

const cwdFlag = Flag.String("cwd").pipe(
  Flag.withDescription("Project root (default: the current directory)."),
  Flag.optional,
)

const configFlag = Flag.String("config").pipe(
  Flag.withDescription("Config file, relative to the root (default jig.config.json)."),
  Flag.optional,
)

/** Resolve the root and its config the same way in every command. */
const context = (cwd: Option.Option<string>, config: Option.Option<string>) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const root = path.resolve(Option.getOrUndefined(cwd) ?? process.cwd())
    const settings = yield* loadConfig(
      path.resolve(root, Option.getOrUndefined(config) ?? "jig.config.json"),
    )
    return { path, root, settings }
  })

const checkCommand = Command.make(
  "check",
  {
    cwd: cwdFlag,
    config: configFlag,
    format: Flag.Literals("format", ["text", "json", "github"]).pipe(
      Flag.withDescription("How to render the report."),
      Flag.withDefault("text"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context(options.cwd, options.config)
      const baseline = yield* readBaseline(path.resolve(root, settings.gate.baseline))
      const run = yield* harnessRun(root, settings, baseline)

      if (options.format === "json") yield* write(renderJson(run.report))
      else if (options.format === "github") yield* write(renderGithub(run.report))
      else yield* write(renderText(run))

      const maxWarnings = settings.report?.maxWarnings ?? -1
      const failed =
        run.report.counts.error > 0 ||
        run.violations.length > 0 ||
        (maxWarnings >= 0 && run.report.counts.warn > maxWarnings)
      if (failed) {
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
      }
    }),
).pipe(
  Command.withDescription("Run every engine and fail on errors and new findings."),
  Command.withShortDescription("Run every engine; hold the ratchet."),
  Command.withExamples([
    { command: "jig check", description: "Run everything and print the census." },
    { command: "jig check --format github", description: "Emit GitHub Actions annotations." },
  ]),
)

const baselineCommand = Command.make("baseline", { cwd: cwdFlag, config: configFlag }, (options) =>
  Effect.gen(function* () {
    const { path, root, settings } = yield* context(options.cwd, options.config)
    const run = yield* harnessRun(root, settings, emptyBaseline)
    const baseline = accept(run.report.diagnostics)
    yield* writeBaseline(path.resolve(root, settings.gate.baseline), baseline)
    yield* write(
      `jig: accepted ${baseline.identities.length} finding(s) into ${settings.gate.baseline}`,
    )
  }),
).pipe(
  Command.withDescription("Accept the current findings into the baseline."),
  Command.withShortDescription("Accept the current findings."),
)

const enginesCommand = Command.make("engines", { cwd: cwdFlag, config: configFlag }, (options) =>
  Effect.gen(function* () {
    const { settings } = yield* context(options.cwd, options.config)
    const onPath = (name: string): boolean =>
      (process.env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, name)))
    const lines = ["engine              kind            command        on PATH"]
    for (const engine of settings.engines) {
      const command = engine.command ?? engine.id
      const enabled = engine.enabled === false ? " (disabled)" : ""
      lines.push(
        `${engine.id.padEnd(19)} ${engine.kind.padEnd(15)} ${command.padEnd(14)} ${
          onPath(command) ? "yes" : "no"
        }${enabled}`,
      )
    }
    yield* write(lines.join("\n"))
  }),
).pipe(
  Command.withDescription("List configured engines and whether their command is on PATH."),
  Command.withShortDescription("List configured engines."),
)

const COOKBOOK = `# JIG.md

The agents you run here get the same findings a human's terminal does — one report,
one vocabulary. Reach for these instead of re-deriving them:

- \`jig check\` — run every engine, one oxlint-shaped report, fail on what is new.
- \`jig baseline\` — accept the current findings; the ledger only shrinks after that.

Grounded rules come from the vocabulary \`cutlist\` builds (the UI catalog and menu);
prefer the components the menu already lists over new ones.
`

const initCommand = Command.make("init", { cwd: cwdFlag }, (options) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const fs = yield* FileSystem.FileSystem
    const root = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())

    const config = path.resolve(root, "jig.config.json")
    if (!(yield* Effect.orElseSucceed(fs.exists(config), () => false))) {
      yield* fs.writeFileString(
        config,
        `${JSON.stringify({ $schema: "https://autotelic.dev/tackle/protocol/jig.config.json", ...defaultConfig }, null, 2)}\n`,
      )
    }
    const baseline = path.resolve(root, defaultConfig.gate.baseline)
    if (!(yield* Effect.orElseSucceed(fs.exists(baseline), () => false))) {
      yield* writeBaseline(baseline, emptyBaseline)
    }
    const cookbook = path.resolve(root, defaultConfig.agent?.cookbook ?? "JIG.md")
    if (!(yield* Effect.orElseSucceed(fs.exists(cookbook), () => false))) {
      yield* fs.writeFileString(cookbook, COOKBOOK)
    }
    yield* write(`jig: initialised ${root}`)
  }),
).pipe(
  Command.withDescription("Write jig.config.json, an empty baseline, and the agent cookbook."),
  Command.withShortDescription("Scaffold the harness."),
)

const cli = Command.make("jig").pipe(
  Command.withDescription(
    "The harness: run every conformance engine in one pass, merge them into one report, and hold the ratchet.",
  ),
  Command.withSubcommands([checkCommand, baselineCommand, enginesCommand, initCommand]),
)

const program = Command.run(cli, { version: "0.0.0" }).pipe(Effect.provide(NodeServices.layer))

NodeRuntime.runMain(program, { disableErrorReporting: true })
