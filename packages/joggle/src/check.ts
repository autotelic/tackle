import { Clock, Effect, FileSystem, Order, Path, Result } from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import type { DecisionModel } from "effect/unstable/ai"
import { layer as atomsLayer, type Atoms } from "./atoms.ts"
import { isUnreachable, DecisionStats } from "./decision.ts"
import { answerPlans, chunkPlans, type Plan, type PlanAnswers, type PlanChunk } from "./plans.ts"
import { emptyTypeIndex, loadTypeFacts, type TypeFactRequest, type TypeIndex } from "./typetrace.ts"
import { indexOfNodeTypes, typesAtPositions, type NodeTypeIndex, type NodeTypeQuery } from "./typefacts.ts"
import { shortHash } from "./state.ts"
import { sourceFingerprint } from "./fingerprint.ts"
import { loadParses } from "./parsecache.ts"
import {
  baselinePath,
  manifestOf,
  readBaseline,
  readStored,
  writeBaseline,
  writeStored,
} from "./run-cache.ts"
import { policy } from "./policy.ts"
import { Rules } from "./rules/index.ts"
import type { Loaded } from "./plugins.ts"
import { funnelNotes, rankDiagnostics, type Report, type Skipped } from "./report.ts"
import {
  countUnjudged,
  everyFile,
  finding,
  inGraphScope,
  outcome,
  type PlannedRule,
  type Rule,
  type RuleOutcome,
  type Scope,
} from "./rule.ts"
import { appliesAt, isEnabled, isIgnored, severityFor, unavailableFor, type JoggleConfig } from "./config.ts"
import {
  StoredRun,
  WorkspaceError,
  type Drop,
  type Diagnostic,
  type DecisionTotals,
  type Structure,
} from "./schema.ts"
import { Service as Tsgo } from "./tsgo.ts"
import { discoverFiles, loadWorkspace, type Unit } from "./workspace.ts"
import type { ImportGraph } from "./imports.ts"

export interface Options {
  readonly cwd: string
  /** Explicit inputs. Empty means "whatever tsgo says the project is". */
  readonly paths: ReadonlyArray<string>
  /** Rule ids to run. Absent means every rule. */
  readonly rules: ReadonlyArray<string> | undefined
  /** Carry tsgo's own diagnostics in the same report. */
  readonly typecheck: boolean
  /**
   * Resolve every declaration's type through the compiler's trace.
   *
   * Opt-in because it typechecks the whole program, and cached by the run
   * manifest so an unchanged repository pays for it once. With it, the evidence a
   * judged rule sends carries the resolved type, and the type-aware rules run.
   */
  readonly types: "off" | "trace"
  /**
   * Input tokens this run may spend on judgement. Absent means the policy's
   * default. CI sets it low, because a push pays only for evidence never judged
   * before and a runaway should stop rather than spend.
   */
  readonly maxInputTokens?: number | undefined
  /** Use tsgo for project discovery instead of walking directories. */
  readonly useTsgo: boolean
  /**
   * True when the caller chose where judgements are stored. If they did not,
   * joggle refuses to persist evidence for files that live outside the analysis
   * root -- otherwise analysing another repository from here would write that
   * repository's source into this one's committed cache.
   */
  readonly cacheDirExplicit: boolean
  /** Where the committed artifacts live: judgements and the baseline. */
  readonly cacheDir: string
  /**
   * Where the ephemeral run cache lives. Defaults to the committed cache
   * directory, but the caller normally points it at the machine cache so that a
   * run writes nothing into the repository it is analysing.
   */
  readonly runCacheDir?: string | undefined
  /** Rules, severities and exceptions, from joggle.config.json. */
  readonly config: JoggleConfig
  /** Rules loaded from `plugins`, fingerprinted. */
  readonly plugins?: Loaded | undefined
  /** Replay the stored run when nothing the output depends on has changed. */
  readonly replayUnchanged: boolean
  /**
   * Answer "what did this change introduce" instead of "what is wrong with the
   * repository". Candidate generation is restricted to declarations that moved,
   * and the stored run is left alone because a scoped run is not a full run.
   */
  readonly changed: boolean
  /**
   * Files that differ from a git base, as root-relative paths.
   *
   * This is the PR-shaped scope: `--since main` or `--pr 123` computes it from
   * git rather than from the stored run, so the first run in a fresh clone is
   * already scoped. Candidate generation is restricted to these files; the
   * soundness argument is the same one `--changed` rests on, because a new
   * finding always has at least one changed member.
   */
  readonly changedPaths?: ReadonlyArray<string> | undefined
  /**
   * Files the git base saw as pure renames. Content rules ignore them; the graph
   * rules read them, because a move can create a new relationship.
   */
  readonly movedPaths?: ReadonlyArray<string> | undefined
  /**
   * A human name for the git base the scope came from, for the note that says
   * the base produced nothing. Absent for a stored-run scope.
   */
  readonly changedBase?: string | undefined
  /** Report only findings that are not already accepted in this baseline. */
  readonly baselinePath: string | undefined
  /** Write the current findings as the accepted baseline. */
  readonly updateBaselinePath: string | undefined
}

const reasonOf = (error: AiError.AiError): string => error.message

const typecheckFindings = (output: ReadonlyArray<{ readonly file: string; readonly line: number; readonly column: number; readonly severity: "error" | "warning"; readonly code: string; readonly message: string }>): ReadonlyArray<Diagnostic> =>
  output.map((diagnostic) =>
    finding({
      ruleId: "joggle/typecheck",
      severity: diagnostic.severity === "error" ? "error" : "warn",
      message: `${diagnostic.code}: ${diagnostic.message}`,
      location: { file: diagnostic.file, line: diagnostic.line, column: diagnostic.column },
      judged: false,
    }),
  )

/* -------------------------------------------------------------------------- */
/* Run manifest                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Which files moved since the stored run.
 *
 * A content hash cannot see a rename directly, but it can see one indirectly: a
 * path that is new whose bytes match a path that is gone is a move, not a new
 * declaration. Splitting it out is the same distinction the git scope makes, so
 * `--changed` and `--pr` answer a move the same way.
 */
interface SinceStored {
  readonly changed: ReadonlyArray<string>
  readonly renamed: ReadonlyArray<string>
}

const changedSince = (stored: StoredRun, hashOf: ReadonlyMap<string, string>): SinceStored => {
  const before = new Map(stored.sources.map((source) => [source.path, source.hash]))
  const byHash = new Map<string, Array<string>>()
  for (const [path, hash] of before) {
    const list = byHash.get(hash)
    if (list === undefined) byHash.set(hash, [path])
    else list.push(path)
  }
  const changed = new Set<string>()
  const moved = new Set<string>()
  for (const [file, hash] of hashOf) {
    const prior = before.get(file)
    if (prior === hash) continue
    // A new path whose content matches a path that is gone is the same bytes
    // under a new name.
    const twin = (byHash.get(hash) ?? []).some((path) => !hashOf.has(path))
    if (prior === undefined && twin) moved.add(file)
    else changed.add(file)
  }
  for (const file of before.keys()) {
    if (!hashOf.has(file)) changed.add(file)
  }
  return { changed: [...changed], renamed: [...moved] }
}

/** Exported declaration names by root-relative path. */
const exportsOf = (workspace: {
  readonly units: ReadonlyArray<{ readonly file: string; readonly name: string; readonly exported: boolean }>
}): ReadonlyMap<string, ReadonlyArray<string>> => {
  const out = new Map<string, Array<string>>()
  for (const unit of workspace.units) {
    if (!unit.exported) continue
    const names = out.get(unit.file)
    if (names === undefined) out.set(unit.file, [unit.name])
    else names.push(unit.name)
  }
  return out
}

/**
 * A change to a file's EXPORTS can move what a dependent's type names resolve
 * to, so dependents come into scope -- but only then.
 *
 * Closing over importers unconditionally looked harmless and was not: a
 * body-only edit to one widely-imported file pulled 190 files into scope, which
 * is most of the analysis back again for a change that could not have affected
 * any of them.
 */
const affectedBy = (
  changed: ReadonlySet<string>,
  imports: ImportGraph,
  before: ReadonlyMap<string, ReadonlyArray<string>>,
  after: ReadonlyMap<string, ReadonlyArray<string>>,
): ReadonlySet<string> => {
  const out = new Set(changed)
  for (const file of changed) {
    const was = [...(before.get(file) ?? [])].sort(Order.String).join(",")
    const now = [...(after.get(file) ?? [])].sort(Order.String).join(",")
    if (was === now) continue
    for (const edge of imports.importersOf.get(file) ?? []) out.add(edge.importer)
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* The run                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One pass over the workspace: deterministic candidates, then judgement for
 * the rules that ask for it, then a single sorted report.
 */
export const checkRepository = Effect.fn("joggle.check")(function* (options: Options) {
  const started = yield* Clock.currentTimeMillis
  // The rule set comes from the context, where a plugin's rules have already
  // been merged with the built-in ones. A run does not know or care where a rule
  // came from: a plugin rule is selectable, configurable, severable and ignorable
  // like any other, which is the whole point of a registry rather than an array.
  const universe: ReadonlyArray<Rule | PlannedRule> = yield* Rules
  const selected = (
    options.rules === undefined
      ? universe
      : universe.filter((rule) => options.rules?.includes(rule.id) === true)
  ).filter((rule) => isEnabled(options.config, rule.id, rule.severity))

  const decisionStats = yield* DecisionStats
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  const discovered =
    options.paths.length === 0 && options.useTsgo
      ? yield* (yield* Tsgo).listFiles(options.cwd).pipe(Effect.orElseSucceed(() => undefined))
      : undefined

  const discoverStarted = yield* Clock.currentTimeMillis
  const discovery = yield* discoverFiles(options.cwd, options.paths, discovered)
  const files = discovery.files

  // A run that found no source files did not pass. Reporting "0 problems" for an
  // empty file set is the worst output this program can produce, because it looks
  // exactly like success -- and that is how the architecture rules measured
  // nothing at all while appearing clean, when the tool was invoked with no path
  // argument and TypeScript discovery came back empty.
  if (files.length === 0) {
    // Name the source of the emptiness. The old message blamed a missing path
    // argument even when one was given, and even when the real cause was tsgo
    // returning a list that did not survive the root comparison.
    const where =
      discovered !== undefined
        ? "tsgo listed no source files under " + options.cwd
        : options.paths.length === 0
          ? "no source files under " + options.cwd
          : "no source files under " + options.paths.join(", ") + " in " + options.cwd
    return yield* WorkspaceError.make({ path: options.cwd, operation: "discover", cause: new Error(where) })
  }

  // Read once. The manifest needs the content, and a miss hands the same text to
  // the parser rather than reading the tree twice.
  const contents = new Map<string, string>()
  for (const absolute of files) {
    const text = yield* Effect.orElseSucceed(fs.readFileString(absolute), () => undefined)
    if (text !== undefined) contents.set(absolute, text)
  }
  const discoverMs = (yield* Clock.currentTimeMillis) - discoverStarted

  // The tool's own source, which is also the parse cache's version: the parser is
  // part of the tool, so an entry produced by a different parser is not a cache
  // hit, it is a wrong answer.
  const toolFingerprint = [
    yield* sourceFingerprint(policy.analysisVersion),
    ...(options.plugins?.fingerprints ?? []),
  ].join("\u0000")
  const manifest = manifestOf(
    options.cwd,
    files,
    contents,
    selected.map((rule) => rule.id),
    toolFingerprint,
  )
  const hashOf = new Map(
    files.map((file) => [path.relative(options.cwd, file), shortHash(contents.get(file) ?? "")]),
  )

  const finish = (report: Report): Effect.Effect<Report> =>
    Effect.gen(function* () {
      let diagnostics = report.diagnostics
      let note: Skipped | undefined
      if (options.baselinePath !== undefined) {
        const known = yield* readBaseline(fs, path, baselinePath(path, options.baselinePath))
        if (known !== undefined) {
          const before = diagnostics.length
          diagnostics = diagnostics.filter(
            (entry) => entry.identity === undefined || !known.has(entry.identity),
          )
          note = {
            ruleId: "joggle",
            reason: `${before - diagnostics.length} finding(s) already in the baseline were not reported`,
          }
        }
      }
      if (options.updateBaselinePath !== undefined) {
        const identities = report.diagnostics
          .map((entry) => entry.identity)
          .filter((identity): identity is string => identity !== undefined)
        yield* writeBaseline(fs, path, baselinePath(path, options.updateBaselinePath), identities)
      }
      return note === undefined ? { ...report, diagnostics } : { ...report, diagnostics, notes: [...report.notes, note] }
    })

  const runCache = options.runCacheDir ?? options.cacheDir

  const stored = yield* readStored(fs, path, runCache)
  // A git-scoped run is not the whole repository, so the whole repository's
  // stored report is not a replay of it.
  if (options.replayUnchanged && options.changedPaths === undefined) {
    if (stored !== undefined && stored.manifest === manifest) {
      return yield* finish({
        diagnostics: stored.diagnostics,
        files: stored.files,
        rules: stored.rules,
        skipped: stored.skipped,
        drops: stored.drops ?? [],
        notes: [
          {
            ruleId: "joggle",
            reason: `replayed the previous run: nothing it depends on changed across ${stored.files} files`,
          },
          // The stored run's own notes -- the funnel, the skipped judged rules,
          // the counts -- are part of the report it replayed. Dropping them made
          // a replay look like a run that had nothing to say.
          ...stored.notes,
        ],
        structure: stored.structure ?? { concepts: 0, declarations: 0, duplicated: 0, overloaded: 0 },
        timings: [{ phase: "replay-check", ms: discoverMs }],
        // This run spent nothing, so it reports nothing spent.
        decision: { requests: 0, replayed: 0, calls: 0, unavailable: 0, inputTokens: 0, outputTokens: 0 },
        elapsedMs: (yield* Clock.currentTimeMillis) - started,
        replayed: true,
      })
    }
  }

  // The compiler's view, when the caller asked for it. This typechecks the whole
  // program, so it is opt-in and cached by the run manifest: an unchanged
  // repository reuses the trace it already paid for.
  const typeIssues: Array<string> = []
  let types: TypeIndex = emptyTypeIndex
  let typesFrom: "cache" | "trace" | "none" = "none"
  if (options.types === "trace") {
    const loaded = yield* loadTypeFacts({
      root: options.cwd,
      cacheDir: runCache,
      tool: toolFingerprint,
      manifest,
    } satisfies TypeFactRequest)
    types = loaded.index
    typesFrom = loaded.loadedFrom
    typeIssues.push(...loaded.issues)
  }

  const workspaceStarted = yield* Clock.currentTimeMillis
  // The parse cache is a performance artifact, like the run cache and the wire
  // cache, so it lives in the machine cache and never in the repository.
  const parseCache = yield* loadParses({ cacheDir: runCache, tool: toolFingerprint })
  const workspace = yield* loadWorkspace(options.cwd, options.paths, {
    discovered: files,
    contents,
    parses: parseCache.parses,
    types,
  })
  // Written after the load, and only when something was actually parsed.
  yield* parseCache.save

  // The checker's type at the nodes a rule asks about, by offset. One program,
  // a bounded request list, and only with `--types`: it costs what the trace
  // costs, and the join by offset is the one the declaration trace cannot make.
  let nodeTypes: NodeTypeIndex | undefined
  if (options.types === "trace") {
    const requests = workspace.files
      .flatMap((file) => file.facts.returns.map((entry) => ({ file: file.path, position: entry.start })))
      .slice(0, 2000)
    if (requests.length > 0) {
      const found = yield* Effect.tryPromise(() =>
        typesAtPositions({ cwd: options.cwd, tsconfig: "tsconfig.json", requests } satisfies NodeTypeQuery),
      ).pipe(Effect.orElseSucceed(() => ({ found: [], unresolved: 0 })))
      nodeTypes = indexOfNodeTypes(found.found)
    }
  }
  const timings: Array<{ phase: string; ms: number }> = [
    { phase: "workspace", ms: (yield* Clock.currentTimeMillis) - workspaceStarted },
  ]

  const diagnostics: Array<Diagnostic> = []
  const skipped: Array<Skipped> = []
  const notes: Array<Skipped> = []
  for (const issue of typeIssues) notes.push({ ruleId: "joggle", reason: issue })

  // A file outside the root produces a "../" relative path. Its evidence has no
  // business in a cache whose location nobody chose.
  const escaping = workspace.files.filter((file) => file.path.startsWith(".."))
  const breach = !options.cacheDirExplicit && escaping.length > 0
  if (breach) {
    const first = escaping[0]
    diagnostics.push(
      finding({
        ruleId: "joggle/cache-boundary",
        severity: "error",
        message: `Analysed files live outside the project root (${first?.path ?? "?"}), so judgements would be persisted into a cache that does not own that code.`,
        help: "Pass --cache-dir pointing outside the analysed tree, or run joggle from the analysed project's root.",
        location: { file: first?.path ?? ".", line: 1, column: 1 },
        judged: false,
      }),
    )
  }

  const effective = breach ? selected.filter((rule) => !rule.judged) : selected
  if (breach) {
    for (const rule of selected) {
      if (rule.judged) {
        skipped.push({ ruleId: rule.id, reason: "cache boundary: evidence would cross repositories" })
      }
    }
  }

  // Scope after the workspace is loaded: closing over the import graph needs it.
  let scope: Scope = everyFile
  if (options.changedPaths !== undefined) {
    const changed = new Set(options.changedPaths)
    const moved = new Set(options.movedPaths ?? [])
    scope = { changed, moved }
    const base = options.changedBase === undefined ? "the git base" : options.changedBase
    notes.push({
      ruleId: "joggle",
      reason:
        changed.size === 0
          ? "the changed-file list for " + base + " is empty: nothing is in scope, so this run reports nothing"
          : "scoped to " +
            changed.size +
            " file(s) that differ from " +
            base +
            (moved.size === 0
              ? ""
              : " and " + moved.size + " pure rename(s), which the content rules skip") +
            ": this answers what the change introduced, not what is wrong with the repository",
    })
  } else if (options.changed) {
    if (stored === undefined) {
      notes.push({
        ruleId: "joggle",
        reason: "scoped run with no stored run to compare against: every file is in scope",
      })
    } else {
      const since = changedSince(stored, hashOf)
      const beforeExports = new Map(
        (stored.sources ?? []).map((source) => [source.path, source.exports]),
      )
      const affected = affectedBy(
        new Set(since.changed),
        workspace.imports,
        beforeExports,
        exportsOf(workspace),
      )
      scope = { changed: affected, moved: new Set(since.renamed) }
      notes.push({
        ruleId: "joggle",
        reason:
          `scoped to ${affected.size} file(s) that moved` +
          (since.renamed.length === 0
            ? ""
            : ` and ${since.renamed.length} pure rename(s), which the content rules skip`) +
          ": this answers what the change introduced, not what is wrong with the repository",
      })
    }
  }

  const drops: Array<Drop> = []

  // The engine, in two phases.
  //
  // Phase one: every planned rule does its deterministic work and hands over its
  // questions. Phase two: the engine answers every rule's questions, batched, and
  // each rule reads its own answers. A rule that answered its own questions could
  // not share a request with any other, which is the reason for the split.
  //
  // A plain rule -- deterministic, or judged but not batched -- runs as it always
  // did. One atom store serves the whole run.
  const isPlanned = (rule: Rule | PlannedRule): rule is PlannedRule => "plan" in rule
  const plannedRules = effective.filter(isPlanned)
  const plainRules = effective.filter((rule): rule is Rule => !isPlanned(rule))

  type RuleResult = Result.Result<RuleOutcome, AiError.AiError>

  const engine = Effect.gen(function* () {
    const ruleTimings = new Map<string, number>()
    const phases = yield* Effect.forEach(
      plannedRules,
      (rule) =>
        Effect.gen(function* () {
          const ruleStarted = yield* Clock.currentTimeMillis
          const result = yield* rule.plan(workspace, scope, { config: options.config, nodeTypes }).pipe(
            Effect.map((value) => Result.succeed(value)),
            Effect.catch((error) => Effect.succeed(Result.fail(error))),
          )
          ruleTimings.set(rule.id, (yield* Clock.currentTimeMillis) - ruleStarted)
          return result
        }),
      { concurrency: "unbounded" },
    )

    // A plan is judged only when one of its files is in the run's scope. This is
    // the enforcement, not a convention: a rule that forgets to filter still
    // cannot spend a token on a candidate the run is not about, because the
    // engine never sends it and its answer is never read.
    const inScopePlan = (plan: Plan<unknown>): boolean =>
      scope.changed === undefined || plan.concerns.some((file) => inGraphScope(scope, file))
    const askedPerRule = phases.map((phase) =>
      Result.isSuccess(phase) ? phase.success.plans.filter(inScopePlan) : [],
    )
    const allPlans = askedPerRule.flat()

    // ONE request is the goal, and the provider's token ceiling is the reason it
    // cannot always be one: a whole run's evidence can exceed it, and an oversized
    // request comes back as max_tokens_exceeded, which every judged rule then
    // reads as unreadable. So the plans are cut into requests that fit, and each is
    // answered from the per-decision cache first, so a chunk boundary does not
    // cost a re-judgement.
    const chunks = yield* chunkPlans(allPlans, policy.decision.maxStateChars)

    // The run's token budget. A chunk is estimated from the state it carries --
    // the provider charges for the state, and it dominates -- so the run stops
    // before a pathological change spends without bound. What it did not judge is
    // reported as a budget drop, never dropped in silence.
    const allowed: Array<PlanChunk<unknown>> = []
    const overBudget: Array<Plan<unknown>> = []
    let estimated = 0
    for (const chunk of chunks) {
      const cost = Math.ceil(chunk.chars / 4)
      if (estimated + cost > (options.maxInputTokens ?? policy.decision.maxInputTokens)) {
        overBudget.push(...chunk.plans)
        continue
      }
      estimated += cost
      allowed.push(chunk)
    }

    // A chunk that fails is CUT AND RETRIED, not abandoned.
    //
    // The provider occasionally returns a distribution that does not sum to 1, and
    // Effect's validation fails the whole request for it. With one candidate per
    // request that cost one candidate; with a batch it costs the batch, and every
    // rule reading it sees unreadable. Halving the request changes what the model
    // is asked, so a bad answer usually does not repeat.
    const answerChunk: (
      plans: ReadonlyArray<Plan<unknown>>,
      retried?: boolean,
    ) => Effect.Effect<
      ReadonlyArray<unknown>,
      AiError.AiError,
      Atoms | PlanAnswers | DecisionModel.DecisionModel
    > = (plans, retried = false) =>
      answerPlans(plans).pipe(
        Effect.catch((error) =>
          // A model that was never reached is not a bad answer: retrying it would
          // ask the same unreachable model again, and the engine needs the error
          // to know the rule was skipped rather than judged.
          isUnreachable(error)
            ? Effect.fail(error)
            : plans.length <= 1
              // A lone request is one candidate, and the provider sometimes
              // returns a distribution that does not sum to 1. That is not a
              // judgement, so ask once more before giving the candidate up --
              // the provider is nondeterministic, and losing a candidate to a
              // malformed decimal is an instrument fault, not an answer.
              ? retried
                ? Effect.fail(error)
                : answerChunk(plans, true)
              : Effect.gen(function* () {
                  const half = Math.ceil(plans.length / 2)
                  const left = yield* answerChunk(plans.slice(0, half)).pipe(
                    Effect.orElseSucceed(() => plans.slice(0, half).map(() => undefined)),
                  )
                  const right = yield* answerChunk(plans.slice(half)).pipe(
                    Effect.orElseSucceed(() => plans.slice(half).map(() => undefined)),
                  )
                  return [...left, ...right]
                }),
        ),
      )
    const chunkResults = yield* Effect.forEach(
      allowed,
      (chunk) =>
        answerChunk(chunk.plans).pipe(
          Effect.map((values) => Result.succeed(values)),
          Effect.catch((error) => Effect.succeed(Result.fail(error))),
        ),
      { concurrency: policy.decision.requestConcurrency },
    )
    const values: Array<unknown> = []
    let failure: AiError.AiError | undefined
    const allowedSet = new Set(allowed)
    let resultIndex = 0
    for (const chunk of chunks) {
      if (allowedSet.has(chunk)) {
        const result = chunkResults[resultIndex]
        resultIndex += 1
        if (result !== undefined && Result.isSuccess(result)) {
          values.push(...result.success)
          continue
        }
        if (result !== undefined && Result.isFailure(result)) failure ??= result.failure
      }
      for (let i = 0; i < chunk.plans.length; i += 1) values.push(undefined)
    }
    const overBudgetSubjects = new Set(overBudget.map((plan) => plan.subject))
    if (overBudget.length > 0) {
      notes.push({
        ruleId: "joggle",
        reason:
          overBudget.length +
          " candidate(s) were not judged: the run's token budget of " +
          (options.maxInputTokens ?? policy.decision.maxInputTokens) +
          " was reached",
      })
    }

    const plannedOutcomes: Array<{
      readonly rule: PlannedRule
      readonly result: RuleResult
      readonly ms: number
    }> = []
    let offset = 0
    plannedRules.forEach((rule, index) => {
      const phase = phases[index]
      const ms = ruleTimings.get(rule.id) ?? 0
      if (phase === undefined) {
        plannedOutcomes.push({ rule, result: Result.succeed(outcome([])), ms })
        return
      }
      if (Result.isFailure(phase)) {
        plannedOutcomes.push({ rule, result: Result.fail(phase.failure), ms })
        return
      }
      const planned = phase.success
      const asked = askedPerRule[index] ?? []
      const start = offset
      offset += asked.length
      // The run's answer for this rule: the rule's own setting, the run's
      // `unavailable`, or the rule's declaration. `propagate` steps the rule
      // aside; `count` keeps it but counts the candidates no judgement reached.
      const unavailable = unavailableFor(options.config, rule.id, rule.onUnavailable)
      // No judgement and a rule that cannot stand without one: the engine reports
      // it as skipped. A rule with no questions is IDLE, not skipped.
      if (asked.length > 0 && failure !== undefined && isUnreachable(failure) && unavailable === "propagate") {
        plannedOutcomes.push({ rule, result: Result.fail(failure), ms })
        return
      }
      // The rule's reader indexes its own full plan list, so the answers go back
      // in that shape: the asked ones in order, undefined for the rest.
      const askedValues = values.slice(start, start + asked.length)
      let cursor = 0
      const aligned = planned.plans.map((plan) => (inScopePlan(plan) ? askedValues[cursor++] : undefined))
      let result = planned.read(aligned)
      if (asked.length > 0 && failure !== undefined && isUnreachable(failure) && unavailable === "count") {
        result = countUnjudged(result, reasonOf(failure))
      }
      // An out-of-scope plan reads as no answer to a rule that never had to know
      // the scope. That is the engine's bookkeeping, not a finding, so the drops
      // it produced are removed. A plan the budget skipped is a budget drop, not
      // an unreadable one.
      const outside = new Set(planned.plans.filter((plan) => !inScopePlan(plan)).map((plan) => plan.subject))
      const drops = result.drops
        .filter((drop) => !(drop.stage === "unreadable" && outside.has(drop.subject)))
        .map((drop) =>
          drop.stage === "unreadable" && overBudgetSubjects.has(drop.subject)
            ? {
                ...drop,
                stage: "budget" as const,
                reason: "the run's token budget was reached before this candidate",
              }
            : drop,
        )
      // The last guard, and the one that makes the invariant hold whatever a rule
      // does: a finding about a file the run is not about is not reported. A
      // fact-based rule reports an unverified finding when its answer is missing,
      // so without this an out-of-scope cluster would leak into a scoped report.
      const kept = result.diagnostics.filter((entry) => inGraphScope(scope, entry.location.file))
      plannedOutcomes.push({ rule, result: Result.succeed({ ...result, diagnostics: kept, drops }), ms })
    })

    // The plain rules are independent, and the judged ones wait on the network.
    // Running them concurrently overlaps those waits; the DecisionModel layer
    // serializes its own cache writes, so two rules finishing at once cannot
    // interleave a full write.
    const plainResults = yield* Effect.forEach(
      plainRules,
      (rule) =>
        Effect.gen(function* () {
          const ruleStarted = yield* Clock.currentTimeMillis
          // The config goes in, because a rule that enforces a layering is
          // entitled to know what the layering is.
          const result = yield* rule.run(workspace, scope, { config: options.config, nodeTypes }).pipe(
            Effect.map((value) => Result.succeed(value)),
            Effect.catch((error) => Effect.succeed(Result.fail(error))),
          )
          return { rule, result, ms: (yield* Clock.currentTimeMillis) - ruleStarted }
        }),
      { concurrency: policy.decision.requestConcurrency },
    )
    return { plannedOutcomes, plainResults }
  })

  const { plannedOutcomes, plainResults } = yield* engine.pipe(Effect.provide(atomsLayer))

  const results: ReadonlyArray<{
    readonly rule: { readonly id: string }
    readonly result: RuleResult
    readonly ms: number
  }> = [...plannedOutcomes, ...plainResults]
  for (const { rule, result, ms } of results) {
    if (Result.isSuccess(result)) {
      diagnostics.push(...result.success.diagnostics)
      for (const note of result.success.notes) notes.push({ ruleId: rule.id, reason: note })
      drops.push(...result.success.drops)
    } else {
      skipped.push({ ruleId: rule.id, reason: reasonOf(result.failure) })
    }
    timings.push({ phase: rule.id.replace("joggle/", ""), ms })
  }

  // What the run did not look at.
  //
  // The funnel rule applied to the one bound that had no report: every bound in
  // this program is a decision not to look at something, and a bound nobody can
  // see is indistinguishable from a bug. Discovery used to drop non-source files
  // inside its own loop, so "287 files" read as the repository rather than as a
  // fifth of it.
  if (discovery.truncated) {
    notes.push({
      ruleId: "joggle",
      reason: "the file walk hit its own limit: this run saw only part of the tree",
    })
  }
  // A plugin that did not load is reported, not logged and forgotten. A rule
  // that is silently absent makes the report look clean, which is the one
  // failure mode this program keeps having to design against.
  for (const failure of options.plugins?.failures ?? []) {
    notes.push({
      ruleId: "joggle",
      reason: "plugin " + failure.specifier + " was not loaded: " + failure.reason,
    })
  }
  // What the run extracted, before a single rule filtered it.
  //
  // This note exists because its absence made a clean report unreadable. Run
  // against a 110-file library, joggle reported "2 problems" and nothing else,
  // and there was no way to tell whether the rules had looked at a clean codebase
  // or at almost nothing. The extraction was fine -- 257 declarations -- but the
  // only counts in the report were the FILTERED ones each rule chose to mention,
  // so "11 type declaration(s)" read as the population when it was 11 of 53.
  const kinds = new Map<string, number>()
  for (const unit of workspace.units) kinds.set(unit.kind, (kinds.get(unit.kind) ?? 0) + 1)
  const exported = workspace.units.filter((unit) => unit.exported).length
  notes.push({
    ruleId: "joggle",
    reason:
      "extracted " +
      workspace.units.length +
      " declaration(s) from " +
      workspace.files.length +
      " file(s): " +
      [...kinds.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([kind, count]) => count + " " + kind)
        .join(", ") +
      "; " +
      exported +
      " exported, " +
      (workspace.units.length - exported) +
      " file-local",
  })

  if (parseCache.issues.length > 0) {
    notes.push({
      ruleId: "joggle",
      reason: "the parse cache did not decode and was ignored: " + parseCache.issues[0],
    })
  }
  // How many declarations the compiler could speak about. A trace that resolved
  // nothing is a run whose type-aware rules must stay silent, and the two look
  // identical in a report unless this says which happened.
  if (options.types === "trace") {
    const joined = workspace.units.filter((unit) => unit.typeFacts !== undefined).length
    notes.push({
      ruleId: "joggle",
      reason:
        "resolved " +
        joined +
        " of " +
        workspace.units.length +
        " declaration(s) to a type (" +
        typesFrom +
        ")",
    })
  }
  const parsedFromCache = workspace.parses.hits()
  const parsedAgain = workspace.parses.misses()
  if (parsedFromCache > 0 || parsedAgain > 0) {
    notes.push({
      ruleId: "joggle",
      reason:
        "parsed " +
        parsedAgain +
        " file(s) and reused " +
        parsedFromCache +
        " parse(s) from the cache",
    })
  }
  if (workspace.testDeclarations > 0) {
    notes.push({
      ruleId: "joggle",
      reason:
        workspace.testDeclarations +
        " declaration(s) in test files are compared only against each other: a factory is supposed to be repeated",
    })
  }
  if (workspace.excludedHelpers > 0) {
    notes.push({
      ruleId: "joggle",
      reason:
        workspace.excludedHelpers +
        " transpiler helper(s) were not analysed: they appear once per file by construction",
    })
  }
  if (discovery.ignored > 0) {
    notes.push({
      ruleId: "joggle",
      reason:
        "ignored by .gitignore: " +
        discovery.ignored +
        " file(s) and " +
        discovery.ignoredDirectories +
        " director" +
        (discovery.ignoredDirectories === 1 ? "y" : "ies") +
        " not analysed",
    })
  }
  if (discovery.skippedExtensions.length > 0) {
    const total = discovery.skippedExtensions.reduce((sum, entry) => sum + entry.count, 0)
    const shown = discovery.skippedExtensions.slice(0, 4).map((entry) => entry.extension + " " + entry.count)
    const rest = discovery.skippedExtensions.length - shown.length
    notes.push({
      ruleId: "joggle",
      reason:
        "not parsed: " +
        total +
        " file(s) outside the parser's extensions (" +
        shown.join(", ") +
        (rest > 0 ? ", and " + rest + " more" : "") +
        ")",
    })
  }
  if (workspace.unparsed.length > 0) {
    const example = workspace.unparsed[0]
    notes.push({
      ruleId: "joggle",
      reason:
        workspace.unparsed.length +
        " file(s) failed to parse, e.g. " +
        (example === undefined ? "" : example.path + ": " + example.reason),
    })
  }

  // The funnel, in the report rather than in a debug log.
  //
  // A rule that reports nothing is either a rule with nothing to look at or a
  // rule whose gate is too tight, and the finding count cannot tell the two
  // apart. This is what does -- and it is the only way a threshold can be tuned
  // from evidence rather than from a guess.
  notes.push(...funnelNotes(drops))

  if (options.typecheck && options.useTsgo) {
    const tsgo = yield* Tsgo
    const typeErrors = yield* tsgo.typecheck(options.cwd).pipe(Effect.orElseSucceed(() => []))
    diagnostics.push(...typecheckFindings(typeErrors))
  }

  // The config decides how loudly a rule speaks and what is excepted. Both are
  // applied here rather than inside the rules, so a rule cannot opt out of being
  // configured.
  const configured = diagnostics
    .map((entry) => ({ entry, severity: severityFor(options.config, entry.ruleId, entry.severity) }))
    .filter((item): item is { entry: Diagnostic; severity: import("./schema.ts").Severity } => item.severity !== "off")
    .map((item) => ({ ...item.entry, severity: item.severity }))
    .filter((entry) => !isIgnored({ config: options.config, ruleId: entry.ruleId, path: entry.location.file }))
    // Scoped out by configuration: this rule is not configured to speak about
    // this file. A finding, not a rule, is what gets scoped.
    .filter((entry) => appliesAt({ config: options.config, ruleId: entry.ruleId, path: entry.location.file }))

  // The workspace's own phases, alongside the per-rule timings. A run that says
  // "workspace 4.4s" and nothing else is a run nobody can make faster.
  timings.push(...workspace.phases)

  // The shape of the codebase, before any rule filtered it. A change that adds
  // declarations without adding concepts is the entropy this tool exists to
  // remove, and the two numbers together are the only honest way to say it.
  const names = new Map<string, Array<Unit>>()
  for (const unit of workspace.units) {
    const list = names.get(unit.name)
    if (list === undefined) names.set(unit.name, [unit])
    else list.push(unit)
  }
  let duplicated = 0
  let overloaded = 0
  for (const list of names.values()) {
    if (list.length > 1) duplicated += list.length
    const displays = new Set(
      list.map((unit) => unit.typeFacts?.display).filter((display) => display !== undefined),
    )
    if (displays.size > 1) overloaded += 1
  }
  const structure: Structure = {
    concepts: names.size,
    declarations: workspace.units.length,
    duplicated,
    overloaded,
  }

  const decisionTotals: DecisionTotals = yield* decisionStats.read
  const elapsedMs = (yield* Clock.currentTimeMillis) - started
  const report: Report = {
    diagnostics: rankDiagnostics(configured),
    files: workspace.files.length,
    rules: effective.length,
    structure,
    skipped,
    notes,
    drops,
    timings,
    decision: decisionTotals,
    elapsedMs,
    replayed: false,
  }

  // Stored before the baseline filter, so a later replay reproduces the whole
  // run and the baseline is applied to it again rather than baked in.
  // A scoped run is not a full run, so it must not become the baseline that the
  // next full run is compared against.
  if (!options.changed && options.changedPaths === undefined) {
    yield* writeStored(fs, path, runCache, {
      version: policy.version,
      manifest,
      sources: workspace.files.map((file) => ({
        path: file.path,
        hash: hashOf.get(file.path) ?? "",
        exports: [...(exportsOf(workspace).get(file.path) ?? [])].sort(Order.String),
      })),
      diagnostics: report.diagnostics,
      files: report.files,
      rules: report.rules,
      structure: report.structure,
      skipped: report.skipped,
      notes: report.notes,
      drops: report.drops,
      decision: decisionTotals,
      elapsedMs,
    })
  }

  return yield* finish(report)
})
