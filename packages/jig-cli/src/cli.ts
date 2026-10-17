import { existsSync } from "node:fs"
import { join } from "node:path"
import { Console, Effect, FileSystem, Option, Path, Runtime } from "effect"
import { CliError, Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { accept, REPORT_FORMATS } from "@autotelic/protocol"
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts"
import { defaultConfig, loadConfig } from "./config.ts"
import { resolveEngineCommand } from "./engines.ts"
import { EXIT, gateVerdict } from "./gate.ts"
import { touchedFiles } from "./git.ts"
import { renderCodeClimate, renderJsonl, renderLsp, renderSarif } from "./projections.ts"
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
    format: Flag.Literals("format", REPORT_FORMATS).pipe(
      Flag.withDescription(
        "How to render the report (default: the repo's `report.format`, else text).",
      ),
      Flag.optional,
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Maximum findings to print in the text report. 0 prints all."),
      Flag.withDefault(0),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context(options.cwd, options.config)
      const baseline = yield* readBaseline(path.resolve(root, settings.gate.baseline))
      const run = yield* harnessRun(root, settings, baseline)
      // The accepted identities, so a projection can say novel from known. An empty
      // baseline still counts as "given": everything is novel until it is accepted.
      const known = new Set(baseline.identities)
      const limit = options.limit
      // The flag wins, then the repo's configured default, then the human form.
      const format = Option.getOrUndefined(options.format) ?? settings.report?.format ?? "text"
      // The gate reads the scope git reports; when git cannot say, it widens to everything
      // rather than narrowing to nothing — an empty scope would pass every finding.
      const touched = settings.gate.mode === "touched-files" ? yield* touchedFiles(root) : undefined
      const verdict = gateVerdict(run, {
        mode: touched === undefined ? "all" : "touched-files",
        failOn: settings.gate.failOn ?? "any-new",
        maxWarnings: settings.report?.maxWarnings ?? -1,
        touched: touched ?? new Set<string>(),
      })

      switch (format) {
        case "json":
          yield* write(renderJson(run.report))
          break
        case "jsonl":
          yield* write(renderJsonl(run.report))
          break
        case "github":
          yield* write(renderGithub(run.report))
          break
        case "sarif":
          yield* write(renderSarif(run.report, known))
          break
        case "lsp":
          yield* write(renderLsp(run.report))
          break
        case "codeclimate":
          yield* write(renderCodeClimate(run.report))
          break
        default:
          yield* write(renderText(run, { limit, gate: verdict }))
          break
      }

      if (verdict.exitCode !== EXIT.clean) {
        yield* Effect.sync(() => {
          process.exitCode = verdict.exitCode
        })
      }
    }),
).pipe(
  Command.withDescription("Run every engine and fail on errors and new findings."),
  Command.withShortDescription("Run every engine; hold the ratchet."),
  Command.withExamples([
    { command: "jig check", description: "Run everything and print the census." },
    { command: "jig check --format github", description: "Emit GitHub Actions annotations." },
    { command: "jig check --format sarif", description: "Emit SARIF 2.1.0 for code scanning." },
    { command: "jig check --limit 20", description: "Print the census and the first 20 findings." },
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
    const { root, settings } = yield* context(options.cwd, options.config)
    const onPath = (name: string): boolean =>
      (process.env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, name)))
    const lines = ["engine              kind            command        source"]
    for (const engine of settings.engines) {
      const command = engine.command ?? engine.id
      const enabled = engine.enabled === false ? " (disabled)" : ""
      // The column reports where the run WILL draw the command from, so it asks the
      // resolver rather than scanning PATH on its own: project install, PATH, or neither.
      const resolved = resolveEngineCommand({ root, command })
      const source = resolved !== command ? "project" : onPath(command) ? "PATH" : "no"
      lines.push(
        `${engine.id.padEnd(19)} ${engine.kind.padEnd(15)} ${command.padEnd(14)} ${source}${enabled}`,
      )
    }
    yield* write(lines.join("\n"))
  }),
).pipe(
  Command.withDescription("List configured engines and where their command resolves from."),
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

// The run's own codes (0/1/3) are set on `process.exitCode` inside the handlers, and survive
// the clean teardown the runner uses for them. A parse error instead FAILS the effect with a
// `CliError`, which the runner would exit 1 for; catching it here maps it to the contract's 2,
// while `--help` — a request, not a mistake — stays 0.
const program = Command.run(cli, { version: "0.0.0" }).pipe(
  Effect.catchIf(CliError.isCliError, (error) =>
    Effect.sync(() => {
      process.exitCode = Runtime.getErrorExitCode(error) === 0 ? EXIT.clean : EXIT.usage
    }),
  ),
  Effect.provide(NodeServices.layer),
)

NodeRuntime.runMain(program, { disableErrorReporting: true })
