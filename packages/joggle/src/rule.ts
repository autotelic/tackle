import type { Effect, Predicate } from "effect"
import type { Atoms } from "./atoms.ts"
import type { Plan, PlanAnswers } from "./plans.ts"
import { policy } from "./policy.ts"
import type { JoggleConfig } from "./config.ts"
import type * as AiError from "effect/unstable/ai/AiError"
import type { Decision, DecisionModel } from "effect/unstable/ai"
import type { Diagnostic, Drop, Operation, Repair, Severity, SourceLocation } from "./schema.ts"
import type { ReportedRule } from "./reporting.ts"
import type { Move } from "./moves.ts"
import type { Workspace } from "./workspace.ts"

/*
 * A rule is a function from the deterministic workspace index to diagnostics.
 *
 * The interesting conventions are inside each rule, not in this interface:
 *
 *   find      deterministic, high recall, noise tolerated
 *   evidence  the panel a reviewer would need to decide
 *   decisions atomic, typed, sent in one request
 *   policy    weights and thresholds, imported from policy.ts
 *   diagnose  span, message, help -- the product
 *
 * Deterministic rules simply never call the model. That is the whole
 * difference; the output shape is identical, so a host cannot tell them apart.
 */
/**
 * What a rule produced, and what it declined to do.
 *
 * The notes are not decoration. Every bound in this program is a decision not to
 * look at something, and a bound nobody can see is indistinguishable from a bug:
 * the eighteen definitions of one helper stayed invisible for three runs because
 * a cap discarded them silently. A rule that hits a limit now says so, in its own
 * words, and the limit appears in the report beside the findings.
 */
export interface RuleOutcome {
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly notes: ReadonlyArray<string>
  /**
   * Candidates this rule considered and did not report, with the reason.
   *
   * The findings are the report; these are the funnel that produced it. A rule
   * that reports nothing is either a rule with nothing to look at or a rule
   * whose gate is too tight, and only this tells the two apart.
   */
  readonly drops: ReadonlyArray<Drop>
}

/** A rule's whole result: its findings, its notes, and the candidates it dropped. */
export const outcome = (
  diagnostics: ReadonlyArray<Diagnostic>,
  notes: ReadonlyArray<string> = [],
  drops: ReadonlyArray<Drop> = [],
): RuleOutcome => ({ diagnostics, notes, drops })

/**
 * Turn a rule's unjudged findings into a count.
 *
 * A repository without a model key can ask for `count`: the rule still ran and
 * the candidates are real, but printing each one as an unverified warning is
 * noise it does not want. The unverified findings become one note, so the funnel
 * still says how many there were, and the judged findings (there are none when
 * the whole run had no answer) stay. This is the repository's answer to "do not
 * print the candidates", not a claim that the rule found nothing.
 */
export const countUnjudged = (result: RuleOutcome, reason: string): RuleOutcome => {
  const unverified = result.diagnostics.filter((entry) => !entry.judged)
  if (unverified.length === 0) return result
  return {
    diagnostics: result.diagnostics.filter((entry) => entry.judged),
    notes: [...result.notes, unverified.length + " candidate(s) were not judged: " + reason],
    drops: result.drops,
  }
}

/**
 * How much of the workspace this run has to look at.
 *
 * Scoping is only sound for "what did this change introduce?". A new finding
 * always has at least one member whose content changed -- a change elsewhere
 * cannot create a duplicate between two declarations it did not touch -- so
 * restricting candidate generation to changed declarations loses nothing about
 * THIS change. It does lose the rest of the report, which is why a scoped run is
 * a different question and not a faster way to ask the same one.
 */
export interface Scope {
  /**
   * Files whose content changed since the stored run, plus the files that import
   * them (a change to a file's exports can move what a dependent's type names
   * resolve to). Undefined means every file.
   */
  readonly changed: ReadonlySet<string> | undefined
  /**
   * Files a git scope saw as a pure rename: the path moved and the bytes did not.
   *
   * A content rule has nothing to say about them -- their bytes are not new -- so
   * it does not read this. A graph rule does, because the move itself can create
   * a new relationship: a module that sat beside something may now sit above it.
   */
  readonly moved?: ReadonlySet<string> | undefined
}

export const everyFile: Scope = { changed: undefined, moved: undefined }

/**
 * True when this declaration's CONTENT is in scope for the run.
 *
 * The default, and what every rule that reads a declaration's body or name
 * wants. A pure rename is deliberately not in scope: its content was already
 * here under another name.
 */
export const inScope = (scope: Scope, file: string): boolean =>
  scope.changed === undefined || scope.changed.has(file)

/**
 * True when this file is in scope for a rule that reads the IMPORT GRAPH.
 *
 * A moved file's content is not new, but its edges are: a move can put a module
 * on the wrong side of a boundary it used to respect. So graph rules see the
 * union, and content rules see `changed` alone.
 */
export const inGraphScope = (scope: Scope, file: string): boolean =>
  scope.changed === undefined || scope.changed.has(file) || (scope.moved?.has(file) ?? false)

/**
 * What every rule is told about the run, beyond the code it is reading.
 *
 * The config belongs here rather than on the workspace because it describes the
 * repository's ARCHITECTURE, and a rule that enforces a layering is entitled to
 * know what the layering is. Rules that need nothing take two parameters and
 * ignore this one.
 */
export interface RunContext {
  readonly config: JoggleConfig
  /**
   * The checker's type at a byte offset, when the run resolved node types.
   *
   * Absent unless `--types` ran, so a rule that needs it says so rather than
   * reading an empty map and concluding "no types".
   */
  readonly nodeTypes?: ((file: string, position: number) => string | undefined) | undefined
}

/**
 * A rule, with the fields a reporter needs taken from `ReportedRule`.
 *
 * The composition is not cosmetic: it is what keeps a reporter's view of a rule
 * and a rule's own declaration the same shape, so a shared field is added in one
 * place.
 */
export interface Rule extends ReportedRule {
  readonly description: string
  /**
   * The operations this rule can propose. Absent means it only warns.
   *
   * The model never sees this list. It is what the report groups by, and what
   * tells a reader whether a finding is an observation or a work order.
   */
  readonly operations?: ReadonlyArray<Operation> | undefined
  readonly run: (
    workspace: Workspace,
    scope: Scope,
    context: RunContext,
  ) => Effect.Effect<
    RuleOutcome,
    AiError.AiError,
    DecisionModel.DecisionModel | Atoms | PlanAnswers
  >
}

/**
 * Declare a deterministic rule.
 *
 * Identity today, and the seam where a rule gains a name, a severity or a
 * validated shape without every rule file changing.
 */
export const defineRule = (rule: Rule): Rule => rule

/**
 * A judged rule in two phases, so the engine can answer every rule's questions in
 * one request.
 *
 * `plan` does the deterministic work and returns the questions plus a reader; the
 * engine answers every planned rule's questions together, then calls each reader.
 * A rule that answered its own questions could not be batched with any other,
 * which is the whole reason for the split.
 *
 * A rule that does not need batching stays a plain `Rule` and answers its own
 * questions. The engine runs both kinds in one pass.
 */
export interface PlannedRule extends ReportedRule {
  readonly description: string
  /** A planned rule always needs the model; the plan half asks its questions. */
  readonly judged: true
  /** The operations this rule can propose. Absent means it only warns. */
  readonly operations?: ReadonlyArray<Operation> | undefined
  /**
   * What to do when no judgement is available. `report` still reports its facts;
   * `propagate` steps aside and the engine reports the rule as skipped.
   */
  readonly onUnavailable: "report" | "propagate"
  readonly plan: (
    workspace: Workspace,
    scope: Scope,
    context: RunContext,
  ) => Effect.Effect<Planned, AiError.AiError, Atoms | DecisionModel.DecisionModel>
}

/**
 * What a planned rule produced before judgement: the questions, and how to read
 * their answers.
 *
 * The reader is a closure rather than a second method because it needs the
 * phase's own facts -- the clusters, the imports, the layers -- and those are the
 * rule's, not the engine's.
 */
export interface Planned {
  readonly plans: ReadonlyArray<Plan<unknown>>
  readonly read: (answers: ReadonlyArray<unknown>) => RuleOutcome
}

/** A rule's candidate budget: the kind, the counts, and the largest unjudged. */
interface BudgetNote {
  readonly unitKind: string
  readonly judged: number
  readonly candidates: number
  readonly sample: ReadonlyArray<string>
}

/**
 * Standard wording for a bound a rule hit, so that no rule invents its own and
 * no reader has to guess whether silence meant "nothing there".
 */
export const budgetNote = ({ unitKind, judged, candidates, sample }: BudgetNote): ReadonlyArray<string> =>
  candidates <= judged
    ? []
    : [
        `${candidates - judged} of ${candidates} ${unitKind} were not judged (budget ${judged}). Largest unjudged: ${sample.join("; ")}`,
      ]

/** A count of bundles and how many of them broke the pattern. */
interface BundleTally {
  readonly bundles: number
  readonly broken: number
}

/** One line for the producer rules: how many bundles were well formed. */
export const bundleNote = ({ bundles, broken }: BundleTally): ReadonlyArray<string> =>
  bundles === 0 ? [] : [`${bundles - broken} of ${bundles} composition bundle(s) follow the pattern`]

/** A value together with its position in the workspace, for union-find below. */
export interface Sized<T> {
  readonly item: T
  readonly position: number
}

/**
 * Sweep a size-ordered list, visiting only the pairs that could clear a
 * similarity threshold.
 *
 * Kept as the reference implementation: it compares every pair inside the size
 * window, so it is complete by construction. `allPairs` in similarity.ts uses
 * prefix filtering to avoid the quadratic count, and a test asserts the two
 * report the same pairs. When they disagree, this one is right.
 *
 * Jaccard(A, B) >= t implies |A| / |B| >= t, because the intersection cannot be
 * larger than the smaller side. So once the list is sorted by size, each left
 * item has a known window of right items and the scan can stop at the first item
 * past it. That is a completeness-preserving filter: unlike sorting pairs by
 * score and slicing, it cannot drop a pair that would have qualified.
 */
export const sweep = <T>(
  ordered: ReadonlyArray<Sized<T>>,
  size: (value: T) => number,
  threshold: number,
  visit: (left: Sized<T>, right: Sized<T>) => void,
): number => {
  let compared = 0
  for (let i = 0; i < ordered.length; i += 1) {
    const left = ordered[i]
    if (left === undefined) continue
    const smaller = size(left.item)
    if (smaller === 0 || threshold <= 0) continue
    const limit = smaller / threshold
    for (let j = i + 1; j < ordered.length; j += 1) {
      const right = ordered[j]
      if (right === undefined) break
      if (size(right.item) > limit) break
      compared += 1
      visit(left, right)
    }
  }
  return compared
}

/**
 * A diagnostic being built. The published type is readonly, so a finding that
 * adds an optional field needs a mutable view of the same shape.
 */
type MutableDiagnostic = { -readonly [K in keyof Diagnostic]: Diagnostic[K] }

/** Build one diagnostic, with the fields every finding carries. */
export const finding = (input: {
  readonly ruleId: string
  readonly severity: Severity
  readonly message: string
  readonly location: SourceLocation
  readonly judged: boolean
  readonly help?: string | undefined
  readonly confidence?: number | undefined
  readonly score?: number | undefined
  /** A stable name for this finding, for comparing one run against the next. */
  readonly identity?: string | undefined
  /** The smaller form this finding proposes, when the rule can propose one. */
  readonly repair?: Repair | undefined
  /** Overrides the rule's own move, for a rule that proposes more than one. */
  readonly move?: Move | undefined
}): Diagnostic => {
  // Built field by field rather than with conditional spreads: an empty-object
  // spread hides the omission, and a reader has to reason about two shapes to
  // see that a field is optional.
  const diagnostic: MutableDiagnostic = {
    ruleId: input.ruleId,
    severity: input.severity,
    message: input.message,
    location: input.location,
    judged: input.judged,
  }
  if (input.help !== undefined) diagnostic.help = input.help
  if (input.confidence !== undefined) diagnostic.confidence = input.confidence
  if (input.score !== undefined) diagnostic.score = input.score
  if (input.identity !== undefined) diagnostic.identity = input.identity
  if (input.repair !== undefined) diagnostic.repair = input.repair
  if (input.move !== undefined) diagnostic.move = input.move
  return diagnostic
}

/*
 * The one question every rule asks, and the only answer code reads.
 *
 * It lived in each rule file until joggle reported its own copy of it three
 * times. That is the tool working: the shape was identical, the names were
 * identical, and nothing about the three copies was intentional.
 */
/**
 * The names a judged question uses to decline, and the only two there are.
 *
 * The TypeSafe docs put `noIssue` in the mechanism map for EVERY dimension --
 * "The selected evidence does not support a concrete correctness issue". It sits
 * beside `condition` and `state` as a member of the vocabulary the model chooses
 * from, not as a low score or an absent answer. So a decline is an ANSWER, and
 * code can read it as one; that is the whole point. A question with no way to
 * decline still gets answered, just with a small number that means nothing.
 *
 * This rule set had four names for two ideas -- `not_duplication`, `distinct`,
 * `keep_local`, `none` -- which meant no shared reader, and no place to see that
 * a question could not say "this is fine". Two names now, used everywhere:
 *
 *   no_issue        there is no problem here
 *   not_applicable  the rule is looking at the wrong kind of thing
 *
 * A question that offers either documents it in `instructions.fallback`, so the
 * decline is stated rather than left to be inferred from the option list.
 */
export const decline = { noIssue: "no_issue", notApplicable: "not_applicable" } as const

/** Every name that means "no finding", for tests and for reading a vocabulary. */
export const declineNames: ReadonlyArray<string> = [decline.noIssue, decline.notApplicable]

/**
 * True when a Choice declined.
 *
 * An absent choice is NOT a decline: it is silence, and the two are treated
 * differently downstream -- a decline means the rule looked and found nothing,
 * silence means the rule never got an answer.
 */
export const declined: Predicate.Predicate<string | undefined> = (choice) =>
  choice === decline.noIssue || choice === decline.notApplicable

/**
 * How consistently the model gave a Noul's answer, across the repeats.
 *
 * The share of asks that agreed with the majority. Read by `verdictOf` as a
 * Noul's margin, so a probability the model reaches by different routes is gated
 * exactly as a Choice the model shrugged across. Absent when the question was
 * asked once, or for a Choice, whose distribution is its own signal.
 */
export interface Consistency {
  readonly consistency?: number | undefined
}

/** The answers a DecisionModel returns, keyed by decision name. */
export type DecisionAnswers = Readonly<Record<string, Decision.Answer<Decision.Any>>>

/** Winner minus runner-up in a classify answer's own distribution. */
export const marginOfAnswer = (
  answer: Decision.ClassifyAnswer<string> | Decision.RateAnswer<string>,
): number => {
  const ranked = Object.values(answer.probabilities).sort((left, right) => right - left)
  const [first, second] = ranked
  if (first === undefined) return 1
  return second === undefined ? 1 : first - second
}

/**
 * What to do with a judgement: act on it, report it for review, or drop it.
 *
 * The three ranges are TypeSafe's own advice. A Noul below the floor is the model
 * saying no, and no is a verdict. A choice the model shrugged across, or an answer
 * it is not confident about, is the model saying "I am not sure" -- which is not a
 * no, and dropping it as if it were throws away the one signal that says a reader
 * should look. So it becomes an info finding instead.
 */
export type Quality = "act" | "review" | "drop"

/** Why a judgement is in its range. */
export interface JudgementQuality {
  readonly quality: Quality
  readonly reason: string
}

/**
 * Which range an answer falls in.
 *
 * A judgement that fails its floor is not a worse judgement, it is not a
 * judgement: callers treat it exactly as they treat an absent answer, which is
 * what keeps one gate from having to know how each rule degrades. A judgement
 * that is merely uncertain is still a judgement, and is reported.
 */
export const qualityOf = (input: {
  readonly score: number
  readonly margin: number | undefined
  readonly confidence?: number | undefined
}): JudgementQuality => {
  const round = (value: number): string => value.toFixed(2)
  if (input.score < policy.decision.gates.probabilityFloor) {
    return { quality: "drop", reason: `the yes/no question answered no (${round(input.score)})` }
  }
  if (input.margin !== undefined && input.margin < policy.decision.gates.minMargin) {
    return { quality: "review", reason: `the choice was not decisive (margin ${round(input.margin)})` }
  }
  if (input.confidence !== undefined && input.confidence < policy.decision.gates.reviewFloor) {
    return { quality: "review", reason: `the answer was not certain (confidence ${round(input.confidence)})` }
  }
  return { quality: "act", reason: "" }
}

/** Short, human-readable "file:line:col" for messages. */
export const at = (location: SourceLocation): string =>
  `${location.file}:${location.line}:${location.column}`
