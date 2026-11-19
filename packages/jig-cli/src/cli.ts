import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { Console, Effect, FileSystem, Option, Path, Runtime } from "effect"
import { Argument, CliError, Command, Flag } from "effect/cli"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import {
  accept,
  diffBaseline,
  ruleNameOf,
  REPORT_FORMATS,
  type HarnessConfig,
} from "@autotelic/protocol"
import { emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts"
import { explainRule, lesson, promotion, renderLesson, renderPromotion } from "./commands.ts"
import { loadConfig } from "./config.ts"
import type { Spawner } from "./exec.ts"
import { resolveEngineCommand } from "./engines.ts"
import { EXIT, gateVerdict } from "./gate.ts"
import { changedInPullRequest, changedSince, touchedFiles } from "./git.ts"
import {
  answerGraph,
  findMatches,
  readArtifact,
  renderGraphAnswer,
  renderMatches,
  renderMenuJson,
  renderSummary,
} from "./menu.ts"
import { renderCodeClimate, renderJsonl, renderLsp, renderSarif } from "./projections.ts"
import { renderGithub, renderJson, renderText } from "./render.ts"
import { harnessRun, type HarnessRun } from "./run.ts"
import { isRoomInvocation, runRoom } from "./room.ts"
import { initialise, initJson, onboardingFor, summaryFor } from "./init.ts"

/**
 * The version a `--version` prints.
 *
 * Every member of the family is `0.0.0` until it is published, so after a rebuild the number
 * cannot answer "is my link current?". When jig runs from a checkout the commit is the answer,
 * and it rides along as semver build metadata: `0.0.0+1a2b3c4`.
 */
const versionOf = (): string => {
  // SAFETY: `execFileSync` is the synchronous boundary to git. A published tarball and a plain
  // directory have no repository, which is the ordinary case here rather than an error, and the
  // version without a commit is the answer there.
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim()
    return sha === "" ? "0.0.0" : `0.0.0+${sha}`
  } catch {
    return "0.0.0"
  }
}

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

/** Said by `jig engines` when there is no config: these rows are jig's defaults, not the repo's. */
const DEFAULTS_NOTICE =
  "no jig.config.json here: these are jig's defaults, not this repository's config -- run `jig init`"

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
    const file = path.resolve(root, Option.getOrUndefined(config) ?? "jig.config.json")
    const fs = yield* FileSystem.FileSystem
    // A default config is not this repo's config: a command that prints engines must be able
    // to say so instead of presenting jig's defaults as something someone configured.
    const configured = yield* Effect.orElseSucceed(fs.exists(file), () => false)
    const settings = yield* loadConfig(file)
    return { path, root, settings, configured }
  })

/**
 * The gate a run earns under this repo's config.
 *
 * One place, because `check` and `baseline` must agree about what the ledger buys: a
 * baseline that reports success while the gate ignores the ledger is a trap, and the two
 * commands disagreeing about the scope is how that trap opens.
 */
const verdictOf = (
  root: string,
  settings: HarnessConfig,
  run: HarnessRun,
  scoped?: ReadonlySet<string>,
) =>
  Effect.gen(function* () {
    // An explicit scope wins over the config: --since/--pr is a question about this change,
    // and answering it with the repository's default gate would be a different run.
    const touched =
      scoped ?? (settings.gate.mode === "touched-files" ? yield* touchedFiles(root) : undefined)
    return gateVerdict(run, {
      mode: touched === undefined ? "all" : "touched-files",
      failOn: settings.gate.failOn ?? "any-new",
      maxWarnings: settings.report?.maxWarnings ?? -1,
      touched: touched ?? new Set<string>(),
      advisory: new Set(
        settings.engines.filter((engine) => engine.advisory === true).map((engine) => engine.id),
      ),
    })
  })

/**
 * The change set `--changed`/`--since`/`--pr` asked for, and why it could not be read.
 *
 * Named for what it is, not for the flag: joggle has its own `Scope` (the files a run
 * changed versus moved), and two packages that never import each other must not give two
 * concepts one name.
 */
type ChangeScope =
  | { readonly kind: "none" }
  | { readonly kind: "resolved"; readonly touched: ReadonlySet<string>; readonly label: string }
  | { readonly kind: "failed"; readonly label: string }

/**
 * Resolve the scope flag into a change set, or say which question went unanswered.
 *
 * A scope that cannot be resolved is NOT degraded to the whole tree: that would answer
 * "is the repository clean" while the caller asked "is my change clean". It is reported as
 * an infrastructure fault, the exit code that already means "this run did not look".
 */
const resolveScope = (
  root: string,
  options: {
    readonly changed: boolean
    readonly since: Option.Option<string>
    readonly pr: boolean
    readonly prNumber: Option.Option<string>
  },
): Effect.Effect<ChangeScope, never, Spawner> =>
  Effect.gen(function* () {
    const asked = [
      options.changed ? "--changed" : undefined,
      Option.isSome(options.since) ? "--since" : undefined,
      options.pr ? "--pr" : undefined,
      Option.isSome(options.prNumber) ? "--pr-number" : undefined,
    ].filter((entry) => entry !== undefined)
    if (asked.length > 1) {
      return { kind: "failed", label: `choose one scope, not ${asked.join(" + ")}` }
    }
    if (options.changed) {
      const touched = yield* touchedFiles(root)
      return touched === undefined
        ? { kind: "failed", label: "git could not say what the working tree changes" }
        : { kind: "resolved", touched, label: "the working tree" }
    }
    const since = Option.getOrUndefined(options.since)
    if (since !== undefined) {
      const touched = yield* changedSince({ root, revision: since })
      return touched === undefined
        ? { kind: "failed", label: `git could not resolve ${since}` }
        : { kind: "resolved", touched, label: `since ${since}` }
    }
    const number = Option.getOrUndefined(options.prNumber)
    if (options.pr || number !== undefined) {
      const touched = yield* changedInPullRequest({ root, number })
      const label =
        number === undefined ? "the current branch's pull request" : `pull request #${number}`
      return touched === undefined
        ? { kind: "failed", label: `gh could not list the files of ${label}` }
        : { kind: "resolved", touched, label }
    }
    return { kind: "none" }
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
    changed: Flag.Boolean("changed").pipe(
      Flag.withDescription(
        "Scope to files changed in the working tree, the set the touched-files gate reads.",
      ),
      Flag.withDefault(false),
    ),
    since: Flag.String("since").pipe(
      Flag.withDescription(
        "Scope to files changed since a git revision (for example origin/main).",
      ),
      Flag.optional,
    ),
    pr: Flag.Boolean("pr").pipe(
      Flag.withDescription("Scope to the current branch's pull request, as gh resolves it."),
      Flag.withDefault(false),
    ),
    prNumber: Flag.String("pr-number").pipe(
      Flag.withDescription("Scope to a specific pull request's changed files."),
      Flag.optional,
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
      const baseline = yield* readBaseline(path.resolve(root, settings.gate.baseline))
      const scope = yield* resolveScope(root, options)
      if (scope.kind === "failed") {
        yield* write("jig: " + scope.label)
        yield* Effect.sync(() => {
          process.exitCode = EXIT.usage
        })
        return
      }
      const touched = scope.kind === "resolved" ? scope.touched : undefined
      const run = yield* harnessRun(root, settings, baseline, touched)
      // The accepted identities, so a projection can say novel from known. An empty
      // baseline still counts as "given": everything is novel until it is accepted.
      const known = new Set(baseline.identities)
      const limit = options.limit
      // The flag wins, then the repo's configured default, then the human form.
      const format = Option.getOrUndefined(options.format) ?? settings.report?.format ?? "text"
      const verdict = yield* verdictOf(root, settings, run, touched)
      const scopeNote =
        scope.kind === "resolved" ? `${scope.label}: ${scope.touched.size} file(s)` : undefined

      switch (format) {
        case "json":
          yield* write(renderJson(run.report))
          break
        case "jsonl":
          yield* write(renderJsonl(run.report))
          break
        case "github":
          yield* write(renderGithub(run.report, { known, gate: verdict }))
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
          yield* write(
            renderText(
              run,
              scopeNote === undefined
                ? { limit, gate: verdict }
                : { limit, gate: verdict, scope: scopeNote },
            ),
          )
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
    {
      command: "jig check --since origin/main",
      description: "Answer for a branch: only findings in what it changed.",
    },
    {
      command: "jig check --pr 1862",
      description: "The same answer for one pull request, as gh lists its files.",
    },
  ]),
)

const baselineCommand = Command.make(
  "baseline",
  {
    cwd: cwdFlag,
    config: configFlag,
    allowUnjudged: Flag.Boolean("allow-unjudged").pipe(
      Flag.withDescription(
        "Accept findings no judgement reached. A judged run can name the same finding differently, so the ledger may not hold in CI.",
      ),
      Flag.withDefault(false),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const { path, root, settings } = yield* context({ cwd: options.cwd, config: options.config })
      const run = yield* harnessRun(root, settings, emptyBaseline)
      // An engine that could not verify a finding names it from what it could see, and a
      // judged run can name the same finding from the cluster: two identities for one thing.
      // Accepting the unverified one is therefore accepting a ledger CI cannot replay, which
      // is exactly how a green local baseline and a red CI run both look like a pass.
      const unverified = run.report.diagnostics.filter((diagnostic) => diagnostic.judged === false)
      if (unverified.length > 0 && options.allowUnjudged !== true) {
        yield* write(
          `jig: refusing to accept ${unverified.length} unverified finding(s) into ${settings.gate.baseline}.\n` +
            "  A judged run can name the same finding differently, so this ledger would not hold in CI.\n" +
            "  Judge first: joggle reads its model key from the environment (TYPESAFE_API_KEY).\n" +
            "  Pass --allow-unjudged to accept that debt anyway.",
        )
        yield* Effect.sync(() => {
          process.exitCode = EXIT.usage
        })
        return
      }
      const baseline = accept(run.report.diagnostics)
      yield* writeBaseline(path.resolve(root, settings.gate.baseline), baseline)
      yield* write(
        `jig: accepted ${baseline.identities.length} finding(s) into ${settings.gate.baseline}`,
      )
      if (unverified.length > 0) {
        yield* write(
          `jig: ${unverified.length} of them were unverified; a later judged run may report them as new identities`,
        )
      }
      // The postcondition, not a promise: write, then ask the same gate `check` would ask.
      // The ledger decides novelty alone, so under `failOn: warn|error` or a maxWarnings
      // ceiling these accepted findings still fail, and saying "accepted" would be a lie.
      const verdict = yield* verdictOf(root, settings, {
        report: run.report,
        diff: diffBaseline(baseline, run.report.diagnostics),
      })
      // The same exit code `check` would give, because a script that ran `baseline` and saw zero
      // would otherwise believe the repository became green.
      if (verdict.exitCode !== EXIT.clean) {
        yield* Effect.sync(() => {
          process.exitCode = verdict.exitCode
        })
      }
      if (verdict.exitCode === EXIT.infrastructure) {
        yield* write(
          `jig: the gate still cannot judge this run: engine(s) ${verdict.infrastructure.join(", ")} did not run (exit ${EXIT.infrastructure})`,
        )
      } else if (verdict.failing.length > 0) {
        const byRule = [...new Set(verdict.failing.map(ruleNameOf))].sort((left, right) =>
          left.localeCompare(right),
        )
        yield* write(
          `jig: accepted, but the gate still holds ${verdict.failing.length} of these finding(s) (exit ${verdict.exitCode}): ${byRule.join(", ")}.\n` +
            `  The ledger decides novelty; ${verdict.failOn === "any-new" ? "maxWarnings holds warnings by count regardless of the baseline" : `failOn "${verdict.failOn}" holds by severity, and severity ignores the baseline`}.`,
        )
      }
    }),
).pipe(
  Command.withDescription("Accept the current findings into the baseline."),
  Command.withShortDescription("Accept the current findings."),
  Command.withExamples([
    { command: "jig baseline", description: "Accept the verified findings into the ledger." },
    {
      command: "jig baseline --allow-unjudged",
      description: "Accept findings no judgement reached, and say so.",
    },
  ]),
)

const enginesCommand = Command.make("engines", { cwd: cwdFlag, config: configFlag }, (options) =>
  Effect.gen(function* () {
    const { root, settings, configured } = yield* context({
      cwd: options.cwd,
      config: options.config,
    })
    const onPath = (name: string): boolean =>
      (process.env.PATH ?? "").split(":").some((dir) => dir !== "" && existsSync(join(dir, name)))
    const header = "engine              kind            command        source"
    const lines = configured ? [header] : [header, DEFAULTS_NOTICE]
    for (const engine of settings.engines) {
      const command = engine.command ?? engine.id
      const enabled =
        (engine.enabled === false ? " (disabled)" : "") +
        (engine.advisory === true ? " (advisory)" : "")
      // The column reports where the run WILL draw the command from, so it asks the
      // resolver rather than scanning PATH on its own: project install, PATH, or neither.
      const resolved = resolveEngineCommand({ root, command })
      const source = resolved !== command ? "project" : onPath(command) ? "PATH" : "no"
      lines.push(
        `${engine.id.padEnd(19)} ${engine.kind.padEnd(15)} ${command.padEnd(14)} ${source}${enabled}`,
      )
    }
    if (lines.some((line) => line.endsWith(" no"))) {
      // `no` is the whole local-dev story on a fresh clone, and it used to say nothing about
      // what to do: an unpublished member of the family is linked from a checkout, not fetched.
      lines.push(
        "",
        "`no` means the command is neither in this project nor on PATH. Members of the family",
        "that are not published yet are linked from a checkout and built there:",
        "  pnpm add -D -w link:/path/to/checkout   # in this repo",
        "  pnpm build                              # in the checkout, and again after a change",
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
    hooks: Flag.Boolean("hooks").pipe(
      Flag.withDescription(
        "Write .git/hooks/pre-commit running the scoped gate. It steps aside loudly when the CLI is not on the machine, and never replaces a hook that is not jig's.",
      ),
      Flag.withDefault(false),
    ),
    unignore: Flag.Boolean("unignore").pipe(
      Flag.withDescription(
        "Remove the .gitignore lines that hide this harness. A pattern that hides one is reported, never edited.",
      ),
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
        hooks: options.hooks,
        unignore: options.unignore,
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
    gate: Flag.Literals("gate", ["touched-files", "all"]).pipe(
      Flag.withDescription(
        "What the plan should gate on: only the change in front of you (default), or every finding in the repo.",
      ),
      Flag.optional,
    ),
    force: Flag.Boolean("force").pipe(
      Flag.withDescription(
        "Plan a rewrite of jig.config.json, JIG.md and ONBOARD.md; never the baseline.",
      ),
      Flag.withDefault(false),
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("The prompt alone, or the prompt with the plan as JSON."),
      Flag.withDefault("text"),
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())
      const result = yield* initialise(root, {
        dryRun: true,
        force: options.force,
        gateMode: Option.getOrUndefined(options.gate),
      })
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
    page: Flag.String("page").pipe(
      Flag.withDescription("What does this page render? A route name, id, or path."),
      Flag.optional,
    ),
    part: Flag.String("part").pipe(
      Flag.withDescription("Which pages mount this part? A component name, id, or path."),
      Flag.optional,
    ),
    similar: Flag.String("similar").pipe(
      Flag.withDescription(
        "What already exists like this? A name, whether the part exists or not.",
      ),
      Flag.optional,
    ),
  },
  (options) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const root = path.resolve(Option.getOrUndefined(options.cwd) ?? process.cwd())
      const artifact = readArtifact(root)
      const query = Option.getOrUndefined(options.query)

      const page = Option.getOrUndefined(options.page)
      const part = Option.getOrUndefined(options.part)
      const similar = Option.getOrUndefined(options.similar)
      const graph = [
        page === undefined ? undefined : ({ kind: "page", ref: page } as const),
        part === undefined ? undefined : ({ kind: "part", ref: part } as const),
        similar === undefined ? undefined : ({ kind: "similar", ref: similar } as const),
      ].filter((question): question is NonNullable<typeof question> => question !== undefined)
      if (graph.length > 1) {
        yield* write("jig menu: ask one of --page, --part, --similar")
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }
      const question = graph[0]
      if (question !== undefined) {
        const answer = answerGraph(artifact, question)
        if (options.format === "json") {
          yield* write(
            `${JSON.stringify({ artifact: artifact.paths, question, ...answer }, null, 2)}\n`,
          )
        } else {
          yield* write(renderGraphAnswer(answer))
        }
        if (!answer.ok) {
          yield* Effect.sync(() => {
            process.exitCode = 1
          })
        }
        return
      }

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
    "Read the cutlist artifact: the stable shape, the parts and recipes that answer a query, or the graph questions — what a page renders, where a part appears, what a name resembles. This is the agent door to the menu; it does not re-analyse the tree.",
  ),
  Command.withShortDescription("Find a part in the cutlist menu."),
  Command.withExamples([
    { command: "jig menu", description: "Show the stable shape and the artifact files." },
    {
      command: "jig menu dialog",
      description: "Find parts, features, and recipes matching a word.",
    },
    {
      command: "jig menu --page dashboard_.$id",
      description: "What a route renders today, direct and through its children.",
    },
    {
      command: "jig menu --similar TablePanel",
      description: "What already exists before a new part is invented.",
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
const program = Command.run(cli, { version: versionOf() }).pipe(
  Effect.catchIf(CliError.isCliError, (error) =>
    Effect.sync(() => {
      process.exitCode = Runtime.getErrorExitCode(error) === 0 ? EXIT.clean : EXIT.usage
    }),
  ),
  Effect.provide(NodeServices.layer),
)

NodeRuntime.runMain(program, { disableErrorReporting: true })
