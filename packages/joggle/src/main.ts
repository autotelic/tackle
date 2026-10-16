import { Cause, Config, Console, Effect, Exit, FileSystem, Layer, Option, Path, Predicate, Result, Runtime } from "effect"
import { Argument, Command, Flag } from "effect/unstable/cli"
import { DecisionModel } from "effect/unstable/ai"
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { checkRepository } from "./check.ts"
import { layer as decisionLayer } from "./decision.ts"
import { make as makeAnswerStore, mergeShardText, prune as pruneAnswers } from "./answer-store.ts"
import { ask } from "./ask.ts"
import { cacheDirFor, runCacheDirFor } from "./state.ts"
import { loadConfig, isEnabled, severityFor } from "./config.ts"
import { layer as gitLayer, Service as Git } from "./git.ts"
import { loadPlugins, withDefaults } from "./plugins.ts"
import { policy } from "./policy.ts"
import { exitCodeFor, render } from "./report.ts"
import { isRecord, loadWorkspace } from "./workspace.ts"
import { answerPlansRaw, chunkPlans, type Plan, type PlanAnswers } from "./plans.ts"
import { layer as atomsLayer, type Atoms } from "./atoms.ts"
import { summarizeCalibration, type CalibrationState, type CalibrationSummary } from "./calibration.ts"
import { verdictOf } from "./verdict.ts"
import { everyFile, qualityOf, type DecisionAnswers, type PlannedRule } from "./rule.ts"
import { allRules, builtIn, Rules } from "./rules/index.ts"
import { layerFromConfig as tsgoLayer } from "./tsgo.ts"
import { emptyTypeIndex, loadTypeFacts, type TypeFactRequest, type TypeIndex } from "./typetrace.ts"
import { indexOfNodeTypes, typesAtPositions, type NodeTypeIndex, type NodeTypeQuery } from "./typefacts.ts"
import { manifestOf } from "./run-cache.ts"
import { sourceFingerprint } from "./fingerprint.ts"

/**
 * One report, through Effect's Console rather than a raw stdout write.
 *
 * `Console.log` appends the newline, so a body that already ends in one is
 * trimmed first; the output is byte-identical and a test can capture it.
 */
const write = (text: string): Effect.Effect<void> =>
  Console.log(text.endsWith("\n") ? text.slice(0, -1) : text)

/**
 * The repository's rule set: its config, its plugins, and the layer the run
 * reads.
 *
 * One function so `check` and `rules` cannot disagree about what is enforced.
 * They did: `rules` listed the built-ins while `check` ran the configured
 * preset, which is the one output a reader uses to answer "what is enforced".
 */
const ruleSetFor = (cwd: string, configFile: string | undefined) =>
  Effect.gen(function* () {
    const path = yield* Path.Path
    const settings = yield* loadConfig(path.resolve(cwd, configFile ?? "joggle.config.json"))
    const loaded = yield* loadPlugins(
      [...(settings.presets ?? []), ...(settings.plugins ?? [])],
      cwd,
    )
    // A preset's severities and scoping sit under the repository's own, per rule:
    // enabling twenty opinions and then turning one off should not mean
    // restating the other nineteen.
    const effective = withDefaults(loaded.config, settings)
    // The repository's rules join the built-in ones here, once, so the run
    // itself reads one rule set from the context and never sees a plugin.
    return {
      settings,
      loaded,
      effective,
      rules: [...allRules, ...loaded.rules],
      layer: Layer.succeed(Rules, [...allRules, ...loaded.rules]),
    }
  })

const checkCommand = Command.make(
  "check",
  {
    paths: Argument.String("paths").pipe(
      Argument.withDescription(
        "Files or directories to analyse. Default: whatever tsgo says the project is.",
      ),
      Argument.variadic(),
    ),
    rule: Flag.String("rule").pipe(
      Flag.withDescription("Only run these rule ids, comma-separated."),
      Flag.optional,
    ),
    format: Flag.Literals("format", ["text", "stylish", "unix", "json", "github"]).pipe(
      Flag.withDescription("How to render the report."),
      Flag.withDefault("text"),
    ),
    maxWarnings: Flag.Int("max-warnings").pipe(
      Flag.withDescription("Exit non-zero when warnings exceed this count (-1 disables)."),
      Flag.withDefault(-1),
    ),
    typecheck: Flag.Boolean("typecheck").pipe(
      Flag.withDescription("Include tsgo's own diagnostics as joggle/typecheck."),
      Flag.withDefault(false),
    ),
    types: Flag.Boolean("types").pipe(
      Flag.withDescription("Resolve declaration types through tsgo's trace (enables type-aware rules)."),
      Flag.withDefault(false),
    ),
    maxTokens: Flag.Int("max-tokens").pipe(
      Flag.withDescription("Input-token budget for judgement in this run."),
      Flag.withDefault(policy.decision.maxInputTokens),
    ),
    offline: Flag.Boolean("offline").pipe(
      Flag.withDescription("Answer only from the committed judgement cache; never call the model."),
      Flag.withDefault(false),
    ),
    noTsgo: Flag.Boolean("no-tsgo").pipe(
      Flag.withDescription("Never invoke tsgo; walk the paths on disk instead."),
      Flag.withDefault(false),
    ),
    noReplay: Flag.Boolean("no-replay").pipe(
      Flag.withDescription("Do not reuse the stored run when nothing changed."),
      Flag.withDefault(false),
    ),
    changed: Flag.Boolean("changed").pipe(
      Flag.withDescription("Scope to files changed since the stored run (machine-local)."),
      Flag.withDefault(false),
    ),
    since: Flag.String("since").pipe(
      Flag.withDescription("Scope to files changed since a git revision (for example origin/main)."),
      Flag.optional,
    ),
    pr: Flag.Boolean("pr").pipe(
      Flag.withDescription("Scope to the pull request for the current branch."),
      Flag.withDefault(false),
    ),
    prNumber: Flag.String("pr-number").pipe(
      Flag.withDescription("Scope to a specific pull request, by number or URL."),
      Flag.optional,
    ),
    baseline: Flag.String("baseline").pipe(
      Flag.withDescription("Report only findings not already accepted in this baseline file."),
      Flag.optional,
    ),
    updateBaseline: Flag.String("update-baseline").pipe(
      Flag.withDescription("Write the current findings to this file as the accepted baseline."),
      Flag.optional,
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription("Where the answer cache lives: <cwd>/.joggle when it exists (an onboarded repository), otherwise the machine cache."),
      Flag.optional,
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root to analyse (default: the current directory)."),
      Flag.optional,
    ),
    config: Flag.String("config").pipe(
      Flag.withDescription("Config file, relative to the project root (default joggle.config.json)."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      // Absolute at the boundary. Everything downstream compares paths -- tsgo's
      // file list against the root, git's changed files against the workspace --
      // and a relative root makes those comparisons fail quietly.
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const cacheDir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const apiKey = yield* Config.option(Config.String("TYPESAFE_API_KEY"))
      const ruleFlag = Option.getOrUndefined(config.rule)
      const rules =
        ruleFlag === undefined
          ? undefined
          : ruleFlag
              .split(",")
              .map((id) => id.trim())
              .filter((id) => id.length > 0)

      // Relative to the analysed root, so a config travels with the repository it
      // describes rather than with the shell that invoked the tool.
      const ruleSet = yield* ruleSetFor(cwd, Option.getOrUndefined(config.config))
      const { loaded, effective } = ruleSet
      const rulesLayer = ruleSet.layer

      // The git base, resolved before the run so the engine never has to know
      // about git. `--pr` wins when both are given: it is the more specific
      // question, and its answer already implies a base. An empty string is the
      // adapter's spelling of "the pull request for this branch".
      const since = Option.getOrUndefined(config.since)
      const prNumber = Option.getOrUndefined(config.prNumber)
      const git = yield* Git
      const gitScope =
        config.pr || prNumber !== undefined
          ? { pr: prNumber ?? "" }
          : since === undefined
            ? undefined
            : { since }
      const changedSet =
        gitScope === undefined ? undefined : yield* git.changedFiles(cwd, gitScope)
      const changedPaths = changedSet?.changed
      const movedPaths = changedSet?.renamed
      const changedBase =
        gitScope === undefined
          ? undefined
          : gitScope.pr !== undefined
            ? gitScope.pr === ""
              ? "the current branch's pull request"
              : "PR " + gitScope.pr
            : gitScope.since

      // The machine cache holds the run cache and the wire cache. The
      // per-decision answer cache in `cacheDir` is the one CI replays.
      const machineCache = yield* runCacheDirFor(cwd)

      const report = yield* checkRepository({
        config: effective,
        plugins: loaded,
        cwd,
        paths: config.paths,
        rules,
        typecheck: config.typecheck,
        types: config.types ? "trace" : "off",
        maxInputTokens: config.maxTokens,
        useTsgo: !config.noTsgo,
        cacheDirExplicit: Option.isSome(config.cacheDir),
        cacheDir,
        // The run cache is machine-local on purpose: it is a performance
        // artifact, and a run should not write a report into a repository it is
        // only visiting.
        runCacheDir: machineCache,
        // A git-scoped run is never a replay: the stored report is the whole
        // repository, and the caller asked about a slice of it.
        replayUnchanged: !config.noReplay && changedPaths === undefined,
        changed: config.changed,
        changedPaths,
        movedPaths,
        changedBase,
        baselinePath: Option.getOrUndefined(config.baseline),
        updateBaselinePath: Option.getOrUndefined(config.updateBaseline),
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            rulesLayer,
            decisionLayer({ cacheDir, wireCacheDir: machineCache, offline: config.offline, apiKey }),
            tsgoLayer(cwd),
          ),
        ),
      )

      yield* write(render(report, config.format, { color: process.stdout.isTTY === true }))
      yield* Effect.sync(() => {
        process.exitCode = exitCodeFor(report, config.maxWarnings)
      })
    }).pipe(Effect.provide(gitLayer)),
).pipe(
  Command.withDescription(
    "Report cross-file duplication and naming drift. With no paths, analyse the project tsgo sees. --since, --pr and --pr-number answer what a change introduced; --changed does the same against the last stored run.",
  ),
  Command.withShortDescription("Report cross-file duplication and naming drift."),
  Command.withExamples([
    { command: "joggle check", description: "Analyse the project tsgo sees." },
    {
      command: "joggle check src --format stylish",
      description: "Read findings for a directory, grouped by file.",
    },
    {
      command: "joggle check --pr",
      description: "Report only what this branch's pull request introduced.",
    },
    {
      command: "joggle check --since origin/main",
      description: "Report only what this branch introduced, from git.",
    },
    {
      command: "joggle check --offline",
      description: "Replay committed judgements; never call the model.",
    },
    { command: "joggle check --format github", description: "Emit GitHub Actions annotations." },
  ]),
)

const askCommand = Command.make(
  "ask",
  {
    query: Argument.String("query").pipe(
      Argument.withDescription('A question in prose, for example "where is the retry policy defined?".'),
    ),
    paths: Argument.String("paths").pipe(
      Argument.withDescription("Files or directories to rank against. Default: the whole project."),
      Argument.variadic(),
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription("Where the answer cache lives: <cwd>/.joggle when it exists (an onboarded repository), otherwise the machine cache."),
      Flag.optional,
    ),
    maxTokens: Flag.Int("max-tokens").pipe(
      Flag.withDescription("Input-token budget; candidates are trimmed to fit and the request is halved if the provider still rejects it."),
      Flag.withDefault(policy.ask.maxInputTokens),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root to analyse (default: the current directory)."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const cacheDir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const apiKey = yield* Config.option(Config.String("TYPESAFE_API_KEY"))
      const workspace = yield* loadWorkspace(cwd, config.paths.length > 0 ? config.paths : ["."])
      const answer = yield* ask(workspace, config.query, { maxInputTokens: config.maxTokens }).pipe(
        Effect.provide(
          decisionLayer({
            cacheDir,
            wireCacheDir: yield* runCacheDirFor(cwd),
            offline: false,
            apiKey,
          }),
        ),
      )
      yield* write(
        [
          answer.exists.toFixed(2) +
            " that the code answers this; " +
            answer.considered +
            " declaration(s) ranked",
          ...answer.matches.map(
            (match) =>
              match.confidence.toFixed(3) +
              "  " +
              match.file +
              ":" +
              match.line +
              "  " +
              match.symbol +
              " (" +
              match.symbolKind +
              ")",
          ),
        ].join("\n"),
      )
    }),
).pipe(
  Command.withDescription("Ask a question about the code; rank the declarations that answer it."),
  Command.withShortDescription("Rank declarations that answer a question."),
  Command.withExamples([
    {
      command: 'joggle ask "where is the retry policy defined?"',
      description: "Rank the declarations that answer a question.",
    },
  ]),
)

const rules = Command.make(
  "rules",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root whose config to read (default: the current directory)."),
      Flag.optional,
    ),
    config: Flag.String("config").pipe(
      Flag.withDescription("Config file, relative to the project root (default joggle.config.json)."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      // The same rule set the check runs, so this answers "what is enforced"
      // rather than "what ships".
      const ruleSet = yield* ruleSetFor(cwd, Option.getOrUndefined(config.config))
      const all = ruleSet.rules.filter((rule) => isEnabled(ruleSet.effective, rule.id, rule.severity))
      const width = all.reduce((max, rule) => Math.max(max, rule.id.length), 0)
      const lines = all.map(
        (rule) =>
          `${rule.id.padEnd(width)}  ${severityFor(ruleSet.effective, rule.id, rule.severity).padEnd(5)}  ${rule.judged ? "judged" : "static"}  ${rule.description}`,
      )
      // A plugin that failed to load is the difference between "not enforced"
      // and "silently absent", and this is the command that should say so.
      for (const failure of ruleSet.loaded.failures) {
        lines.push(`note: ${failure.specifier} was not loaded: ${failure.reason}`)
      }
      yield* write(lines.join("\n"))
    }),
).pipe(
  Command.withDescription("List the rules this repository enforces, with their severities."),
  Command.withShortDescription("List the enforced rules."),
  Command.withExamples([
    { command: "joggle rules", description: "What the current repository enforces." },
    {
      command: "joggle rules --cwd ../other-repo",
      description: "What another repository enforces.",
    },
  ]),
)

const calibrateCommand = Command.make(
  "calibrate",
  {
    paths: Argument.String("paths").pipe(
      Argument.withDescription("Files or directories whose candidates to calibrate against. Default: the whole project."),
      Argument.variadic(),
    ),
    rule: Flag.String("rule").pipe(
      Flag.withDescription("Only calibrate these rule ids (comma-separated)."),
      Flag.optional,
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root to analyse (default: the current directory)."),
      Flag.optional,
    ),
    config: Flag.String("config").pipe(
      Flag.withDescription("Config file, relative to the project root (default joggle.config.json)."),
      Flag.optional,
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription("Where answers are cached: <cwd>/.joggle when it exists, otherwise the machine cache."),
      Flag.optional,
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("Output format (default text)."),
      Flag.withDefault("text"),
    ),
    types: Flag.Boolean("types").pipe(
      Flag.withDescription(
        "Resolve types, so the type rules can be calibrated: the declaration trace and the per-expression node types. Costs a program, like check --types.",
      ),
      Flag.withDefault(false),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const ruleSet = yield* ruleSetFor(cwd, Option.getOrUndefined(config.config))
      const wanted = Option.getOrUndefined(config.rule)
        ?.split(",")
        .map((id) => id.trim())
        .filter((id) => id !== "")
      // Only judged rules have a question to calibrate.
      const rules = ruleSet.rules.filter(
        (rule): rule is PlannedRule =>
          "plan" in rule &&
          isEnabled(ruleSet.effective, rule.id, rule.severity) &&
          (wanted === undefined || wanted.includes(rule.id)),
      )
      const cacheDir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const apiKey = yield* Config.option(Config.String("TYPESAFE_API_KEY"))
      const inputs = config.paths.length > 0 ? config.paths : ["."]

      const rows = yield* Effect.gen(function* () {
        // A type rule cannot be calibrated without the facts it reads, and there
        // are two: the declaration trace (`workspace.types`, for a guard's declared
        // type) and the node types (`RunContext.nodeTypes`, for a returned
        // expression's resolved type). Both cost a program, so it is opt-in. This
        // is inside the effect that provides tsgo, which is why it is here and not
        // beside the other loading above.
        let types: TypeIndex = emptyTypeIndex
        if (config.types) {
          const tool = yield* sourceFingerprint(policy.analysisVersion)
          const manifest = manifestOf(cwd, [], new Map(), rules.map((rule) => rule.id), tool)
          const loaded = yield* loadTypeFacts({ root: cwd, cacheDir, tool, manifest } satisfies TypeFactRequest)
          types = loaded.index
        }
        const workspace = yield* loadWorkspace(cwd, inputs, { types })
        let nodeTypes: NodeTypeIndex | undefined
        if (config.types) {
          const requests = workspace.files
            .flatMap((file) => file.facts.returns.map((entry) => ({ file: file.path, position: entry.start })))
            .slice(0, 2000)
          if (requests.length > 0) {
            const found = yield* Effect.tryPromise(() =>
              typesAtPositions({ cwd, tsconfig: "tsconfig.json", requests } satisfies NodeTypeQuery),
            ).pipe(Effect.orElseSucceed(() => ({ found: [], unresolved: 0 })))
            nodeTypes = indexOfNodeTypes(found.found)
          }
        }
        const out: Array<{ readonly rule: string; readonly decision: string; readonly summary: CalibrationSummary; readonly note: string; readonly sample: ReadonlyArray<string> }> = []
        for (const rule of rules) {
          const planned = yield* rule.plan(workspace, everyFile, { config: ruleSet.effective, nodeTypes })
          // Chunked like the engine: one rule's candidates can exceed the
          // provider's token ceiling, so they travel in as many requests as fit.
          //
          // The provider occasionally returns a distribution that does not sum to
          // 1 for one decision, and the whole request is rejected for it. Split
          // and retry, so one bad decision loses its own plan rather than every
          // rule in the chunk. A single plan that still fails reads as undefined,
          // which is an unreadable candidate, not a lost rule.
          const answerChunk = (
            plans: ReadonlyArray<Plan<unknown>>,
            retried = false,
          ): Effect.Effect<
            ReadonlyArray<DecisionAnswers | undefined>,
            never,
            Atoms | PlanAnswers | DecisionModel.DecisionModel
          > =>
            Effect.gen(function* () {
              const attempt = yield* Effect.result(answerPlansRaw(plans))
              if (Result.isSuccess(attempt)) return attempt.success
              // A lone request the provider answered with a distribution that
              // does not sum to 1: ask once more before giving the candidate up.
              // The provider is nondeterministic, so this is an instrument fault
              // rather than an answer.
              if (plans.length <= 1) return retried ? [undefined] : yield* answerChunk(plans, true)
              const middle = Math.ceil(plans.length / 2)
              const left = yield* answerChunk(plans.slice(0, middle))
              const right = yield* answerChunk(plans.slice(middle))
              return [...left, ...right]
            })
          const answers: Array<DecisionAnswers | undefined> = []
          for (const chunk of yield* chunkPlans(planned.plans, policy.decision.maxStateChars)) {
            answers.push(...(yield* answerChunk(chunk.plans)))
          }
          const unreadable = answers.filter((answer) => answer === undefined).length
          const rejected = unreadable > 0 ? String(unreadable) + " candidate(s) the provider rejected" : ""
          // One row per DECISION that declares its violating labels, so a rule
          // that composes several questions is calibrated question by question
          // rather than named and skipped.
          const byDecision = new Map<string, Array<CalibrationState>>()
          planned.plans.forEach((plan, index) => {
            for (const [decision, labels] of Object.entries(plan.violations ?? {})) {
              const verdict = verdictOf(answers[index]?.[decision], labels)
              if (verdict === undefined) continue
              const quality = qualityOf({
                score: verdict.probability,
                margin: verdict.margin,
                confidence: verdict.confidence,
              })
              const states = byDecision.get(decision) ?? []
              states.push({ probability: verdict.probability, acted: quality.quality === "act" })
              byDecision.set(decision, states)
            }
          })
          const sample = planned.plans.slice(0, 3).map((plan) => plan.subject)
          const note = rejected !== "" ? "provider rejected the answers: " + rejected : ""
          if (byDecision.size === 0) {
            out.push({
              rule: rule.id,
              decision: "-",
              summary: summarizeCalibration([]),
              sample,
              note: note === "" ? "no violating decision declared" : note,
            })
            continue
          }
          for (const [decision, states] of byDecision) {
            out.push({ rule: rule.id, decision, summary: summarizeCalibration(states), sample, note })
          }
        }
        return out
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            atomsLayer,
            decisionLayer({ cacheDir, wireCacheDir: yield* runCacheDirFor(cwd), offline: false, apiKey }),
            // The trace and the node types both run tsgo; the calibrate command
            // provides it only because `--types` may have asked for them.
            tsgoLayer(cwd),
          ),
        ),
      )

      if (config.format === "json") {
        yield* write(JSON.stringify(rows, null, 2))
        return
      }
      const width = rows.reduce((max, row) => Math.max(max, (row.rule + "#" + row.decision).length), 0)
      const lines = [
        "rule#decision".padEnd(width) + "  states  verdict   median   min   max  fired",
        ...rows.map(
          (row) =>
            (row.rule + "#" + row.decision).padEnd(width) +
            "  " + String(row.summary.states).padStart(6) +
            "  " + row.summary.verdict.padEnd(8) +
            "  " + row.summary.median.toFixed(2).padStart(6) +
            "  " + row.summary.min.toFixed(2).padStart(5) +
            "  " + row.summary.max.toFixed(2).padStart(5) +
            "  " + String(row.summary.fired).padStart(5) +
            (row.note === "" ? "" : "  (" + row.note + ")"),
        ),
      ]
      yield* write(lines.join("\n"))
    }),
).pipe(
  Command.withDescription(
    "Replay each question over the candidates this project produces, and label it decisive, weak, noisy or skipped.",
  ),
  Command.withShortDescription("Calibrate the questions."),
  Command.withExamples([
    { command: "joggle calibrate", description: "Calibrate every judged question." },
    { command: "joggle calibrate --rule joggle/object-shape", description: "Calibrate one question." },
  ]),
)

/**
 * The merge driver git invokes for one answer shard, registered in
 * `.joggle/.gitattributes` and in the user's git config.
 *
 * A shard is line-oriented and keyed, so a union by key is the whole merge. It
 * declines (non-zero, no write) when a side is not a shard at all, so git
 * records an ordinary conflict rather than a union that dropped lines.
 */
const mergeAnswers = Command.make(
  "merge-answers",
  {
    base: Argument.String("base").pipe(Argument.withDescription("The merge base shard (git %O). Not consulted: every line is either present or not.")),
    ours: Argument.String("ours").pipe(
      Argument.withDescription("Our shard, and where the result is written (git %A)."),
    ),
    theirs: Argument.String("theirs").pipe(Argument.withDescription("Their shard (git %B).")),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const read = (file: string): Effect.Effect<string> => fs.readFileString(file).pipe(Effect.orElseSucceed(() => ""))
      const merged = yield* Effect.result(
        mergeShardText({ ours: yield* read(config.ours), theirs: yield* read(config.theirs) }),
      )
      if (Result.isFailure(merged)) {
        yield* write(
          "joggle: merge-answers: the " + merged.failure.side + " side is not an answer shard; resolve this conflict by hand",
        )
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }
      yield* fs.writeFileString(config.ours, merged.success).pipe(Effect.orElseSucceed(() => undefined))
    }),
).pipe(
  Command.withDescription(
    "Merge one answer shard by key. A git merge driver, not a command to run by hand; see docs/artifacts.md.",
  ),
  Command.withShortDescription("Merge one answer shard (git driver)."),
)

const cachePrune = Command.make(
  "prune",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root whose cache to prune (default: the current directory)."),
      Flag.optional,
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription("Where the answer cache lives: <cwd>/.joggle when it exists, otherwise the machine cache."),
      Flag.optional,
    ),
    maxAge: Flag.Int("max-age").pipe(
      Flag.withDescription("Drop entries written more than this many days ago."),
      Flag.optional,
    ),
    maxBytes: Flag.Int("max-bytes").pipe(
      Flag.withDescription("After the age cut, drop oldest-first until the store is at or under this many bytes."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const dir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const days = Option.getOrUndefined(config.maxAge)
      const result = yield* pruneAnswers(fs, path, dir, {
        olderThanSeconds: days === undefined ? undefined : days * 24 * 60 * 60,
        maxBytes: Option.getOrUndefined(config.maxBytes),
      })
      const noun = result.removed === 1 ? "entry" : "entries"
      yield* write(
        "joggle: pruned " + result.removed + " " + noun + "; " + result.kept + " kept, " + result.bytes + " bytes",
      )
    }),
).pipe(
  Command.withDescription(
    "Drop old answer-cache entries by age and size. The cache is regenerable; pruning it is safe, and a store that only grows is not a cache.",
  ),
  Command.withShortDescription("Prune the answer cache."),
  Command.withExamples([
    { command: "joggle cache prune --max-age 90", description: "Drop answers older than 90 days." },
    {
      command: "joggle cache prune --max-bytes 4000000",
      description: "Cap the committed cache, oldest answers first.",
    },
  ]),
)

const cacheMigrate = Command.make(
  "migrate",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root whose cache to migrate (default: the current directory)."),
      Flag.optional,
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription("Where the answer cache lives: <cwd>/.joggle when it exists, otherwise the machine cache."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const dir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const store = yield* makeAnswerStore(fs, path, dir)
      const written = yield* store.migrate
      yield* write("joggle: wrote " + written + " answer(s) to " + path.join(dir, "answers"))
    }),
).pipe(
  Command.withDescription(
    "Rewrite the cache in the sharded shape, and remove a legacy answers.json. Idempotent.",
  ),
  Command.withShortDescription("Migrate the cache to shards."),
)

const cacheCommand = Command.make("cache", {}, () =>
  write("joggle cache: run `joggle cache prune`, or read docs/artifacts.md for the layout."),
).pipe(
  Command.withDescription("Work on the answer cache itself: prune it, migrate it, and see how it is laid out."),
  Command.withShortDescription("Prune the answer cache."),
  Command.withSubcommands([cachePrune, cacheMigrate]),
)

const cli = Command.make("joggle").pipe(
  Command.withDescription(
    "Cross-file patterns and idioms for TypeScript, enforced like a linter: deterministic where it can prove, System One where it has to judge.",
  ),
  Command.withExamples([
    {
      command: "joggle check --pr",
      description: "Check only what this branch's pull request changed.",
    },
    { command: "joggle check --since origin/main", description: "Check only what this branch changed." },
    { command: "joggle rules", description: "See what is enforced here." },
  ]),
  Command.withSubcommands([checkCommand, askCommand, rules, calibrateCommand, cacheCommand, mergeAnswers]),
)

const services = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, builtIn)

const program = Command.run(cli, { version: policy.version }).pipe(Effect.provide(services))

/*
 * Never fail silently. A typed failure, an interruption and a defect all have
 * to reach stderr with enough detail to act on. This is a CI gate, and a gate
 * that exits non-zero without saying why is worse than no gate at all.
 */
/**
 * A typed failure deserves a sentence, not a stack.
 *
 * `Cause.pretty` prints the operation, the cause and the whole trace, which is
 * right for a defect and wrong for "you did not pass a path": the one line that
 * matters ends up buried under the machinery that produced it.
 */
const describeFailure = (cause: unknown): string | undefined => {
  if (!isRecord(cause)) return undefined
  const record = cause
  const tag = record["_tag"]
  if (tag === "joggle/WorkspaceError") {
    const original = record["cause"]
    const detail =
      original instanceof Error ? original.message : Predicate.isString(original) ? original : ""
    return String(record["operation"]) + ": " + detail
  }
  // Git and tsgo already carry the one sentence that matters: the command and
  // what it said. A stack trace here buries it.
  if (tag === "joggle/GitError" || tag === "joggle/TsgoError") {
    return String(record["operation"]) + ": " + (Predicate.isString(record["detail"]) ? record["detail"] : "")
  }
  // Any other typed failure -- AiError, ConfigError -- has a message, and that
  // sentence is what a person needs. The stack is for a defect.
  if (Predicate.isString(record["message"]) && record["message"] !== "") {
    return record["message"]
  }
  return undefined
}

/**
 * One sentence for a typed failure, and the runtime owns the rest.
 *
 * `NodeRuntime.runMain` sets the exit code, handles Ctrl+C, and runs finalizers.
 * The teardown only has to say WHY, and to keep a success's own exit code -- the
 * lint gate writes one into `process.exitCode`.
 */
const teardown: Runtime.Teardown = (exit, onExit) => {
  if (Exit.isSuccess(exit)) {
    onExit(Predicate.isNumber(process.exitCode) ? process.exitCode : 0)
    return
  }
  const failure = Cause.findErrorOption(exit.cause)
  const described = Option.isSome(failure) ? describeFailure(failure.value) : undefined
  process.stderr.write(described === undefined ? `${Cause.pretty(exit.cause)}\n` : `${described}\n`)
  onExit(1)
}

NodeRuntime.runMain(program, { disableErrorReporting: true, teardown })
