import { Schema } from "effect"
import { Move } from "./moves.ts"

/* -------------------------------------------------------------------------- */
/* Diagnostics                                                                */
/* -------------------------------------------------------------------------- */

export const Severity = Schema.Literals(["error", "warn", "info"])

export type Severity = typeof Severity.Type

/** A resolvable place in the source. `line` and `column` are 1-based. */
export const SourceLocation = Schema.Struct({
  file: Schema.String,
  line: Schema.Number,
  column: Schema.Number,
  endLine: Schema.optionalKey(Schema.Number),
  endColumn: Schema.optionalKey(Schema.Number),
})

export interface SourceLocation extends Schema.Schema.Type<typeof SourceLocation> {}

/**
 * What a finding asks you to do.
 *
 * Five operations. A decline is not one of them: `no_issue` already exists as
 * the way a question says "leave it", and a rule that finds nothing proposes
 * nothing.
 */
export const Operation = Schema.Literals(["merge", "split", "move", "replace", "migrate"])

export type Operation = typeof Operation.Type

/** One place that must change, and what to do there. */
export const Edit = Schema.Struct({
  file: Schema.String,
  /** 1-based, like every other location in this program. */
  line: Schema.Number,
  column: Schema.Number,
  /** One sentence a person or an agent can act on. */
  instruction: Schema.String,
})

export interface Edit extends Schema.Schema.Type<typeof Edit> {}

/**
 * The smaller form, and everything that changes with it.
 *
 * The operation is settled by two estimators: a table in code, and the model's
 * own read of the candidate. The cascade is never the model's -- a model that
 * listed forty-seven call sites would invent them -- and neither is the set of
 * operations on offer, which the import graph decides.
 */
export const Repair = Schema.Struct({
  operation: Operation,
  /** The declaration that survives, when one does. */
  keep: Schema.optionalKey(SourceLocation),
  /** The declarations that go. */
  remove: Schema.Array(SourceLocation),
  /** The sites that must change, in the order they must change. */
  cascade: Schema.Array(Edit),
  /** True when every site is listed, so an agent needs no search of its own. */
  complete: Schema.Boolean,
  /** Why the operation settled where it did, in one sentence. */
  settled: Schema.String,
})

export interface Repair extends Schema.Schema.Type<typeof Repair> {}

/**
 * The shape of the codebase, for the line a reader watches.
 *
 * A change that adds three declarations and one concept is healthy. A change
 * that adds three declarations and no concept is pure entropy, and that is the
 * number worth putting in front of a person.
 */
export const Structure = Schema.Struct({
  /** Distinct declared names, as the index counts them. */
  concepts: Schema.Number,
  declarations: Schema.Number,
  /** Declarations sharing a name with another declaration. */
  duplicated: Schema.Number,
  /** Names resolving to more than one type. */
  overloaded: Schema.Number,
})

export interface Structure extends Schema.Schema.Type<typeof Structure> {}

/**
 * The only thing joggle produces. Everything else -- scanning, candidate
 * generation, judgement -- exists to manufacture one of these, in the same
 * shape a linter or a typechecker emits so that hosts do not have to care
 * which kind of rule produced it.
 */
export const Diagnostic = Schema.Struct({
  ruleId: Schema.String,
  severity: Severity,
  /**
   * Which entropy reversal this finding proposes, when it proposes one.
   *
   * On the finding rather than only on the rule, because one rule can propose
   * more than one: `compose-types` reports advice to combine and a name
   * contradiction to expand. Absent means the rule is not about entropy.
   */
  move: Schema.optionalKey(Move),
  message: Schema.String,
  help: Schema.optionalKey(Schema.String),
  location: SourceLocation,
  /**
   * Present only when a judgement produced this diagnostic. Absent means the
   * rule was deterministic, which is itself useful information for a reader.
   */
  confidence: Schema.optionalKey(Schema.Number),
  /**
   * How strongly the judgement says this is real, as a Noul probability. Unlike
   * `confidence` (which summarises how peaked the Choice distribution was, and
   * measured uninformative) this is comparable across every finding in a run,
   * so it is what the report sorts by.
   */
  score: Schema.optionalKey(Schema.Number),
  /**
   * A stable name for this finding, for comparing runs.
   *
   * Built from the rule and the cluster's membership, never from line numbers:
   * code moves constantly, and a baseline that reports every edit as a new
   * finding is a baseline nobody reads. A rename or a new member does change it,
   * which is correct -- the finding is a different finding then.
   */
  identity: Schema.optionalKey(Schema.String),
  judged: Schema.Boolean,
  /**
   * The smaller form this finding proposes, when the rule can propose one.
   *
   * Absent means the finding is an observation: a rule that only warns, or a
   * candidate whose operation the graph does not permit. A host that ignores
   * this field still gets a working linter.
   */
  repair: Schema.optionalKey(Repair),
})

export interface Diagnostic extends Schema.Schema.Type<typeof Diagnostic> {}

/** A rule id and a reason: a skip, or a bound a rule hit. */
export const Note = Schema.Struct({
  ruleId: Schema.String,
  reason: Schema.String,
})

export interface Note extends Schema.Schema.Type<typeof Note> {}

/**
 * How a candidate ended up not being reported.
 *
 * Every bound and every gate in this program is a decision not to look at
 * something or not to say it, and a decision nobody can see is indistinguishable
 * from a bug: the eighteen definitions of one helper stayed invisible for three
 * runs because a cap discarded them silently.
 *
 * The stages are a closed set on purpose, so counts mean the same thing in every
 * rule. A candidate that failed a gate and one that was never looked at are
 * different facts, and mixing them into one number would hide exactly the
distinction worth seeing.
 */
export const DropStage = Schema.Literals([
  /** The model declined: it looked and found nothing. */
  "declined",
  /** The answer failed a gate. */
  "gated",
  /** No usable answer came back for this candidate. */
  "unreadable",
  /** The rule never asked: there was nothing to send. */
  "no_evidence",
  /** The run's budget ran out before this candidate. */
  "budget",
])

export type DropStage = typeof DropStage.Type

export const Drop = Schema.Struct({
  ruleId: Schema.String,
  /** The candidate, named the way the rule names it. */
  subject: Schema.String,
  stage: DropStage,
  /** Why, in the rule's own words. */
  reason: Schema.String,
})

export interface Drop extends Schema.Schema.Type<typeof Drop> {}

export const DecisionTotals = Schema.Struct({
  requests: Schema.Number,
  replayed: Schema.Number,
  calls: Schema.Number,
  unavailable: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
})

export interface DecisionTotals extends Schema.Schema.Type<typeof DecisionTotals> {}

/**
 * The previous run, kept whole so an unchanged repository costs nothing.
 *
 * `manifest` is a hash of everything the output depends on: the analysis and
 * question versions, the model, the rule set, and the content of every analysed
 * file. If it matches, the run is over before a single file is parsed.
 */
export const StoredRun = Schema.Struct({
  version: Schema.String,
  manifest: Schema.String,
  diagnostics: Schema.Array(Diagnostic),
  /**
   * Content hash per analysed file, so the NEXT run can say which files moved.
   *
   * The manifest says whether anything changed; this says what did, which is
   * what lets a run scope itself to the change instead of re-deriving findings
   * about code nobody touched.
   */
  sources: Schema.Array(
    Schema.Struct({
      path: Schema.String,
      hash: Schema.String,
      /**
       * Exported names, so the next run can tell a body edit from an interface
       * edit: only the latter can move what a dependent's type names resolve to.
       */
      exports: Schema.Array(Schema.String),
    }),
  ),
  files: Schema.Number,
  rules: Schema.Number,
  /**
   * The shape of the codebase this run measured.
   *
   * Optional so a run stored before this existed still replays, and so a replayed
   * report can say it does not know rather than print a zero that looks measured.
   */
  structure: Schema.optionalKey(Structure),
  skipped: Schema.Array(Note),
  notes: Schema.Array(Note),
  /**
   * Candidates this run considered and did not report, with the reason.
   *
   * Optional so a run stored before this existed still replays: reading
   * defensively and writing strictly is what keeps a cache an optimisation
   * rather than a compatibility problem.
   */
  drops: Schema.optionalKey(Schema.Array(Drop)),
  decision: DecisionTotals,
  elapsedMs: Schema.Number,
})

export interface StoredRun extends Schema.Schema.Type<typeof StoredRun> {}

/**
 * The findings a repository has already accepted, so a later run can report
 * only what changed. Committed on purpose: the point is to compare against a
 * baseline that lives in the repository, not one that lives in a cache.
 */
export const Baseline = Schema.Struct({
  version: Schema.String,
  identities: Schema.Array(Schema.String),
})

export type Baseline = typeof Baseline.Type

/* -------------------------------------------------------------------------- */
/* Typed errors                                                                */
/* -------------------------------------------------------------------------- */

export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()(
  "joggle/WorkspaceError",
  {
    path: Schema.String,
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export class TsgoError extends Schema.TaggedError<TsgoError>()("joggle/TsgoError", {
  operation: Schema.String,
  detail: Schema.String,
}) {}

export class GitError extends Schema.TaggedError<GitError>()("joggle/GitError", {
  operation: Schema.String,
  detail: Schema.String,
}) {}

/**
 * A rule reported a message its own registry does not declare, or a template hole
 * it gave no data for. That is a bug in the rule, not in the code under analysis.
 */
export class RuleAuthoringError extends Schema.TaggedError<RuleAuthoringError>()(
  "joggle/RuleAuthoringError",
  {
    ruleId: Schema.String,
    messageId: Schema.String,
    detail: Schema.String,
  },
) {}

