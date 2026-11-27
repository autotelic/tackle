import { Cause, Config, Effect, Exit, FileSystem, Layer, Option, Path, Predicate, Result, Runtime, Schema, SchemaIssue, SchemaParser } from "effect"
import { Argument, Command, Flag } from "effect/cli"
import { Decision, DecisionModel } from "effect/ai"
import * as FetchHttpClient from "effect/http/FetchHttpClient"
import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { checkRepository } from "./check.ts"
import { DecisionStats, layer as decisionLayer } from "./decision.ts"
import {
  census as censusAnswers,
  compact as compactAnswers,
  make as makeAnswerStore,
  mergeShardText,
  prune as pruneAnswers,
} from "./answer-store.ts"
import { ask } from "./ask.ts"
import {
  clusterRemedies,
  describeInput,
  FindingsPayload,
  findingsOf,
  judgeRemedies,
  rememberRemedyFindings,
  type RemedyReport,
} from "./remedies.ts"
import { cacheDirFor, runCacheDirFor, scopedAnswerCacheDir, shortHash } from "./state.ts"
import { canonical } from "./canonical.ts"
import { loadConfig, isEnabled, severityFor } from "./config.ts"
import { layer as gitLayer, Service as Git } from "./git.ts"
import { loadPlugins, withDefaults } from "./plugins.ts"
import { policy } from "./policy.ts"
import { VERSION } from "./version.ts"
import { WorkspaceError } from "./schema.ts"
import { exitCodeFor, render } from "./report.ts"
import { applyDeclarationTypes, isRecord, loadWorkspace } from "./workspace.ts"
import { answerPlansRaw, answerKeyFor, chunkPlans, type Plan, type PlanAnswers } from "./plans.ts"
import { Atoms, layer as atomsLayer } from "./atoms.ts"
import {
  fragmentSetHash,
  splitReport,
  summarizeCalibration,
  type CalibrationState,
  type CalibrationSummary,
  type Observation,
  type SplitReport,
} from "./calibration.ts"
import { verdictOf } from "./verdict.ts"
import { everyFile, qualityOf, type DecisionAnswers, type PlannedRule, type Rule } from "./rule.ts"
import { allRules, builtIn, Rules } from "./rules/index.ts"
import { layerFromConfig as tsgoLayer } from "./tsgo.ts"
import { emptyTypeIndex, loadTypeFacts, type TypeFactRequest, type TypeIndex } from "./typetrace.ts"
import {
  indexOfNodeTypes,
  loadDeclarationTypes,
  typesAtPositions,
  type NodeTypeIndex,
  type NodeTypeQuery,
} from "./typefacts.ts"
import { manifestOf } from "./run-cache.ts"
import { identityKeysOf, identityOf } from "./identity.ts"
import { sourceFingerprint } from "./fingerprint.ts"
import { buildSurface, projectRootOf, SURFACE_PATH, surfaceFileOf, surfaceOutputOf } from "./surface.ts"
import { decodeSurface, parseJson } from "@autotelic/protocol"

/**
 * One report, written and then WAITED for.
 *
 * It used to be `Console.log`, which queues the write and returns. To a pipe --
 * how a caller, CI and `jig` all read this -- stdout is asynchronous, so the
 * bytes leave only once the reader has taken them; this process's own teardown
 * then ends it with `process.exit`, which discards whatever is still queued. A
 * report past the pipe's 64 KiB buffer was therefore cut off mid-sentence, and
 * a JSON report cut off mid-sentence is not a clean run: the reader gets an
 * unparseable engine and loses everything the run found. Measured against this
 * repository, whose report is past the buffer: piped, `check --format json`
 * delivered 65536 bytes and failed to parse; with the callback, all 97020
 * arrive. The newline is explicit so the output stays byte-identical.
 */
const write = (text: string): Effect.Effect<void> =>
  Effect.callback<void>((resume) => {
    process.stdout.write(text.endsWith("\n") ? text : `${text}\n`, () => resume(Effect.void))
  })

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
    const effective = withDefaults({ defaults: loaded.config, own: settings })
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
      Flag.withDescription(
        "Input-token budget for judgement in this run (overrides decision.maxInputTokens).",
      ),
      Flag.optional,
    ),
    offline: Flag.Boolean("offline").pipe(
      Flag.withDescription("Answer only from the committed judgement cache; never call the model."),
      Flag.withDefault(false),
    ),
    noTsgo: Flag.Boolean("no-tsgo").pipe(
      Flag.withDescription("Never invoke tsgo; walk the paths on disk instead."),
      Flag.withDefault(false),
    ),
    runExternalCode: Flag.Boolean("run-external-code").pipe(
      Flag.withDescription(
        "Allow tsc to execute content-mapper packages declared in tsconfig (TypeScript 7.1+). Off by default: a mapper is arbitrary code.",
      ),
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
    prose: Flag.String("prose").pipe(
      Flag.withDescription(
        "Read these files as prose whatever their extension: a commit message, a pull request body. Comma-separated.",
      ),
      Flag.optional,
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
    mergeBaseline: Flag.Boolean("merge-baseline").pipe(
      Flag.withDescription(
        "With --update-baseline, keep the identities already in that file and add this run's. A scoped run (--since) judges all of its own files, so this grows a ledger by one change instead of replacing it.",
      ),
      Flag.withDefault(false),
    ),
    listFiles: Flag.Boolean("list-files").pipe(
      Flag.withDescription(
        "Include the analysed file paths in the report's discovery block (--format json). The only honest way to answer why two checkouts of one commit report different findings is to diff their file lists.",
      ),
      Flag.withDefault(false),
    ),
    readOnly: Flag.Boolean("read-only").pipe(
      Flag.withDescription(
        "Answer from the cache and never write it. Set for every engine jig runs: a check must not edit the tree it judges, because new answers rename the findings they verify.",
      ),
      Flag.withDefault(false),
    ),
    allowScopedBaseline: Flag.Boolean("allow-scoped-baseline").pipe(
      Flag.withDescription(
        "Write a ledger from a scoped run. Refused by default: a scoped run's identities are not a subset of a full run's, so the ledger can miss the identity CI reports. Accept from a full run instead.",
      ),
      Flag.withDefault(false),
    ),
    allowUnjudgedBaseline: Flag.Boolean("allow-unjudged-baseline").pipe(
      Flag.withDescription(
        "Write the baseline even though some candidates were not judged. A baseline is what was reviewed; this is the explicit way to accept that some of it was not.",
      ),
      Flag.withDefault(false),
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
      const declaredCacheDir = Option.getOrUndefined(config.cacheDir)
      const repositoryCache = yield* cacheDirFor(cwd, declaredCacheDir)
      const apiKey = yield* Config.option(Config.String("TYPESAFE_API_KEY"))
      const ruleFlag = Option.getOrUndefined(config.rule)
      const proseInputs = (value: string | undefined): ReadonlyArray<string> | undefined =>
        value === undefined
          ? undefined
          : value
              .split(",")
              .map((input) => input.trim())
              .filter((input) => input.length > 0)
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
      // per-decision answer cache reads the reviewed ledger and writes judged
      // answers into a cache; `joggle cache migrate` is the explicit way to move
      // the ledger's shape.
      const machineCache = yield* runCacheDirFor(cwd)
      // A branch's answers are a cache, not a commit: a scoped run warms this machine and
      // leaves the committed ledger alone. Otherwise every pull request in a stack carries
      // thousands of lines of verdicts nobody can review (see docs/artifacts.md).
      const scopedRun = config.changed || changedPaths !== undefined
      // Write-through answers live beside the fact store. The reviewed
      // `.joggle/answers` ledger is read, never rewritten by a check: its lines are
      // a reviewed set, and a judged run that appended to it dirtied 181 files.
      const cacheDir = scopedAnswerCacheDir({
        declared: declaredCacheDir,
        repository: repositoryCache,
        machine: machineCache,
        scoped: scopedRun,
      })
      const answerReadDirs = [...new Set([repositoryCache, cacheDir])]
      const machineAnswers = cacheDir !== repositoryCache || repositoryCache === machineCache

      const report = yield* checkRepository({
        config: effective,
        plugins: loaded,
        cwd,
        paths: config.paths,
        rules,
        typecheck: config.typecheck,
        prose: proseInputs(Option.getOrUndefined(config.prose)),
        types: config.types ? "trace" : "off",
        maxInputTokens:
          Option.getOrUndefined(config.maxTokens) ?? effective.decision?.maxInputTokens,
        useTsgo: !config.noTsgo,
        runExternalCode: config.runExternalCode || effective.runExternalCode === true,
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
        allowUnjudgedBaseline: config.allowUnjudgedBaseline,
        mergeBaseline: config.mergeBaseline,
        allowScopedBaseline: config.allowScopedBaseline,
        listFiles: config.listFiles,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            rulesLayer,
            decisionLayer({
              cacheDir,
              wireCacheDir: machineCache,
              // Machine-local, pollable, and never part of the committed ledger: it describes
              // THIS run. A long judged run used to print nothing at all until the report.
              progressFile: path.join(machineCache, "progress.json"),
              inputBudget:
                Option.getOrUndefined(config.maxTokens) ?? effective.decision?.maxInputTokens,
              offline: config.offline,
              apiKey,
              layout: effective.cache?.layout,
              answerReadDirs,
              timestamps: machineAnswers,
              readOnly: config.readOnly || process.env["JIG_READ_ONLY"] === "1",
            }),
            tsgoLayer(cwd, {
              runExternalCode: config.runExternalCode || effective.runExternalCode === true,
            }),
          ),
        ),
      )

      // Say where the answers went when the run left the committed ledger alone: a reader
      // who expected the cache to grow would otherwise think judging did nothing.
      const answered = scopedRun && declaredCacheDir === undefined && repositoryCache !== machineCache
      const reported = answered
        ? {
            ...report,
            notes: [
              {
                ruleId: "joggle",
                reason:
                  "answers for this scoped run went to the machine cache, not the committed ledger: a branch's verdicts are a cache, and committing them puts thousands of lines in every pull request",
              },
              ...report.notes,
            ],
          }
        : report
      yield* write(render(reported, config.format, { color: process.stdout.isTTY === true }))
      yield* Effect.sync(() => {
        process.exitCode = exitCodeFor(reported, config.maxWarnings)
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

const proseCommand = Command.make(
  "prose",
  {
    paths: Argument.String("paths").pipe(
      Argument.withDescription(
        "Files read as prose, whatever their extension: a commit message, a pull request body, a Markdown document.",
      ),
      Argument.variadic(),
    ),
    format: Flag.Literals("format", ["text", "stylish", "unix", "json", "github"]).pipe(
      Flag.withDescription("How to render the report."),
      Flag.withDefault("stylish"),
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
      Flag.withDescription(
        "Where the answer cache lives: <cwd>/.joggle when it exists (an onboarded repository), otherwise the machine cache.",
      ),
      Flag.optional,
    ),
    maxTokens: Flag.Int("max-tokens").pipe(
      Flag.withDescription("Input-token budget for judgement in this run."),
      Flag.withDefault(policy.decision.maxInputTokens),
    ),
    offline: Flag.Boolean("offline").pipe(
      Flag.withDescription("Answer only from the committed judgement cache; never call the model."),
      Flag.withDefault(false),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const cacheDir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const apiKey = yield* Config.option(Config.String("TYPESAFE_API_KEY"))
      const ruleSet = yield* ruleSetFor(cwd, Option.getOrUndefined(config.config))
      const machineCache = yield* runCacheDirFor(cwd)
      const report = yield* checkRepository({
        config: ruleSet.effective,
        plugins: ruleSet.loaded,
        cwd,
        paths: [],
        rules: ["joggle/prose-voice"],
        typecheck: false,
        types: "off",
        prose: config.paths.map((file) => path.resolve(cwd, file)),
        proseOnly: true,
        maxInputTokens: config.maxTokens,
        useTsgo: false,
        cacheDirExplicit: Option.isSome(config.cacheDir),
        cacheDir,
        runCacheDir: machineCache,
        replayUnchanged: false,
        changed: false,
        baselinePath: undefined,
        updateBaselinePath: undefined,
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            ruleSet.layer,
            decisionLayer({ cacheDir, wireCacheDir: machineCache, offline: config.offline, apiKey }),
            tsgoLayer(cwd, { runExternalCode: false }),
          ),
        ),
      )
      yield* write(render(report, config.format, { color: process.stdout.isTTY === true }))
      // A gate, not a report: a warning fails the run and an info notice does not.
      yield* Effect.sync(() => {
        process.exitCode = exitCodeFor(report, 0)
      })
    }).pipe(Effect.provide(gitLayer)),
).pipe(
  Command.withDescription(
    "Judge prose that is not source: a commit message, a pull request body, a Markdown document. Runs only joggle/prose-voice, walks no repository, and exits non-zero on a warning, so a commit-msg hook can use it.",
  ),
  Command.withShortDescription("Judge a commit message or a PR body for the agentic register."),
  Command.withExamples([
    { command: "joggle prose .git/COMMIT_EDITMSG", description: "Judge the message being committed." },
    {
      command: "joggle prose pr-body.md --format json",
      description: "Read the findings for a pull request body as JSON.",
    },
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

interface RemedyLinesInput {
  readonly report: RemedyReport
  readonly ledger: { readonly run: string; readonly written: number }
  readonly cache: { readonly replayed: number; readonly judged: number }
}

const remedyLines = ({ report, ledger, cache }: RemedyLinesInput): ReadonlyArray<string> => {
  const total = cache.replayed + cache.judged
  const hit = total === 0 ? 0 : cache.replayed / total
  const input = describeInput(report.clusters.flatMap((cluster) => cluster.members))
  const witnessOnly = report.judgementStatus === "witness-only"
  const partial = report.judgementStatus === "partial"
  const firstFailure = report.judgementFailures[0] ?? "unknown"
  const moreFailures = report.judgementFailures.length - 1
  const counts = witnessOnly
    ? input + " -> " + String(report.witness.clusters) + " witness cluster(s) from " +
      String(report.distinctMessages) + " distinct message(s); NOT judgement clusters"
    : input + " -> " + String(report.clusters.length) + " remedy cluster(s) from " +
      String(report.distinctMessages) + " distinct message(s)"
  const lines = [
    ...(witnessOnly
      ? [
          "WITNESS-ONLY — the judgement path did not run",
          "reason: " + String(report.judgementUnavailable),
        ]
      : partial
        ? [
            "PARTIAL — the judgement answered " + String(report.answeredPairs) + "/" +
              String(report.pairsAsked) + " pair(s) and " + String(report.answeredRepairs) + "/" +
              String(report.distinctMessages) + " message(s)",
            ...(report.judgementFailures.length === 0
              ? []
              : [
                  "reason: " + firstFailure +
                    (moreFailures > 0 ? " (+" + String(moreFailures) + " more request(s))" : ""),
                ]),
          ]
        : []),
    counts,
    "witness alone: " + String(report.witness.clusters) + " cluster(s), largest " +
      String(report.witness.largestSites) + " site(s) / " + String(report.witness.largestRules) +
      " rule(s); judgement: " + String(report.judgement.clusters) + " cluster(s), largest " +
      String(report.judgement.largestSites) + " site(s) / " +
      String(report.judgement.largestRules) + " rule(s)",
    "questions: " + String(report.distinctMessages) + " message(s), " +
      String(report.pairsAsked) + " pair(s); answered " + String(report.answeredPairs) + "/" +
      String(report.pairsAsked) + " pair(s); cache " +
      String(cache.replayed) + "/" + String(total) + " replayed (" +
      (hit * 100).toFixed(1) + "%)",
    ...(report.rejectedClauses.length === 0
      ? []
      : [
          "non-imperative clauses: " + String(report.rejectedClauses.length) +
            " message(s) not offered as repairs",
          ...report.rejectedClauses.map(
            (rejected) => "  rejected  " + JSON.stringify(rejected.clause) +
              "  <- " + rejected.message,
          ),
        ]),
    "fact store: run " + ledger.run + ", " + String(ledger.written) + " finding row(s)",
  ]
  for (const cluster of report.clusters) {
    lines.push("")
    lines.push(
      String(cluster.sites) + " site(s) · " + String(cluster.findings) + " finding(s) · " +
        String(cluster.rules.length) + " rule(s) · " + String(cluster.files.length) + " file(s)",
    )
    lines.push("  remedy  " + cluster.remedy + "  [" + cluster.remedyHash + "]")
    lines.push(
      "  rules   " +
        cluster.rules.map((rule) => rule.rule + " " + String(rule.findings)).join(", "),
    )
    const sites = [...new Set(cluster.members.map((member) => member.site))].sort((left, right) =>
      left.localeCompare(right),
    )
    const shown = sites.length <= 6
      ? sites.join(", ")
      : sites.slice(0, 6).join(", ") + ", +" + String(sites.length - 6)
    lines.push("  sites   " + shown)
    lines.push(
      "  files   " + cluster.files.map((file) => file.file + " " + String(file.sites)).join(", "),
    )
    if (cluster.counterexamples.length > 0) lines.push("  counterexamples")
    for (const counterexample of cluster.counterexamples) {
      const onlyA = counterexample.onlyA.length <= 5
        ? counterexample.onlyA.join(", ")
        : counterexample.onlyA.slice(0, 5).join(", ") +
          ", +" +
          String(counterexample.onlyA.length - 5)
      const onlyB = counterexample.onlyB.length <= 5
        ? counterexample.onlyB.join(", ")
        : counterexample.onlyB.slice(0, 5).join(", ") +
          ", +" +
          String(counterexample.onlyB.length - 5)
      lines.push(
        "    " + counterexample.a + " × " + counterexample.b + ": only " + counterexample.a +
          " " + String(counterexample.onlyA.length) + " [" + onlyA + "] · only " +
          counterexample.b + " " + String(counterexample.onlyB.length) + " [" + onlyB + "]",
      )
      lines.push("      " + counterexample.reason)
    }
  }
  for (const disagreement of report.disagreements) {
    lines.push(
      "disagreement: witness kept these apart, judgement joined them at " +
        disagreement.probability.toFixed(2) + ": " + disagreement.a + " / " + disagreement.b,
    )
  }
  return lines
}

const remediesCommand = Command.make(
  "remedies",
  {
    file: Argument.String("file").pipe(
      Argument.withDescription(
        "A findings JSON file: joggle's `check --format json` or oxlint's `--format json`.",
      ),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription(
        "Project root whose fact store receives the finding rows (default: the current directory).",
      ),
      Flag.optional,
    ),
    cacheDir: Flag.String("cache-dir").pipe(
      Flag.withDescription(
        "Where the judgement cache lives: <cwd>/.joggle when it exists, otherwise the machine" +
          " cache.",
      ),
      Flag.optional,
    ),
    format: Flag.Literals("format", ["text", "json"]).pipe(
      Flag.withDescription("How to render the clusters."),
      Flag.withDefault("text"),
    ),
    offline: Flag.Boolean("offline").pipe(
      Flag.withDescription("Answer only from the committed judgement cache; never call the model."),
      Flag.withDefault(false),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const path = yield* Path.Path
      const fs = yield* FileSystem.FileSystem
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const input = path.resolve(cwd, config.file)
      const text = yield* fs.readFileString(input)
      const decoded = SchemaParser.decodeResult(Schema.fromJsonString(FindingsPayload))(text)
      if (Result.isFailure(decoded)) {
        return yield* WorkspaceError.make({
          path: input,
          operation: "read remedies input",
          cause: SchemaIssue.makeFormatterDefault()(decoded.failure),
        })
      }
      const findings = findingsOf(decoded.success).map((finding) => {
        const file = path.isAbsolute(finding.file) ? path.relative(cwd, finding.file) : finding.file
        return { ...finding, file, site: file + ":" + String(finding.line) }
      })
      const cacheDir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const machineCache = yield* runCacheDirFor(cwd)
      const apiKey = yield* Config.option(Config.String("TYPESAFE_API_KEY"))
      const judged = yield* Effect.gen(function* () {
        const opinion = yield* judgeRemedies(findings)
        // Read the run's own accounting before the layer is torn down. A fresh
        // layer would answer zero, which is the one number a cache report must
        // never invent.
        const stats = yield* (yield* DecisionStats).read
        return { opinion, stats }
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            atomsLayer,
            decisionLayer({
              cacheDir,
              wireCacheDir: machineCache,
              offline: config.offline,
              apiKey,
            }),
          ),
        ),
      )
      const opinion = judged.opinion
      const stats = judged.stats
      const report = clusterRemedies(findings, opinion)
      const ledger = rememberRemedyFindings(cwd, report)
      if (config.format === "json") {
        yield* write(
          JSON.stringify(
            {
              ...report,
              persistence: ledger,
              cache: { replayed: stats.replayed, judged: stats.judged },
            },
            null,
            2,
          ),
        )
        return
      }
      yield* write(remedyLines({ report, ledger, cache: stats }).join("\n"))
    }),
).pipe(
  Command.withDescription(
    "Cluster findings by the repair their messages prescribe. Reads joggle's or oxlint's JSON" +
      " unchanged, judges each distinct message against the candidate clauses code derived, and" +
      " writes finding(site, rule, remedy_hash, run) to the fact store.",
  ),
  Command.withShortDescription("Cluster findings by the repair they prescribe."),
  Command.withExamples([
    {
      command: "joggle remedies findings.json",
      description: "Cluster one findings stream by prescribed repair.",
    },
    {
      command: "oxlint --format json packages/board > findings.json && joggle remedies findings.json",
      description: "Cluster oxlint's output without requiring it to change shape.",
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

const identityCommand = Command.make(
  "identity",
  {
    paths: Argument.String("paths").pipe(
      Argument.withDescription("Files or directories whose declarations to identify. Default: the whole project."),
      Argument.variadic(),
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
      const workspace = yield* loadWorkspace(cwd, config.paths.length > 0 ? config.paths : ["."])
      const index = identityOf(workspace)
      const declarations = [...index.declarations].sort(
        (left, right) =>
          left.unit.file.localeCompare(right.unit.file) ||
          left.unit.location.line - right.unit.location.line ||
          left.unit.name.localeCompare(right.unit.name),
      )
      yield* write(
        [
          ...declarations.map(
            ({ unit, id }) => `${id}  ${unit.file}:${unit.location.line}  ${unit.name}`,
          ),
          `${declarations.length} declaration(s); ${index.unresolved} unresolved reference(s)`,
        ].join("\n"),
      )
    }),
).pipe(
  Command.withDescription("Print the content-addressed id of each declaration, and what could not be resolved."),
  Command.withShortDescription("Identify declarations by structure, not by name or path."),
  Command.withExamples([
    {
      command: "joggle identity packages/jig-cli/src/version.ts",
      description: "The id of every declaration in one file.",
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
    runExternalCode: Flag.Boolean("run-external-code").pipe(
      Flag.withDescription(
        "Allow tsc to execute content-mapper packages declared in tsconfig (TypeScript 7.1+). Off by default.",
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
      // A plain rule answers its own questions, so it never reaches the plan
      // engine. The layer's observer records what it asked, and the rule declares
      // which labels violate, so the staged cascade is measurable too.
      const plainRules = ruleSet.rules.filter(
        (rule): rule is Rule =>
          !("plan" in rule) &&
          rule.judged &&
          isEnabled(ruleSet.effective, rule.id, rule.severity) &&
          (wanted === undefined || wanted.includes(rule.id)),
      )
      const recorded: Array<{
        readonly answers: Readonly<Record<string, Decision.Answer<Decision.Any>>>
      }> = []
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
          // The same manifest rule `checkRepository` follows: the config is part
          // of the key, so a config edit retires a cached trace instead of
          // borrowing one it did not earn. The trace itself depends only on the
          // code and the tool, so this over-invalidates -- the safe direction.
          const manifest = manifestOf({
            root: cwd,
            files: [],
            contents: new Map(),
            ruleIds: rules.map((rule) => rule.id),
            tool,
            settings: shortHash(canonical({ config: ruleSet.effective, types: config.types })),
          })
          // The machine cache, like the declaration facts: a trace is a function
          // of the whole program, so it is a performance artifact and not a
          // decision a repository should carry in its diff.
          const loaded = yield* loadTypeFacts({
            root: cwd,
            cacheDir: yield* runCacheDirFor(cwd),
            tool,
            manifest,
          } satisfies TypeFactRequest)
          types = loaded.index
        }
        const workspace = yield* loadWorkspace(cwd, inputs, { types })
        // The checker's per-declaration facts, always: a calibration that could
        // not see the members a rule reads would measure the old rule, not this
        // one. Cheap after the first run -- the manifest keys the cache.
        {
          const tool = yield* sourceFingerprint(policy.analysisVersion)
          const factsManifest = manifestOf({
            root: cwd,
            files: [],
            contents: new Map(),
            ruleIds: rules.map((rule) => rule.id),
            tool,
            settings: shortHash(canonical({ config: ruleSet.effective, types: "declarations" })),
          })
          const declarations = yield* loadDeclarationTypes({
            root: cwd,
            tsconfig: policy.typeFacts.tsconfig,
            // The machine cache, not the committed one: the facts are a function of
            // the whole program, so they are a performance artifact and never a
            // decision a repository should carry in its diff.
            cacheDir: yield* runCacheDirFor(cwd),
            tool,
            manifest: factsManifest,
            maxMembers: policy.typeFacts.maxMembers,
            maxStrings: policy.typeFacts.maxStrings,
            identity: identityKeysOf({ workspace, root: cwd }),
            requests: workspace.units.map((unit) => ({ file: unit.file, position: unit.namePosition })),
          })
          applyDeclarationTypes(workspace, declarations.index)
        }
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
        const out: Array<{
          readonly rule: string
          readonly decision: string
          readonly summary: CalibrationSummary
          readonly note: string
          readonly sample: ReadonlyArray<string>
          readonly split: SplitReport
        }> = []
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
          for (const chunk of yield* chunkPlans(planned.plans, policy.decision.maxRequestChars)) {
            answers.push(...(yield* answerChunk(chunk.plans)))
          }
          const unreadable = answers.filter((answer) => answer === undefined).length
          const rejected = unreadable > 0 ? String(unreadable) + " candidate(s) the provider rejected" : ""
          // The state each plan asked against, as values rather than atom ids.
          // Two plans that read the same body in two files read different atoms
          // (the file is part of the atom) but the same state, and rung 0 exists
          // because that pair must land on one side of the split. The per-atom
          // id would keep them apart; the state is what the question saw.
          const atomStore = yield* Atoms
          const evidence = yield* Effect.forEach(planned.plans, (plan) =>
            Effect.map(atomStore.values(plan.atoms), (values) =>
              Object.values(values).map(canonical).sort((left, right) => left.localeCompare(right)),
            ),
          )
          // One row per DECISION that declares its violating labels, so a rule
          // that composes several questions is calibrated question by question
          // rather than named and skipped.
          const byDecision = new Map<string, Array<CalibrationState>>()
          // Rung 0: the same observation, seen by the split. The key is the
          // per-question cache key (`answerKeyFor`, the same model + state +
          // questions `cacheKeyFor` hashes for the wire), and the fragment set is
          // the atoms the plan read. Two plans that read the same body in two
          // files share the fragments; they are one observation, not two votes.
          const observationsByDecision = new Map<string, Array<Observation>>()
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
              const question = plan.decisions[decision]
              if (question !== undefined) {
                const observations = observationsByDecision.get(decision) ?? []
                observations.push({
                  key: answerKeyFor(question, evidence[index]),
                  atom: plan.subject,
                  fragments: fragmentSetHash(plan.atoms),
                  label: verdict.label ?? (verdict.probability >= 0.5 ? "yes" : "no"),
                })
                observationsByDecision.set(decision, observations)
              }
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
              split: splitReport([]),
            })
            continue
          }
          for (const [decision, states] of byDecision) {
            out.push({
              rule: rule.id,
              decision,
              summary: summarizeCalibration(states),
              sample,
              note,
              split: splitReport(observationsByDecision.get(decision) ?? []),
            })
          }
        }
        for (const rule of plainRules) {
          recorded.length = 0
          const ran = yield* Effect.result(
            rule.run(workspace, everyFile, { config: ruleSet.effective, nodeTypes }),
          )
          if (Result.isFailure(ran)) {
            out.push({
              rule: rule.id,
              decision: "-",
              summary: summarizeCalibration([]),
              sample: [],
              note: "the rule could not run: " + String(ran.failure),
              split: splitReport([]),
            })
            continue
          }
          const byDecision = new Map<string, Array<CalibrationState>>()
          for (const event of recorded) {
            for (const [decision, labels] of Object.entries(rule.violations ?? {})) {
              const verdict = verdictOf(event.answers[decision], labels)
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
          }
          if (byDecision.size === 0) {
            out.push({
              rule: rule.id,
              decision: "-",
              summary: summarizeCalibration([]),
              sample: [],
              note: "no violating decision was declared or asked",
              // A plain rule answers its own questions, so the split has no
              // subject to partition on: it is measured for planned rules only,
              // and named rather than guessed at.
              split: splitReport([]),
            })
            continue
          }
          for (const [decision, states] of byDecision) {
            out.push({
              rule: rule.id,
              decision,
              summary: summarizeCalibration(states),
              sample: [],
              note: "",
              split: splitReport([]),
            })
          }
        }
        return out
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            atomsLayer,
            decisionLayer({
              cacheDir,
              wireCacheDir: yield* runCacheDirFor(cwd),
              offline: false,
              apiKey,
              layout: ruleSet.effective.cache?.layout,
              onAnswer: (event) => recorded.push({ answers: event.answers }),
            }),
            // The trace and the node types both run tsgo; the calibrate command
            // provides it only because `--types` may have asked for them.
            tsgoLayer(cwd, {
              runExternalCode: config.runExternalCode || ruleSet.effective.runExternalCode === true,
            }),
          ),
        ),
      )

      if (config.format === "json") {
        yield* write(JSON.stringify(rows, null, 2))
        return
      }
      const width = rows.reduce((max, row) => Math.max(max, (row.rule + "#" + row.decision).length), 0)
      const lines = [
        "rule#decision".padEnd(width) +
          "  states  verdict   median   min   max  fired   atom  deduped  withheld",
        ...rows.map(
          (row) =>
            (row.rule + "#" + row.decision).padEnd(width) +
            "  " + String(row.summary.states).padStart(6) +
            "  " + row.summary.verdict.padEnd(8) +
            "  " + row.summary.median.toFixed(2).padStart(6) +
            "  " + row.summary.min.toFixed(2).padStart(5) +
            "  " + row.summary.max.toFixed(2).padStart(5) +
            "  " + String(row.summary.fired).padStart(5) +
            // Both numbers side by side: the atom-keyed agreement that the
            // leakiest split reports, and the deduped one that survives rung 0.
            "  " + row.split.byAtom.rate.toFixed(2).padStart(5) +
            "  " + row.split.byKey.rate.toFixed(2).padStart(7) +
            "  " + String(row.split.withheld).padStart(8) +
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

const cacheReport = Command.make(
  "report",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root whose cache to report (default: the current directory)."),
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
      const found = yield* censusAnswers(fs, path, dir)
      const date = (seconds: number | undefined): string =>
        seconds === undefined ? "never" : new Date(seconds * 1000).toISOString().slice(0, 10)
      const kinds = found.kinds.map((entry) => entry.kind + " " + String(entry.count)).join(", ")
      const labels = found.labels
        .slice(0, 8)
        .map((entry) => entry.label + " " + String(entry.count))
        .join(", ")
      yield* write(
        [
          "joggle: " +
            found.entries +
            " entries in " +
            found.files +
            " file(s) (" +
            found.layout +
            "), " +
            found.bytes +
            " bytes",
          "  kinds     " + (kinds === "" ? "none" : kinds),
          "  verdicts  Probability " + found.verdicts.yes + " yes / " + found.verdicts.no + " no",
          "  labels    " + (labels === "" ? "none" : labels),
          "  written   " + date(found.oldest) + " .. " + date(found.newest),
          ...(found.lines > found.entries
            ? [
                "  duplicates " +
                  (found.lines - found.entries) +
                  " line(s) over " +
                  found.entries +
                  " answer(s); `joggle cache compact` rewrites the set",
              ]
            : []),
          ...(found.skippedLines === 0 ? [] : ["  skipped   " + found.skippedLines + " unreadable line(s)"]),
        ].join("\n"),
      )
    }),
).pipe(
  Command.withDescription(
    "Render the committed answer ledger for a reader: entry and file counts, layout, verdict distribution, labels, and the date range. A summary cannot be replayed; this is what to read when reviewing the diff.",
  ),
  Command.withShortDescription("Report on the answer cache."),
  Command.withExamples([
    { command: "joggle cache report", description: "Count what the committed ledger holds." },
  ]),
)

const cacheCompact = Command.make(
  "compact",
  {
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root whose cache to compact (default: the current directory)."),
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
      const result = yield* compactAnswers(fs, path, dir)
      if (result.duplicates === 0) {
        yield* write(
          "joggle: the ledger is already a set: " + result.entries + " answer(s), " + result.bytesAfter + " bytes",
        )
        return
      }
      yield* write(
        "joggle: " +
          result.lines +
          " line(s) held " +
          result.entries +
          " answer(s); compacted " +
          result.duplicates +
          " duplicate(s) away, " +
          result.bytesBefore +
          " -> " +
          result.bytesAfter +
          " bytes",
      )
    }),
).pipe(
  Command.withDescription(
    "Rewrite the answer ledger as the set it is: one sorted line per key, newest answer winning. Repairs the duplication a union merge leaves behind (a differing line is kept from both sides), without re-judging anything.",
  ),
  Command.withShortDescription("Deduplicate the answer cache."),
  Command.withExamples([
    {
      command: "joggle cache compact",
      description: "Collapse duplicate lines left by a stack's merges.",
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
    layout: Flag.Literals("layout", ["single", "sharded"]).pipe(
      Flag.withDescription(
        "How to write the ledger: one sorted answers.jsonl (default), or shards under answers/.",
      ),
      Flag.withDefault("single"),
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const cwd = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const dir = yield* cacheDirFor(cwd, Option.getOrUndefined(config.cacheDir))
      const store = yield* makeAnswerStore(fs, path, dir)
      const written = yield* store.migrate(config.layout)
      const target = config.layout === "single" ? path.join(dir, "answers.jsonl") : path.join(dir, "answers")
      yield* write("joggle: wrote " + written + " answer(s) to " + target)
    }),
).pipe(
  Command.withDescription(
    "Rewrite the cache in one layout and remove the other: a single sorted answers.jsonl by default, or shards with --layout sharded. Idempotent.",
  ),
  Command.withShortDescription("Consolidate or shard the answer cache."),
)

const surfaceBuild = Command.make(
  "build",
  {
    out: Flag.String("out").pipe(
      Flag.withDescription(
        "Where to write the surface (default <workspace root>/.joggle/surface.json).",
      ),
      Flag.optional,
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root to read (default: the nearest repository root)."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const start = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const root = projectRootOf(start)
      const out = surfaceOutputOf({ start, out: Option.getOrUndefined(config.out) })
      const built = yield* buildSurface({ root })
      yield* fs.makeDirectory(path.dirname(out), { recursive: true })
      yield* fs.writeFileString(out, JSON.stringify(built.surface, null, 2) + "\n")
      const exports = built.surface.packages.reduce(
        (total, surfacePackage) => total + surfacePackage.exports.length,
        0,
      )
      const skipped =
        built.skipped.length === 0
          ? ""
          : "; " +
            String(built.skipped.length) +
            " package(s) skipped: " +
            built.skipped.slice(0, 5).map((entry) => entry.name).join(", ") +
            (built.skipped.length > 5 ? " and more" : "")
      yield* write(
        "joggle: wrote " +
          built.surface.packages.length +
          " package(s), " +
          exports +
          " export(s) to " +
          out +
          skipped,
      )
    }),
).pipe(
  Command.withDescription(
    "Read each direct dependency's one type declaration and write the export names to a machine-local surface file.",
  ),
  Command.withShortDescription("Build the dependency surface."),
  Command.withExamples([
    { command: "joggle surface build", description: "Write .joggle/surface.json." },
    {
      command: "joggle surface build --out .joggle/surface.json",
      description: "Write the surface at an explicit path.",
    },
  ]),
)

const surfaceCommand = Command.make(
  "surface",
  {
    check: Flag.Boolean("check").pipe(
      Flag.withDescription(
        "Exit 1 when the surface is missing or its packages/versions no longer match package.json + node_modules.",
      ),
      Flag.withDefault(false),
    ),
    cwd: Flag.String("cwd").pipe(
      Flag.withDescription("Project root to read (default: the current directory)."),
      Flag.optional,
    ),
  },
  (config) =>
    Effect.gen(function* () {
      if (!config.check) {
        yield* write(
          "joggle surface: run `joggle surface build` to write the surface, or `joggle surface --check` to verify it.",
        )
        return
      }
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const start = path.resolve(Option.getOrUndefined(config.cwd) ?? process.cwd())
      const cwd = projectRootOf(start)
      const file = surfaceFileOf({ root: cwd, surfacePath: SURFACE_PATH })
      const exists = yield* Effect.orElseSucceed(fs.exists(file), () => false)
      if (!exists) {
        yield* write("joggle: no surface at " + file + ": run `joggle surface build`")
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }
      const text = yield* Effect.orElseSucceed(fs.readFileString(file), () => "")
      const parsed = parseJson(text)
      if (parsed === undefined) {
        yield* write("joggle: the surface is not readable JSON: run `joggle surface build`")
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }
      const stored = decodeSurface(parsed)
      const current = yield* buildSurface({ root: cwd })
      const namesOf = (surface: typeof stored): ReadonlyArray<string> =>
        surface.packages
          .map((surfacePackage) => surfacePackage.name + "@" + surfacePackage.version)
          .sort((left, right) => left.localeCompare(right))
      const before = namesOf(stored)
      const after = namesOf(current.surface)
      const stale =
        before.length !== after.length ||
        before.some((name, index) => name !== after[index])
      if (stale) {
        yield* write(
          "joggle: the surface is stale: " +
            (before.length === 0 ? "no packages" : before.join(", ")) +
            " -> " +
            (after.length === 0 ? "no packages" : after.join(", ")) +
            ": run `joggle surface build`",
        )
        yield* Effect.sync(() => {
          process.exitCode = 1
        })
        return
      }
      yield* write("joggle: the surface matches " + after.length + " package(s)")
    }),
).pipe(
  Command.withDescription(
    "Build or verify the dependency surface. `surface build` writes it; `surface --check` fails when it is missing or stale.",
  ),
  Command.withShortDescription("Build or verify the dependency surface."),
  Command.withExamples([
    { command: "joggle surface build", description: "Regenerate the machine-local surface." },
    {
      command: "joggle surface --check",
      description: "Fail when the surface no longer matches the installed packages.",
    },
  ]),
  Command.withSubcommands([surfaceBuild]),
)

const cacheCommand = Command.make("cache", {}, () =>
  write(
    "joggle cache: run `joggle cache compact`, `report`, `prune`, or `migrate --layout single|sharded`; docs/artifacts.md has the reasoning.",
  ),
).pipe(
  Command.withDescription("Work on the answer cache itself: compact it, prune it, migrate it, and see how it is laid out."),
  Command.withShortDescription("Work on the answer cache."),
  Command.withSubcommands([cacheCompact, cachePrune, cacheMigrate, cacheReport]),
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
  Command.withSubcommands([
    checkCommand,
    proseCommand,
    askCommand,
    remediesCommand,
    rules,
    identityCommand,
    calibrateCommand,
    cacheCommand,
    surfaceCommand,
    mergeAnswers,
  ]),
)

const services = Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, builtIn)

const program = Command.run(cli, { version: VERSION }).pipe(Effect.provide(services))

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
// The parameter annotations are load-bearing: `Runtime.Teardown` is a two-argument
// call signature from Effect, so a payload object cannot satisfy it. Annotating
// both parameters distinctly is what keeps a transposition from compiling.
const teardown: Runtime.Teardown = <E, A>(
  exit: Exit.Exit<E, A>,
  onExit: (code: number) => void,
): void => {
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
