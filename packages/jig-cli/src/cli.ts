import { existsSync } from "node:fs"
import { join } from "node:path"
import { Console, Effect, FileSystem, Option, Path, Runtime } from "effect"
import { Argument, CliError, Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { accept, REPORT_FORMATS } from "@autotelic/protocol"
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts"
import { explainRule, lesson, promotion, renderLesson, renderPromotion } from "./commands.ts"
import { loadConfig } from "./config.ts"
import { resolveEngineCommand } from "./engines.ts"
import { EXIT, gateVerdict } from "./gate.ts"
import { touchedFiles } from "./git.ts"
import { findMatches, readArtifact, renderMatches, renderMenuJson, renderSummary } from "./menu.ts"
import { renderCodeClimate, renderJsonl, renderLsp, renderSarif } from "./projections.ts"
import { renderGithub, renderJson, renderText } from "./render.ts"
import { harnessRun } from "./run.ts"
import { isRoomInvocation, runRoom } from "./room.ts"
import { initialise, initJson, onboardingFor, summaryFor } from "./init.ts"

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
const context = ({
  cwd,
  config,
}: {
  readonly cwd: Option.Option<string>
  readonly config: Option.Option<string>
}) =>
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
      Flag.withDefault(20),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
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
    const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
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
    const { root, settings } = yield* context({ cwd: options.cwd, config: options.config })
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

const initCommand = Command.make(
  "init",
  {
    cwd: cwdFlag,
    gate: Flag.Literals("gate", ["touched-files", "all"]).pipe(
      Flag.withDescription(
        "What fails a run: only the change in front of you (default), or every finding in the repo.",
      ),
      Flag.optional,
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription("Rewrite jig.config.json, JIG.md and ONBOARD.md; never the baseline."),
      Flag.withDefault(false),
    ),
    cutlist: Flag.Boolean("cutlist").pipe(
      Flag.withDescription(
        "Draft cutlist.config.json from detected UI roots. Review it, run `cutlist build`, then re-run init --force to enable the engine.",
      ),
      Flag.withDefault(false),
    ),
    print: Flag.Boolean("print").pipe(
      Flag.withDescription("Print the plan and the agent prompt without writing anything."),
      Flag.withDefault(false),
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("How to render the plan. JSON is for a host that reads it."),
      Flag.withDefault("text"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())
      const result = yield* initialise(root, {
        force: options.force,
        gateMode: Option.getOrUndefined(options.gate),
        cutlist: options.cutlist,
        dryRun: options.print,
      })
      const prompt = options.print ? onboardingFor(result.profile) : undefined
      if (options.format === "json") {
        yield* write(initJson(result, prompt))
        return
      }
      yield* write(summaryFor(result))
      if (prompt !== undefined) {
        yield* write(`\n--- agent prompt begins ---\n${prompt}\n--- agent prompt ends ---`)
      }
    }),
).pipe(
  Command.withDescription(
    "Inspect the repository and write the harness it should have: the engines it can run, a touched-files gate, a baseline, the cookbook, and the agent prompt.",
  ),
  Command.withShortDescription("Scaffold the harness for this repo."),
)

const onboardCommand = Command.make(
  "onboard",
  {
    cwd: cwdFlag,
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("The prompt alone, or the prompt with the plan as JSON."),
      Flag.withDefault("text"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())
      const result = yield* initialise(root, { dryRun: true })
      const prompt = onboardingFor(result.profile)
      yield* write(options.format === "json" ? initJson(result, prompt) : prompt)
    }),
).pipe(
  Command.withDescription(
    "Print the agent prompt that sets jig up here, without writing anything. The prompt names the first command and where to stop and ask.",
  ),
  Command.withShortDescription("Print the setup prompt for an agent."),
)

const writeFlag = Flag.Boolean("write").pipe(
  Flag.withDescription("Apply the change instead of printing it."),
  Flag.withDefault(false),
)

const explainCommand = Command.make(
  "explain",
  { rule: Argument.String("rule"), cwd: cwdFlag, config: configFlag },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
      const baseline = yield* readBaseline(path.resolve(root, settings.gate.baseline))
      const run = yield* harnessRun(root, settings, baseline)
      const configured = settings.engines.map((engine) => engine.id)
      yield* write(explainRule(run.report, options.rule, configured))
    }),
).pipe(
  Command.withDescription("Everything jig knows about one rule in this repo, right now."),
  Command.withShortDescription("Explain one rule."),
  Command.withExamples([
    {
      command: "jig explain plumb/no-raw-html-layout",
      description: "The rule's findings, with the fix.",
    },
  ]),
)

const promoteCommand = Command.make(
  "promote",
  { cwd: cwdFlag, config: configFlag, write: writeFlag },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
      const baseline = yield* readBaseline(path.resolve(root, settings.gate.baseline))
      const run = yield* harnessRun(root, settings, baseline)
      const plan = promotion(run.diff)
      // `promote` only ever shrinks the ledger. Dropping the identities that no longer fire
      // is the ratchet moving down; accepting a new one is `jig baseline`, a human's call.
      if (options.write && plan.stale.length > 0) {
        yield* writeBaseline(path.resolve(root, settings.gate.baseline), accept(run.diff.known))
        yield* write(renderPromotion({ plan, applied: true }))
      } else {
        yield* write(renderPromotion({ plan, applied: false }))
      }
    }),
).pipe(
  Command.withDescription(
    "Show the ratchet's next rung: accepted findings that no longer fire. Only ever shrinks.",
  ),
  Command.withShortDescription("Advance the ratchet."),
)

const learnCommand = Command.make(
  "learn",
  { cwd: cwdFlag, config: configFlag, write: writeFlag },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
      const baseline = yield* readBaseline(path.resolve(root, settings.gate.baseline))
      const run = yield* harnessRun(root, settings, baseline)
      const text = renderLesson(
        lesson(
          settings.engines.map((engine) => engine.id),
          run.diff,
        ),
      )
      const name = settings.agent?.cookbook ?? "JIG.md"
      if (options.write) {
        const fs = yield* FileSystem.FileSystem
        yield* fs.writeFileString(path.resolve(root, name), `${text}\n`)
        yield* write(`jig: wrote ${name}`)
      } else {
        yield* write(text)
      }
    }),
).pipe(
  Command.withDescription(
    "Write the agent cookbook, scaffolded from the rules this repo already accepts.",
  ),
  Command.withShortDescription("Rewrite the cookbook."),
)

const menuCommand = Command.make(
  "menu",
  {
    cwd: cwdFlag,
    query: Argument.String("query").pipe(
      Argument.withDescription(
        'A part, feature, or concept to find, for example "dialog" or "wizard".',
      ),
      Argument.optional,
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("Human text or the same view as JSON."),
      Flag.withDefault("text"),
    ),
    limit: Flag.Int("limit").pipe(
      Flag.withDescription("Maximum matches to print. Default 12."),
      Flag.withDefault(12),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())
      const artifact = readArtifact(root)
      const query = Option.getOrUndefined(options.query)
      const missing =
        artifact.menu === undefined &&
        artifact.patterns === undefined &&
        artifact.recipes === undefined
      if (missing) {
        yield* write(renderSummary(artifact, options.limit))
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }
      const matches = findMatches(artifact, query, options.limit)
      if (options.format === "json") {
        yield* write(renderMenuJson(artifact, matches, query ?? ""))
        return
      }
      yield* write(
        query === undefined
          ? renderSummary(artifact, options.limit)
          : renderMatches(artifact, matches, query),
      )
    }),
).pipe(
  Command.withDescription(
    "Read the cutlist artifact: the stable shape, or the parts and recipes that answer a query. This is the agent door to the menu; it does not re-analyse the tree.",
  ),
  Command.withShortDescription("Find a part in the cutlist menu."),
  Command.withExamples([
    { command: "jig menu", description: "Show the stable shape and the artifact files." },
    {
      command: "jig menu dialog",
      description: "Find parts, features, and recipes matching a word.",
    },
    { command: "jig menu wizard --format json", description: "Return the same view for a tool." },
  ]),
)

// `jig room` is a passthrough, not a subcommand: the room owns its flags and its help, and
// jig must not learn them. The seam stays a command line, like the engines.
if (isRoomInvocation(process.argv)) {
  process.exit(runRoom(process.argv))
}

const cli = Command.make("jig").pipe(
  Command.withDescription(
    "The harness: run every conformance engine in one pass, merge them into one report, and hold the ratchet. `jig room` opens the project room.",
  ),
  Command.withSubcommands([
    checkCommand,
    baselineCommand,
    enginesCommand,
    menuCommand,
    initCommand,
    onboardCommand,
    explainCommand,
    promoteCommand,
    learnCommand,
  ]),
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
