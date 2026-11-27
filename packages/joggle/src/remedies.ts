import { Effect, Predicate, Result, Schema } from "effect"
import { Decision } from "effect/ai"
import type { AiError, DecisionModel } from "effect/ai"
import { BuildFailure, lookup, type NoMatch } from "./either.ts"
import { Atoms } from "./atoms.ts"
import { canonical } from "./canonical.ts"
import { isUnreachable } from "./decision.ts"
import { policy } from "./policy.ts"
import {
  answerPlansRaw,
  answerPlansResilient,
  PlanAnswers,
  chunkPlans,
  type Plan,
} from "./plans.ts"
import { shortHash } from "./state.ts"
import { createFactStore, type StoredFinding } from "./store.ts"

/*
 * A remedy is a column, not a prose answer.
 *
 * Every finding says what is wrong. Most also say what to do about it, and the
 * useful number is not how many findings a repository has but how many distinct
 * repairs they ask for. That normalisation is a judgement because two messages
 * can prescribe one repair in two vocabularies; the deterministic witness (the
 * imperative clause with the diagnosis dropped) is kept beside it, because a
 * disagreement between the cheap computation and the judgement is itself the
 * finding.
 *
 * The input is always a findings stream, never a rule set: joggle's own JSON and
 * oxlint's JSON both arrive here unchanged.
 */

export interface RemedyFinding {
  /** `file:line`, as the fact store records it. */
  readonly site: string
  readonly file: string
  readonly line: number
  readonly rule: string
  readonly message: string
  readonly help?: string | undefined
}

/**
 * One diagnostic, in either engine's vocabulary.
 *
 * oxlint names the file `filename`, calls the rule `code`, and puts the line
 * inside its first label span; joggle names them `location.file`, `ruleId` and
 * `location.line`. Every field is optional because the decode is the one place
 * both shapes are spelled; the reader below takes whichever each engine gave.
 */
const EngineDiagnostic = Schema.Struct({
  filename: Schema.optional(Schema.String),
  file: Schema.optional(Schema.String),
  line: Schema.optional(Schema.Number),
  code: Schema.optional(Schema.String),
  ruleId: Schema.optional(Schema.String),
  message: Schema.optional(Schema.String),
  help: Schema.optional(Schema.String),
  location: Schema.optional(
    Schema.Struct({
      file: Schema.optional(Schema.String),
      line: Schema.optional(Schema.Number),
      column: Schema.optional(Schema.Number),
    }),
  ),
  labels: Schema.optional(
    Schema.Array(
      Schema.Struct({
        span: Schema.optional(
          Schema.Struct({
            line: Schema.optional(Schema.Number),
          }),
        ),
      }),
    ),
  ),
})

/** Either engine's findings document: joggle's object or oxlint's bare array. */
export const FindingsPayload = Schema.Union([
  Schema.Struct({ diagnostics: Schema.Array(EngineDiagnostic) }),
  Schema.Array(EngineDiagnostic),
])

/** The decoded findings document {@link findingsOf} reads. */
export type FindingsPayload = typeof FindingsPayload.Type

type EngineDiagnostic = typeof EngineDiagnostic.Type

/**
 * Read either engine's JSON, without asking either to change.
 *
 * The payload has already been decoded by {@link FindingsPayload}; this only
 * normalises the two vocabularies. A missing line degrades to 1 rather than
 * dropping the finding: an unlocated finding is still a finding.
 */
export const findingsOf = (payload: FindingsPayload): ReadonlyArray<RemedyFinding> => {
  const diagnostics = "diagnostics" in payload ? payload.diagnostics : payload
  const out: Array<RemedyFinding> = []
  for (const raw of diagnostics) {
    const file = raw.filename ?? raw.file ?? raw.location?.file ?? "<unknown>"
    const line = raw.line ?? raw.location?.line ?? raw.labels?.[0]?.span?.line ?? 1
    const rule = raw.code ?? raw.ruleId ?? "unknown"
    out.push({
      site: file + ":" + String(line),
      file,
      line,
      rule,
      message: raw.message ?? "",
      help: raw.help,
    })
  }
  return out
}

/**
 * The deterministic witness: the last sentence, which is the imperative one.
 *
 * Rule messages are written diagnosis first, remedy second ("Type assertion
 * discards type evidence. Narrow with…"). Taking the final sentence drops the
 * diagnosis and keeps the instruction without knowing any rule id. It is a
 * witness, not the normaliser: two rules can describe one repair in two
 * vocabularies, and only the judgement can say so.
 */
export const witnessClause = (message: string): string => {
  const normalized = message.replace(/`/gu, "").replace(/\s+/gu, " ").trim()
  if (normalized === "") return "none"
  const sentences = normalized
    .split(/(?<=[.!?])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
  const clause = sentences.at(-1) ?? normalized
  return clause.replace(/[.!?]+$/u, "").trim() || "none"
}

/**
 * The repairs a diagnosis-only message implies, for the judgement's option set.
 *
 * Some rules state the finding without an imperative: `@effect/ui/Command#make
 * is an experimental API` prescribes exactly one action. The witness cannot see
 * it, because there is no imperative sentence to take. If the option set is
 * built from witness clauses alone, `j_repair` can only answer `none`, and an
 * 83-site experimental-API cluster is labelled with a non-answer. So the code
 * derives the implied repair and offers it as a candidate; the judgement still
 * chooses, this only stops the choice being absent.
 *
 * @param clause - a message's witness clause.
 * @returns the repairs the clause implies, empty when it names no action.
 */
export const impliedRepairsOf = (clause: string): ReadonlyArray<string> => {
  const text = clause.trim()
  if (/\bis (?:an? )?(?:experimental|deprecated)(?: API)?$/iu.test(text)) {
    return ["Use the non-experimental, non-deprecated API"]
  }
  return []
}

/**
 * The verbs a repair clause may open with.
 *
 * This is deliberately a whitelist rather than a grammar: the witness takes the
 * last sentence of a rule message, and a sentence that opens with a noun is the
 * subject the message is about, not an instruction. The list started from the
 * verbs the measured corpus uses; adding a verb here is a deliberate widening,
 * not a fallback for a clause that failed to parse.
 */
const imperativeVerbs: ReadonlySet<string> = new Set([
  "accept",
  "add",
  "apply",
  "avoid",
  "bind",
  "build",
  "call",
  "capture",
  "check",
  "convert",
  "create",
  "declare",
  "define",
  "delete",
  "derive",
  "document",
  "drop",
  "encode",
  "ensure",
  "export",
  "extract",
  "fix",
  "give",
  "guard",
  "handle",
  "import",
  "include",
  "inject",
  "keep",
  "leave",
  "limit",
  "make",
  "merge",
  "move",
  "name",
  "narrow",
  "normalise",
  "normalize",
  "parse",
  "pass",
  "prefer",
  "produce",
  "provide",
  "read",
  "reject",
  "remove",
  "rename",
  "replace",
  "require",
  "return",
  "route",
  "run",
  "set",
  "signal",
  "skip",
  "split",
  "state",
  "stop",
  "store",
  "supply",
  "take",
  "test",
  "throw",
  "treat",
  "type",
  "update",
  "use",
  "validate",
  "verify",
  "wait",
  "wrap",
  "write",
])

const firstWordOf = (text: string): string =>
  text
    .trim()
    .replace(/^["'`\u2018\u2019\u201c\u201d]+/u, "")
    .split(/[\s:]/u)[0]
    ?.toLowerCase() ?? ""

/**
 * Whether a witness clause is a repair instruction rather than its subject.
 *
 * `Use the non-experimental API` is an imperative. `@effect/ui/Command#make is
 * an experimental API` is the subject of the finding, and naming a cluster after
 * it restates the finding instead of prescribing a repair -- worse, every site
 * carries a different API name, so the cluster can never merge.
 *
 * @param clause - a message's witness clause.
 * @returns true when the clause opens with an imperative verb.
 */
export const isImperativeClause: Predicate.Predicate<string> = (clause) =>
  imperativeVerbs.has(firstWordOf(clause))

/**
 * Accept a composed remedy as a repair label.
 *
 * This is the cheap gate the first family/clause run lacked: a repair label
 * must be a phrase, and it must not start with `@`, a quote, or a capitalised
 * product name. Those are the shapes a subject takes when it leaks into the
 * label, and they are cheap to reject at the point of composition.
 *
 * @param label - the composed `family: clause` remedy.
 * @returns the accepted label, or the reason it cannot stand as a repair.
 */
export const repairLabel = (label: string): Result.Result<string, string> => {
  const trimmed = label.trim()
  if (trimmed === "") return Result.fail("is empty")
  if (/^[@'"`\u2018\u2019\u201c\u201d]/u.test(trimmed)) {
    return Result.fail("starts with a quote or an API name")
  }
  if (/^[A-Za-z_$][\w$]*$/u.test(trimmed)) return Result.fail("is a bare identifier")
  if (/^[A-Z]/u.test(trimmed) && !isImperativeClause(trimmed)) {
    return Result.fail("starts with a capitalised product name")
  }
  return Result.succeed(trimmed)
}

/**
 * The diagnosis a message opens with, dropped from the witness clause.
 *
 * A counterexample pack quotes it rather than the whole message, so the reason a
 * rule cannot reach a site is the trigger the other rule did not see, not the
 * remedy both prescribe.
 */
const diagnosisOf = (message: string): string => {
  const normalized = message.replace(/`/gu, "").replace(/\s+/gu, " ").trim()
  const first = normalized.split(/(?<=[.!?])\s+/u)[0] ?? normalized
  return first.replace(/[.!?]+$/u, "").trim() || message
}

interface MessageNode {
  readonly key: string
  readonly message: string
  readonly help: string | undefined
  readonly clause: string
  readonly findings: ReadonlyArray<RemedyFinding>
}

/**
 * The identity of one message: canonical JSON of its text and help.
 *
 * Findings sharing a key are one node in every grouping, so the key must not
 * depend on the site or the rule.
 *
 * @param finding - the finding whose message is keyed.
 * @returns a stable key for the message and its help text.
 */
export const messageKeyOf = (finding: RemedyFinding): string =>
  canonical({ message: finding.message, help: finding.help ?? "" })

const messageNodesOf = (findings: ReadonlyArray<RemedyFinding>): ReadonlyArray<MessageNode> => {
  const byKey = new Map<
    string,
    { message: string; help: string | undefined; clause: string; findings: Array<RemedyFinding> }
  >()
  for (const finding of findings) {
    const key = messageKeyOf(finding)
    const existing = byKey.get(key)
    if (existing === undefined) {
      byKey.set(key, {
        message: finding.message,
        help: finding.help,
        clause: witnessClause(finding.message),
        findings: [finding],
      })
    } else {
      existing.findings.push(finding)
    }
  }
  return [...byKey.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => ({
      key,
      message: value.message,
      help: value.help,
      clause: value.clause,
      findings: value.findings,
    }))
}

export interface RepairOpinion {
  /** Message key to the repair label the judgement chose. */
  readonly repairs: ReadonlyMap<string, string>
  /**
   * Message key to the repair family the first question answered.
   *
   * The family is the coarse answer and the clause is the fine one, so a pair
   * may only be joined by the pairwise question inside one family. Two messages
   * from different rules fitting one family is not the same as two findings
   * sharing a repair: the measured error was `use the stable API` absorbing five
   * `no-nullish-default-on-partial-input` findings, whose repair is a schema
   * choice, not an API swap.
   */
  readonly families?: ReadonlyMap<string, string> | undefined
  /**
   * Message keys whose repair was implied by the family, not asked.
   *
   * A Choice with one candidate is a decision already made. Recording the keys
   * keeps that distinction visible: an implied repair is answered, but it was
   * never a question.
   */
  readonly implied?: ReadonlySet<string> | undefined
  /** Message key pair to the probability the two prescribe the same repair. */
  readonly same: ReadonlyMap<string, number>
  /**
   * Message key pair to the probability the trigger difference changes that
   * repair. `same` without this is only half the rung 2 decision.
   */
  readonly material?: ReadonlyMap<string, number> | undefined
  /** Message key pair to the probability one trigger is a strict subset. */
  readonly subcase?: ReadonlyMap<string, number> | undefined
  /** Set when the model was never reached; witness-only clustering follows. */
  readonly unavailable?: string | undefined
  /** Requests that still failed after halving, named rather than hidden. */
  readonly failures: ReadonlyArray<string>
  readonly questions: number
  readonly pairs: number
  /** How many pairs each gated judgment was asked of, and how many needed none. */
  readonly counts?: RemedyQuestionCounts | undefined
  /**
   * Messages whose witness clause is a subject, not an imperative.
   *
   * They are not offered as clause candidates. Reporting them keeps the
   * interesting failure visible: a diagnosis-only message needs its repair
   * derived (the experimental API is the measured case), not restated.
   */
  readonly rejectedClauses?:
    | ReadonlyArray<{
        readonly message: string
        readonly clause: string
      }>
    | undefined
}

/**
 * The gated question counts, so a run can say what it did not ask.
 *
 * `decidedByCode` is the interesting number: pairs whose merge `j_remedy`
 * already rejected, so no materiality or subcase judgment could change it.
 * Rung 3's preview is how much of the corpus code can settle alone.
 */
export interface RemedyQuestionCounts {
  readonly remedy: number
  readonly material: number
  readonly subcase: number
  readonly decidedByCode: number
}

/** Which pairs get the refinement questions, and which the merge question settled alone. */
export interface RefinementGate {
  /** Pair keys whose repairs match, so materiality is worth asking. */
  readonly material: ReadonlyArray<string>
  /** Pair keys whose trigger difference is material, so a subcase is worth asking. */
  readonly subcase: ReadonlyArray<string>
  /** Pairs `j_remedy` rejected; no refinement can change the merge. */
  readonly decidedByCode: number
}

/**
 * Gate the two refinement questions on the answer that can make them matter.
 *
 * Materiality is not a property of a pair in isolation: it matters only for a
 * merge under consideration. A pair the merge question already rejected has no
 * repair for a trigger difference to affect. Likewise a subcase only refines a
 * difference that materiality says changes the repair.
 *
 * @param input.pairs - The pairs, by stable key.
 * @param input.remedy - `j_remedy` answers; a missing answer is not a merge.
 * @param input.material - `j_material` answers for the pairs asked so far.
 * @returns the keys each refinement is asked of, and the count code settles at step one.
 */
export const refinementGateOf = ({
  pairs,
  remedy,
  material,
}: {
  readonly pairs: ReadonlyArray<{ readonly key: string }>
  readonly remedy: ReadonlyMap<string, number>
  readonly material: ReadonlyMap<string, number>
}): RefinementGate => {
  const same = pairs.filter((pair) => {
    const probability = remedy.get(pair.key)
    return probability !== undefined && probability > policy.decision.remedy.sameRemedy
  })
  const rejected = pairs.filter((pair) => {
    const probability = remedy.get(pair.key)
    return probability !== undefined && probability <= policy.decision.remedy.sameRemedy
  })
  return {
    material: same.map((pair) => pair.key),
    subcase: same
      .filter((pair) => {
        const probability = material.get(pair.key)
        return probability !== undefined && probability >= policy.decision.remedy.material
      })
      .map((pair) => pair.key),
    decidedByCode: rejected.length,
  }
}

/** The three probabilities one pair question answers, and no sentence. */
export interface RemedyJudgments {
  /** `j_remedy`: do the messages prescribe one repair? */
  readonly remedy: number | undefined
  /** `j_material`: does the trigger difference change that repair? */
  readonly material: number | undefined
  /** `j_subcase`: is `b.trigger` a strict subset of `a.trigger`? */
  readonly subcase: number | undefined
}

/** The only branch code may take, and the thresholds it was taken with. */
export interface RemedyDecision {
  readonly branch: "same" | "subcase" | "independent"
  readonly reason: string
  readonly thresholds: {
    readonly sameRemedy: number
    readonly material: number
    readonly subcase: number
  }
}

/** One side of a trace: what code already knows about a rule. */
export interface TraceSide {
  readonly rule: string
  readonly sites: number
  readonly family: string | undefined
  readonly clause: string | undefined
}

/** The facts behind one cross-rule merge. */
export interface ClusterTraceFacts {
  readonly a: TraceSide
  readonly b: TraceSide
  readonly intersect: boolean
}

/**
 * One multi-rule cluster's audit, split into facts, judgments and decision.
 *
 * The trace is the acceptance of rung 2: it carries the three probabilities and
 * the published thresholds, so `recomputeTraceDecision` reaches the same branch
 * from the JSON alone. A decision a later reader cannot recompute is a memory,
 * not a judgment.
 */
export interface ClusterTrace {
  readonly cluster: string
  readonly a: string
  readonly b: string
  readonly facts: ClusterTraceFacts
  readonly judgments: RemedyJudgments
  readonly decision: RemedyDecision
}

/** Apply the published thresholds to the three answers. Code decides. */
export const remedyDecisionOf = (judgments: RemedyJudgments): RemedyDecision => {
  const thresholds = {
    sameRemedy: policy.decision.remedy.sameRemedy,
    material: policy.decision.remedy.material,
    subcase: policy.decision.remedy.subcase,
  }
  const percent = (value: number | undefined): string =>
    value === undefined ? "unanswered" : value.toFixed(2)
  if (judgments.remedy !== undefined && judgments.remedy > thresholds.sameRemedy) {
    if (judgments.material !== undefined && judgments.material < thresholds.material) {
      return {
        branch: "same",
        reason:
          "j_remedy " +
          percent(judgments.remedy) +
          " > " +
          String(thresholds.sameRemedy) +
          " and j_material " +
          percent(judgments.material) +
          " < " +
          String(thresholds.material),
        thresholds,
      }
    }
    // Only a pair whose repairs already match can be a subcase: the subcase
    // question is asked after `j_remedy`, and it refines a material trigger
    // difference rather than competing with the merge question.
    if (judgments.subcase !== undefined && judgments.subcase > thresholds.subcase) {
      return {
        branch: "subcase",
        reason:
          "j_remedy " +
          percent(judgments.remedy) +
          " > " +
          String(thresholds.sameRemedy) +
          " but j_material " +
          percent(judgments.material) +
          " >= " +
          String(thresholds.material) +
          ", and j_subcase " +
          percent(judgments.subcase) +
          " > " +
          String(thresholds.subcase),
        thresholds,
      }
    }
    return {
      branch: "independent",
      reason:
        "j_remedy " +
        percent(judgments.remedy) +
        " > " +
        String(thresholds.sameRemedy) +
        " but j_material " +
        percent(judgments.material) +
        " >= " +
        String(thresholds.material) +
        "; the trigger difference changes the repair",
      thresholds,
    }
  }
  return {
    branch: "independent",
    reason:
      "j_remedy " +
      percent(judgments.remedy) +
      " <= " +
      String(thresholds.sameRemedy) +
      "; the messages do not prescribe one repair",
    thresholds,
  }
}

/**
 * Recompute a trace's branch with no model call.
 *
 * This is deliberately a function over the emitted JSON, not a closure over the
 * run: the acceptance is that a reader with the file and the published
 * thresholds gets the same branch the run printed.
 *
 * @param trace - the emitted trace, decoded from JSON.
 * @returns the branch the thresholds choose.
 */
export const recomputeTraceDecision = (trace: {
  readonly judgments: RemedyJudgments
  readonly decision: RemedyDecision
}): RemedyDecision["branch"] => {
  const judgments = trace.judgments
  const thresholds = trace.decision.thresholds
  if (judgments.remedy !== undefined && judgments.remedy > thresholds.sameRemedy) {
    if (judgments.material !== undefined && judgments.material < thresholds.material) return "same"
    return judgments.subcase !== undefined && judgments.subcase > thresholds.subcase
      ? "subcase"
      : "independent"
  }
  return "independent"
}

/**
 * The unordered key for a pair of message keys.
 *
 * `j_same` is symmetric, so the pair must have one key whichever side a caller
 * passes first.
 *
 * @param pair.left - the first message key.
 * @param pair.right - the second message key.
 * @returns the two keys in locale order, joined by a NUL.
 */
export const pairKeyOf = ({
  left,
  right,
}: {
  readonly left: string
  readonly right: string
}): string => (left.localeCompare(right) <= 0 ? left + "\u0000" + right : right + "\u0000" + left)

/**
 * The families a prescribed repair can belong to, one question over seven.
 *
 * This exists because the option list it replaces held every witness clause in
 * the corpus: 55 candidates in one Choice, asked 150 times in one run. A Choice
 * over more than eight options is a decision wearing a question's clothes
 * (`docs/jev.md` rule 4), and the measured consequence was 83 findings labelled
 * with a non-answer. The family is the first snap judgement; the clause, asked
 * only among the clauses of the family that answer named, is the second.
 *
 * The first six were derived from the measured witness clauses, not read off
 * every message. That is why the experimental-API repair was missed: its message
 * has no imperative sentence, so it never appeared as a family candidate and the
 * clause question named the API instead. `use the stable API` is read off the
 * message, which is the rule the corpus derivation cannot supply.
 */
export const remedyFamilies = {
  "parse at the boundary":
    "Turn untyped input into a domain value where it enters: parse, decode or validate at the I/O edge, then branch on the parsed value.",
  "narrow with a predicate":
    "Prove the runtime shape before using it: a discriminant, an `in` check, a Schema refinement or a type predicate, instead of a cast.",
  "own the value type":
    "Give the value a named owner type derived from its schema or domain, so a caller cannot pass or receive an anonymous shape.",
  "justify the assertion":
    "Keep the assertion but state the invariant it relies on, immediately before it, so the next reader can check the claim.",
  "inject the dependency":
    "Take the collaborator as a parameter or thread it through the signature, so it is explicit and replaceable instead of captured.",
  "use the stable API":
    "Use the stable, non-experimental, non-deprecated API: replace the unstable surface with its supported equivalent.",
  other: "None of these: the repair is something else. The next question names it.",
} as const

/**
 * The remedy identity: the family the first answer named, then the clause.
 *
 * Composed in code rather than picked as one long label, so the pair reads as a
 * sentence ("narrow with a predicate: Narrow with discriminants/in checks…")
 * and neither question carries more than `maxChoiceOptions` candidates.
 */
export const composeRemedy = ({
  family,
  clause,
}: {
  readonly family: string
  readonly clause: string
}): string => {
  const clauseLabel = repairLabel(clause)
  if (Result.isFailure(clauseLabel)) {
    throw new BuildFailure({
      family,
      subject: JSON.stringify(clause),
      message:
        "remedies: refusing to use " +
        JSON.stringify(clause) +
        " as a repair; it " +
        clauseLabel.failure,
    })
  }
  const composed = family === "" ? clauseLabel.success : family + ": " + clauseLabel.success
  const label = repairLabel(composed)
  if (Result.isFailure(label)) {
    throw new BuildFailure({
      family,
      subject: JSON.stringify(composed),
      message:
        "remedies: refusing to label a cluster " +
        JSON.stringify(composed) +
        "; it " +
        label.failure,
    })
  }
  return label.success
}

/** How a message's clause list is resolved: asked, implied, or a bug. */
export type ClauseRoute =
  | {
      readonly kind: "implied"
      readonly family: string
      readonly clause: string
    }
  | {
      readonly kind: "asked"
      readonly family: string
      readonly candidates: ReadonlyArray<string>
    }
  | {
      readonly kind: "orphan"
      readonly family: string
      readonly message: string
    }

/**
 * Decide whether a clause list is a question, an answer, or an empty bug.
 *
 * One candidate is not a Choice: the provider refuses it, and it is right to.
 * The family already determined the answer, so code composes it and records
 * that it was implied rather than judged. Zero candidates means the family
 * assignment is inconsistent with the clause assignment, which is a bug in the
 * build of the questions -- never an empty question sent to the model.
 */
export const clauseRouteOf = ({
  family,
  message,
  candidates,
}: {
  readonly family: string
  readonly message: string
  readonly candidates: ReadonlyArray<string>
}): ClauseRoute => {
  if (candidates.length === 0) return { kind: "orphan", family, message }
  const clause = candidates[0]
  if (candidates.length === 1 && clause !== undefined) {
    return { kind: "implied", family, clause }
  }
  return { kind: "asked", family, candidates }
}

/**
 * Split items into at most `limit` contiguous groups, each smaller than the
 * input, so a bounded Choice can select a range before the next question names
 * the item inside it.
 *
 * The number of groups is capped at `limit`; each group is `ceil(n / limit)`
 * long, which may itself exceed the limit for a very long list -- the caller
 * applies this again to the chosen group, so every question stays bounded.
 */
export const partitionsOf = <A>(
  items: ReadonlyArray<A>,
  limit: number,
): ReadonlyArray<ReadonlyArray<A>> => {
  if (items.length <= limit) return [items]
  const width = Math.ceil(items.length / limit)
  const groups: Array<ReadonlyArray<A>> = []
  for (let start = 0; start < items.length; start += width) {
    groups.push(items.slice(start, start + width))
  }
  return groups
}

interface ClauseGroup {
  readonly clause: string
  readonly messages: ReadonlyArray<MessageNode>
}

const groupsOf = (messages: ReadonlyArray<MessageNode>): ReadonlyArray<ClauseGroup> => {
  const byClause = new Map<string, Array<MessageNode>>()
  for (const message of messages) {
    const list = byClause.get(message.clause)
    if (list === undefined) byClause.set(message.clause, [message])
    else list.push(message)
  }
  return [...byClause.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([clause, list]) => ({ clause, messages: list }))
}

/**
 * Answer plans in chunks, resiliently, and return one read value per plan.
 *
 * The remedies run asks three kinds of question -- repair family, repair clause,
 * pairwise sameness -- and the clause options depend on the family answer, so
 * they cannot share a request with it. Rounding here rather than in the rule
 * keeps every round batched and every question cached on its own state.
 */
const askPlans = <A>(
  plans: ReadonlyArray<Plan<A>>,
): Effect.Effect<
  {
    readonly values: ReadonlyArray<A | undefined>
    readonly failures: ReadonlyArray<AiError.AiError>
  },
  never,
  Atoms | PlanAnswers | DecisionModel.DecisionModel
> =>
  Effect.gen(function* () {
    const values: Array<A | undefined> = plans.map(() => undefined)
    const failures: Array<AiError.AiError> = []
    let offset = 0
    for (const chunk of yield* chunkPlans(plans, policy.decision.maxRequestChars)) {
      // A batch the provider rejects for size is halved and retried; a lone
      // oversized question comes back as a failure rather than a witness
      // fallback. The per-question cache means a split re-asks only what was
      // not already answered.
      const settled = yield* answerPlansResilient({
        plans: chunk.plans,
        answer: answerPlansRaw,
      })
      settled.answers.forEach((record, index) => {
        // `answerPlansResilient` preserves the chunk's plan order, and the chunk
        // came from the run's list, so the running offset is the plan's index.
        if (record !== undefined) values[offset + index] = chunk.plans[index]?.read(record)
      })
      for (const failure of settled.failures) failures.push(failure.error)
      offset += chunk.plans.length
    }
    return { values, failures }
  })

/**
 * Ask the questions rung 1 needs, batched and cached.
 *
 * A repair is named by two bounded questions composed in code: `j_family` names
 * the kind of repair (one of six), and `j_clause` picks the wording among the
 * clauses code assigned to that family -- never the whole 55-candidate corpus in
 * one Choice. `j_same` compares one representative of each pair of witness
 * groups, which is the only pair that can change the clustering: two messages
 * with the same witness are already one node, and two with different witnesses
 * are where a judgement can find a repair the regex cannot.
 */
export const judgeRemedies = (
  findings: ReadonlyArray<RemedyFinding>,
): Effect.Effect<RepairOpinion, never, Atoms | PlanAnswers | DecisionModel.DecisionModel> =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    const messages = messageNodesOf(findings)
    const groups = groupsOf(messages)
    const derived = messages.flatMap((message) => impliedRepairsOf(message.clause))
    const rejectedClauses = messages
      .filter((message) => !isImperativeClause(message.clause))
      .map((message) => ({ message: message.message, clause: message.clause }))
    // No `none` option: a message that fits no family answers `other`, and the
    // clause question then names the repair inside it. A non-answer is not a
    // candidate repair, and offering it made 83 findings label themselves `none`.
    // A subject is not a candidate either: the clause must be an imperative.
    const repairClause = (clause: string): boolean =>
      isImperativeClause(clause) && Result.isSuccess(repairLabel(clause))
    const clauses = [
      ...new Set([
        ...groups.map((group) => group.clause).filter(repairClause),
        ...derived.filter(repairClause),
      ]),
    ].sort((left, right) => left.localeCompare(right))
    const limit = policy.decision.maxChoiceOptions
    const failures: Array<AiError.AiError> = []

    const familyOfAnswer = (value: string | undefined): string =>
      Predicate.isString(value) && value in remedyFamilies ? value : "other"

    // ROUND ONE: which family of repair? Asked of every message, and of every
    // candidate clause, so the next round can restrict itself to the clauses
    // belonging to the family the message named.
    const familyPlans: Array<Plan<string>> = []
    const familySubjects: Array<{ readonly kind: "message" | "clause"; readonly key: string }> = []
    for (const message of messages) {
      const atom = yield* atoms.add({
        finding: { message: message.message, help: message.help ?? "" },
      })
      familyPlans.push({
        ruleId: "joggle/remedies",
        subject: message.key,
        concerns: [],
        atoms: [atom],
        decisions: {
          family: Decision.classify({
            instructions: [
              "Which family of repair does `atoms[" +
                atom +
                "].finding.message` prescribe, given `atoms[" +
                atom +
                "].finding.help`?",
              "Answer about what the message tells a reader to DO, not which rule produced it.",
              "Choose `other` when no family fits; the next question then names the repair.",
            ].join("\n"),
            criteria: remedyFamilies,
          }),
        },
        read: (answers) => {
          const answer = answers["family"]
          return answer !== undefined && "label" in answer ? answer.label : undefined
        },
      })
      familySubjects.push({ kind: "message", key: message.key })
    }
    for (const clause of clauses) {
      const atom = yield* atoms.add({ clause: { text: clause } })
      familyPlans.push({
        ruleId: "joggle/remedies",
        subject: clause,
        concerns: [],
        atoms: [atom],
        decisions: {
          family: Decision.classify({
            instructions: [
              "Which family of repair is `atoms[" + atom + "].clause.text`?",
              "The text is a candidate repair clause code derived from this corpus, not a finding.",
              "Classify what it tells a reader to DO.",
              "Choose `other` when no family fits.",
            ].join("\n"),
            criteria: remedyFamilies,
          }),
        },
        read: (answers) => {
          const answer = answers["family"]
          return answer !== undefined && "label" in answer ? answer.label : undefined
        },
      })
      familySubjects.push({ kind: "clause", key: clause })
    }

    const familyAnswers = yield* askPlans(familyPlans)
    failures.push(...familyAnswers.failures)
    const familyByMessage = new Map<string, string>()
    const familyByClause = new Map<string, string>()
    familySubjects.forEach((subject, index) => {
      const family = familyOfAnswer(familyAnswers.values[index])
      if (subject.kind === "message") familyByMessage.set(subject.key, family)
      else familyByClause.set(subject.key, family)
    })
    // A diagnosis-only message already had its family decided in code when the
    // repair was derived; asking the family question as well let the model answer
    // `other` and the clause question then named the API. The derived repair is
    // the one case where the family is not a judgment.
    for (const message of messages) {
      if (impliedRepairsOf(message.clause).length > 0) {
        familyByMessage.set(message.key, "use the stable API")
      }
    }
    for (const clause of derived) familyByClause.set(clause, "use the stable API")

    // ROUND TWO..N: which clause? A family with more clauses than one Choice may
    // hold is itself split into bounded groups, and the chosen group is asked
    // again -- so no question in this run exceeds `maxChoiceOptions`, and no
    // clause is dropped to make the count fit.
    const clauseByMessage = new Map<string, string>()
    const impliedByMessage = new Set<string>()
    interface PendingClause {
      readonly message: MessageNode
      readonly family: string
      readonly candidates: ReadonlyArray<string>
    }
    // Rebound each round: the loop replaces the queue with the clauses the family
    // answer narrowed to, rather than mutating one list in place.
    let pending: Array<PendingClause> = []
    for (const message of messages) {
      const family = familyByMessage.get(message.key) ?? "other"
      const candidates = clauses.filter(
        (clause) => (familyByClause.get(clause) ?? "other") === family,
      )
      const route = clauseRouteOf({ family, message: message.message, candidates })
      if (route.kind === "orphan") {
        return yield* Effect.die(
          new BuildFailure({
            family: route.family,
            subject: route.message,
            message:
              "remedies: repair family `" +
              route.family +
              "` has no clause assigned for " +
              JSON.stringify(route.message) +
              "; refusing to send an empty Choice",
          }),
        )
      }
      if (route.kind === "implied") {
        clauseByMessage.set(
          message.key,
          composeRemedy({ family: route.family, clause: route.clause }),
        )
        impliedByMessage.add(message.key)
        continue
      }
      pending.push({ message, family, candidates: route.candidates })
    }
    let depth = 0
    while (pending.length > 0 && depth < 8) {
      const plans: Array<Plan<string>> = []
      const actions: Array<(value: string | undefined) => void> = []
      const next: Array<PendingClause> = []
      for (const item of pending) {
        const finding = { message: item.message.message, help: item.message.help ?? "" }
        const route = clauseRouteOf({
          family: item.family,
          message: item.message.message,
          candidates: item.candidates,
        })
        if (route.kind === "orphan") {
          return yield* Effect.die(
            new BuildFailure({
              family: route.family,
              subject: route.message,
              message:
                "remedies: repair family `" +
                route.family +
                "` has no clause assigned for " +
                JSON.stringify(route.message) +
                "; refusing to send an empty Choice",
            }),
          )
        }
        if (route.kind === "implied") {
          clauseByMessage.set(
            item.message.key,
            composeRemedy({ family: route.family, clause: route.clause }),
          )
          impliedByMessage.add(item.message.key)
          continue
        }
        if (route.candidates.length <= limit) {
          const atom = yield* atoms.add({ finding, candidates: item.candidates })
          plans.push({
            ruleId: "joggle/remedies",
            subject: item.message.key,
            concerns: [],
            atoms: [atom],
            decisions: {
              clause: Decision.classify({
                instructions: [
                  "Which candidate repair does `atoms[" +
                    atom +
                    "].finding.message` prescribe, given `atoms[" +
                    atom +
                    "].finding.help`?",
                  "The candidates are `atoms[" +
                    atom +
                    "].candidates`, all in the repair family `" +
                    item.family +
                    "`.",
                  "Answer about what the message tells a reader to DO, not which rule produced it.",
                ].join("\n"),
                criteria: Object.fromEntries(
                  item.candidates.map((clause) => [
                    clause,
                    "The message tells the reader to: " + clause,
                  ]),
                ),
              }),
            },
            read: (answers) => {
              const answer = answers["clause"]
              return answer !== undefined && "label" in answer ? answer.label : undefined
            },
          })
          actions.push((value) => {
            if (!Predicate.isString(value) || value === "") return
            clauseByMessage.set(
              item.message.key,
              composeRemedy({ family: item.family, clause: value }),
            )
          })
          continue
        }
        const ranges = partitionsOf(item.candidates, limit)
        const labels = ranges.map((_range, index) => "group " + String(index + 1))
        const atom = yield* atoms.add({ finding, groups: ranges })
        plans.push({
          ruleId: "joggle/remedies",
          subject: item.message.key,
          concerns: [],
          atoms: [atom],
          decisions: {
            group: Decision.classify({
              instructions: [
                "Which group of candidate repairs contains the repair `atoms[" +
                  atom +
                  "].finding.message` prescribes?",
                "The groups are `atoms[" + atom + "].groups`; each lists the repairs it holds.",
                "Answer about what the message tells a reader to DO.",
              ].join("\n"),
              criteria: Object.fromEntries(
                ranges.map((range, index) => [
                  labels[index] ?? "group",
                  "One of these repairs: " + range.join(" | "),
                ]),
              ),
            }),
          },
          read: (answers) => {
            const answer = answers["group"]
            return answer !== undefined && "label" in answer ? answer.label : undefined
          },
        })
        actions.push((value) => {
          if (!Predicate.isString(value)) return
          const range = ranges[labels.indexOf(value)]
          if (range !== undefined) next.push({ ...item, candidates: range })
        })
      }
      const answered = yield* askPlans(plans)
      failures.push(...answered.failures)
      answered.values.forEach((value, index) => actions[index]?.(value))
      pending = next
      depth += 1
    }

    const probabilityOf = (
      answers: Readonly<Record<string, Decision.Answer<Decision.Any>>>,
      name: string,
    ): number | undefined => {
      const answer = answers[name]
      return answer !== undefined && "probability" in answer ? answer.probability : undefined
    }

    interface PairQuestion {
      readonly key: string
      readonly atom: string
      readonly aRef: string
      readonly bRef: string
    }

    const pairs: Array<PairQuestion> = []
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        const a = groups[left]?.messages[0]
        const b = groups[right]?.messages[0]
        if (a === undefined || b === undefined) continue
        const key = pairKeyOf({ left: a.key, right: b.key })
        const aRule = a.findings[0]?.rule ?? "unknown"
        const bRule = b.findings[0]?.rule ?? "unknown"
        const state = {
          a: {
            message: a.message,
            rule: aRule,
            trigger: diagnosisOf(a.message),
          },
          b: {
            message: b.message,
            rule: bRule,
            trigger: diagnosisOf(b.message),
          },
        }
        const atom = yield* atoms.add(state)
        pairs.push({
          key,
          atom,
          aRef: "atoms[" + atom + "].a",
          bRef: "atoms[" + atom + "].b",
        })
      }
    }

    // RUNG 3'S GATE: ask the merge question of every pair, then ask materiality
    // only of a pair whose merge question said same, and a subcase only of a
    // pair materiality says changes the repair. The measured regression was
    // 17,364 questions because every pair got all three; disjoint sites are the
    // normal case for two rules, so `suspect` gating settled nothing.
    const remedyPlans: Array<Plan<number | undefined>> = pairs.map((pair) => ({
      ruleId: "joggle/remedies",
      subject: pair.key,
      concerns: [],
      atoms: [pair.atom],
      decisions: {
        j_remedy: Decision.probability({
          instructions: [
            "Do `" +
              pair.aRef +
              ".message` and `" +
              pair.bRef +
              ".message` prescribe the same" +
              " repair, given `" +
              pair.aRef +
              ".rule` and `" +
              pair.bRef +
              ".rule`?",
            "Answer about the action the reader must take, not the words the two rules use.",
            "Answer true when fixing either finding would be the same edit, or the same" +
              " kind of edit at the same boundary.",
          ].join("\n"),
          criteria: {
            false: "They prescribe different repairs.",
            true: "They prescribe the same repair.",
          },
        }),
      },
      read: (answers) => probabilityOf(answers, "j_remedy"),
    }))
    const remedyAnswers = yield* askPlans(remedyPlans)
    failures.push(...remedyAnswers.failures)
    const remedyByKey = new Map<string, number>()
    pairs.forEach((pair, index) => {
      const remedy = remedyAnswers.values[index]
      if (remedy !== undefined) remedyByKey.set(pair.key, remedy)
    })
    const startGate = refinementGateOf({ pairs, remedy: remedyByKey, material: new Map() })
    const materialKeys = new Set(startGate.material)
    const materialPairs = pairs.filter((pair) => materialKeys.has(pair.key))
    const materialPlans: Array<Plan<number | undefined>> = materialPairs.map((pair) => ({
      ruleId: "joggle/remedies",
      subject: pair.key,
      concerns: [],
      atoms: [pair.atom],
      decisions: {
        j_material: Decision.probability({
          instructions: [
            "Does the difference between `" +
              pair.aRef +
              ".trigger` and `" +
              pair.bRef +
              ".trigger` change the repair a reader" +
              " must make?",
            "The triggers are the diagnoses each rule saw, not the repairs.",
            "Answer true when a fix that satisfies one trigger does not satisfy the other",
            "because the conditions they detect are genuinely different.",
          ].join("\n"),
          criteria: {
            false: "The trigger difference does not change the repair.",
            true: "The trigger difference changes the repair.",
          },
        }),
      },
      read: (answers) => probabilityOf(answers, "j_material"),
    }))
    const materialAnswers = yield* askPlans(materialPlans)
    failures.push(...materialAnswers.failures)
    const materialByKey = new Map<string, number>()
    materialPairs.forEach((pair, index) => {
      const material = materialAnswers.values[index]
      if (material !== undefined) materialByKey.set(pair.key, material)
    })

    // A subcase can only refine a material difference. Asking it before
    // `j_remedy` said same, or before `j_material` said the difference matters,
    // was the other half of the measured over-asking.
    const gate = refinementGateOf({ pairs, remedy: remedyByKey, material: materialByKey })
    const subcaseKeys = new Set(gate.subcase)
    const subcasePairs = pairs.filter((pair) => subcaseKeys.has(pair.key))
    const subcasePlans: Array<Plan<number | undefined>> = subcasePairs.map((pair) => ({
      ruleId: "joggle/remedies",
      subject: pair.key,
      concerns: [],
      atoms: [pair.atom],
      decisions: {
        j_subcase: Decision.probability({
          instructions: [
            "Is `" + pair.bRef + ".trigger` a strict subset of `" + pair.aRef + ".trigger`?",
            "Strict means every case `" +
              pair.bRef +
              ".trigger` describes is also described by `" +
              pair.aRef +
              ".trigger`, and `" +
              pair.aRef +
              ".trigger` describes at least one more.",
          ].join("\n"),
          criteria: {
            false: "It is not a strict subset.",
            true: "It is a strict subset.",
          },
        }),
      },
      read: (answers) => probabilityOf(answers, "j_subcase"),
    }))
    const subcaseAnswers = yield* askPlans(subcasePlans)
    failures.push(...subcaseAnswers.failures)
    const subcaseByKey = new Map<string, number>()
    subcasePairs.forEach((pair, index) => {
      const subcase = subcaseAnswers.values[index]
      if (subcase !== undefined) subcaseByKey.set(pair.key, subcase)
    })

    const repairMap = new Map(clauseByMessage)
    const sameMap = new Map(remedyByKey)
    const materialMap = new Map(materialByKey)
    const subcaseMap = new Map(subcaseByKey)
    const counts = {
      remedy: remedyByKey.size,
      material: materialByKey.size,
      subcase: subcaseByKey.size,
      decidedByCode: gate.decidedByCode,
    }
    const failureText = failures.map(String)
    // Witness-only means the model was never reached. A size rejection is a
    // judgement that ran and failed, so it stays PARTIAL with a named reason.
    const answered = repairMap.size + sameMap.size
    const unavailable = answered === 0 && failures.some(isUnreachable) ? failureText[0] : undefined
    return {
      repairs: repairMap,
      families: familyByMessage,
      implied: impliedByMessage,
      same: sameMap,
      material: materialMap,
      subcase: subcaseMap,
      unavailable,
      failures: failureText,
      questions: messages.length,
      pairs: pairs.length,
      counts,
      rejectedClauses,
    }
  })

export interface RuleSites {
  readonly rule: string
  readonly findings: number
  readonly sites: ReadonlyArray<string>
}

export interface Counterexample {
  readonly a: string
  readonly b: string
  /** Sites `a` reaches that `b` cannot. */
  readonly onlyA: ReadonlyArray<string>
  /** Sites `b` reaches that `a` cannot. */
  readonly onlyB: ReadonlyArray<string>
  readonly both: ReadonlyArray<string>
  /** The computed fact that explains the difference, never a judgement. */
  readonly reason: string
}

export interface RemedyCluster {
  readonly remedy: string
  readonly remedyHash: string
  readonly sites: number
  readonly findings: number
  readonly rules: ReadonlyArray<RuleSites>
  readonly files: ReadonlyArray<{ readonly file: string; readonly sites: number }>
  readonly counterexamples: ReadonlyArray<Counterexample>
  /** One row per rule pair in a multi-rule cluster: what held it together. */
  readonly crossRules: ReadonlyArray<ClusterRuleMerge>
  readonly members: ReadonlyArray<RemedyFinding>
}

/**
 * The facts behind one cross-rule merge, printed so a wrong merge is visible.
 *
 * A cluster holding more than one rule is the judgement's strongest claim, and
 * the claim is only as good as the evidence for it: the probability the pair
 * question gave, whether the two rules even share a site, and whether they
 * landed on the same composed repair. A merge with disjoint sites and no shared
 * repair is a judgement that answered the family, not the repair.
 */
export interface ClusterRuleMerge {
  readonly a: { readonly rule: string; readonly sites: number }
  readonly b: { readonly rule: string; readonly sites: number }
  /** Whether any site carries both rules, computed from the site sets. */
  readonly intersect: boolean
  /** The highest `j_remedy` over a message pair from the two rules, if asked. */
  readonly probability: number | undefined
  /** `j_material` for that same best pair, if asked. */
  readonly material: number | undefined
  /** `j_subcase` for that same best pair, if asked. */
  readonly subcase: number | undefined
  /** The code decision those probabilities produced. */
  readonly decision: RemedyDecision["branch"]
  /** Whether both rules have a message composed onto one repair label. */
  readonly sharedRepair: boolean
  /** The family each side's messages answered, when they all agree. */
  readonly families: { readonly a: string | undefined; readonly b: string | undefined }
}

export interface ClusterSummary {
  readonly clusters: number
  readonly largestSites: number
  readonly largestRules: number
}

/**
 * How much of the judgement the run actually got.
 *
 * `witness-only` is reserved for "the model was never reached"; a run where a
 * request failed after halving is `partial`, because the judgement did run and
 * its answered pairs are in the clusters. The old report called both
 * witness-only, which hid 122 answered pairs behind a missing key's label.
 */
export type JudgementStatus = "complete" | "partial" | "witness-only"

export interface RemedyReport {
  readonly findings: number
  readonly distinctMessages: number
  readonly pairsAsked: number
  /** The gated question counts: what was asked, and what code settled. */
  readonly counts: RemedyQuestionCounts
  /** Pairs the judgement answered, out of `pairsAsked`. */
  readonly answeredPairs: number
  /** Distinct messages the judgement answered, out of `distinctMessages`. */
  readonly answeredRepairs: number
  /** Of those, the repairs the family implied rather than asked. */
  readonly impliedRepairs: number
  readonly judgementStatus: JudgementStatus
  readonly judgementUnavailable: string | undefined
  /** Requests that still failed after halving, named so the gap is visible. */
  readonly judgementFailures: ReadonlyArray<string>
  /** Messages whose clause was a subject and was not offered as a repair. */
  readonly rejectedClauses: ReadonlyArray<{
    readonly message: string
    readonly clause: string
  }>
  readonly witness: ClusterSummary
  readonly judgement: ClusterSummary
  readonly disagreements: ReadonlyArray<{
    readonly a: string
    readonly b: string
    readonly probability: number
  }>
  /** One facts/judgments/decision trace per cross-rule cluster pair. */
  readonly traces: ReadonlyArray<ClusterTrace>
  readonly clusters: ReadonlyArray<RemedyCluster>
}

type Mode = "witness" | "judgement" | "union"

const sameRepair = ({
  opinion,
  left,
  right,
  crossRule = false,
}: {
  readonly opinion: RepairOpinion
  readonly left: string
  readonly right: string
  /** Whether the two messages come from different rules. */
  readonly crossRule?: boolean | undefined
}): boolean => {
  const key = pairKeyOf({ left, right })
  const remedy = opinion.same.get(key)
  // A cross-rule merge is the judgement's strongest claim, so the merge question
  // must support it. A composed label can still normalize the messages of one
  // rule -- the 83 experimental-API sites share a derived repair whose wordings
  // the pair question reasonably calls different -- but it may not widen one
  // rule's answer to another. This is the measured 88-site defect: the
  // stable-API label absorbed five nullish-default findings that j_remedy split.
  if (crossRule && remedy !== undefined) {
    const decision = remedyDecisionOf({
      remedy,
      material: opinion.material?.get(key),
      subcase: opinion.subcase?.get(key),
    })
    return decision.branch === "same"
  }
  // Within one rule the Choice is the normaliser: two messages the model put on
  // one candidate clause prescribe one repair, whatever their wording.
  const leftRepair = opinion.repairs.get(left)
  const rightRepair = opinion.repairs.get(right)
  if (leftRepair !== undefined && leftRepair === rightRepair && leftRepair !== "none") {
    return true
  }
  const decision = remedyDecisionOf({
    remedy,
    material: opinion.material?.get(key),
    subcase: opinion.subcase?.get(key),
  })
  return decision.branch === "same"
}

interface DisjointSet {
  readonly find: (index: number) => number
  readonly union: (left: number, right: number) => void
}

const disjointSetOf = (size: number): DisjointSet => {
  const parent = Array.from({ length: size }, (_, index) => index)
  const find = (index: number): number => {
    const current = parent[index] ?? index
    if (current === index) return index
    const root = find(current)
    parent[index] = root
    return root
  }
  return {
    find,
    union: (left, right) => {
      const a = find(left)
      const b = find(right)
      if (a !== b) parent[b] = a
    },
  }
}

const rulesOf = (findings: ReadonlyArray<RemedyFinding>): ReadonlyArray<RuleSites> => {
  const byRule = new Map<string, { findings: number; sites: Set<string> }>()
  for (const finding of findings) {
    const entry = byRule.get(finding.rule)
    if (entry === undefined) {
      byRule.set(finding.rule, { findings: 1, sites: new Set([finding.site]) })
    } else {
      entry.findings += 1
      entry.sites.add(finding.site)
    }
  }
  return [...byRule.entries()]
    .map(([rule, entry]) => ({
      rule,
      findings: entry.findings,
      sites: [...entry.sites].sort((left, right) => left.localeCompare(right)),
    }))
    .sort((left, right) => right.findings - left.findings || left.rule.localeCompare(right.rule))
}

const counterexamplesOf = (
  findings: ReadonlyArray<RemedyFinding>,
): ReadonlyArray<Counterexample> => {
  const rules = rulesOf(findings)
  const out: Array<Counterexample> = []
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      const a = rules[left]
      const b = rules[right]
      if (a === undefined || b === undefined) continue
      const aSites = new Set(a.sites)
      const bSites = new Set(b.sites)
      const onlyA = a.sites.filter((site) => !bSites.has(site))
      const onlyB = b.sites.filter((site) => !aSites.has(site))
      const both = a.sites.filter((site) => bSites.has(site))
      const sampleA = findings.find(
        (finding) => finding.rule === a.rule && onlyA.includes(finding.site),
      )
      const sampleB = findings.find(
        (finding) => finding.rule === b.rule && onlyB.includes(finding.site),
      )
      const reason =
        onlyA.length === 0 && onlyB.length === 0
          ? "Every site carries both rules, so neither reaches a site the other cannot."
          : "The triggers are not the same predicate. `" +
            a.rule +
            "` reaches " +
            String(onlyA.length) +
            " site(s) `" +
            b.rule +
            "` does not" +
            (sampleA === undefined
              ? ""
              : ", where the finding is " + JSON.stringify(diagnosisOf(sampleA.message))) +
            "; `" +
            b.rule +
            "` reaches " +
            String(onlyB.length) +
            " site(s) `" +
            a.rule +
            "` does not" +
            (sampleB === undefined
              ? ""
              : ", where the finding is " + JSON.stringify(diagnosisOf(sampleB.message))) +
            ". No finding from the other rule is recorded at those sites, so the other rule's" +
            " trigger is absent there."
      out.push({ a: a.rule, b: b.rule, onlyA, onlyB, both, reason })
    }
  }
  return out
}

const clustersOf = (
  findings: ReadonlyArray<RemedyFinding>,
  opinion: RepairOpinion,
  mode: Mode,
): ReadonlyArray<RemedyCluster> => {
  const messages = messageNodesOf(findings)
  const groups = groupsOf(messages)
  const groupIndex = new Map<string, number>()
  groups.forEach((group, index) => groupIndex.set(group.clause, index))
  const sets = disjointSetOf(groups.length)

  if (mode !== "witness") {
    for (let left = 0; left < groups.length; left += 1) {
      for (let right = left + 1; right < groups.length; right += 1) {
        const a = groups[left]?.messages[0]
        const b = groups[right]?.messages[0]
        if (a === undefined || b === undefined) continue
        const aRule = a.findings[0]?.rule ?? "unknown"
        const bRule = b.findings[0]?.rule ?? "unknown"
        if (sameRepair({ opinion, left: a.key, right: b.key, crossRule: aRule !== bRule })) {
          sets.union(left, right)
        }
      }
    }
  }
  const byRoot = new Map<number, Array<RemedyFinding>>()
  for (const finding of findings) {
    const clause = witnessClause(finding.message)
    const index = groupIndex.get(clause)
    if (index === undefined) continue
    const root = sets.find(index)
    const list = byRoot.get(root)
    if (list === undefined) byRoot.set(root, [finding])
    else list.push(finding)
  }

  const clusters: Array<RemedyCluster> = []
  for (const members of byRoot.values()) {
    const repairCounts = new Map<string, number>()
    for (const member of members) {
      // `none` is a judgement's way of saying "no candidate applies", not the
      // name of a repair. Falling back to the witness clause keeps the cluster
      // labelled with the best code-derived repair instead of hiding its
      // findings behind a non-answer.
      const answer = opinion.repairs.get(messageKeyOf(member))
      const label =
        answer === undefined || answer === "none" ? witnessClause(member.message) : answer
      repairCounts.set(label, (repairCounts.get(label) ?? 0) + 1)
    }
    const remedy =
      [...repairCounts.entries()].sort(
        ([leftLabel, leftCount], [rightLabel, rightCount]) =>
          rightCount - leftCount || leftLabel.localeCompare(rightLabel),
      )[0]?.[0] ?? "none"
    const sites = [...new Set(members.map((member) => member.site))].sort((left, right) =>
      left.localeCompare(right),
    )
    const fileCounts = new Map<string, Set<string>>()
    for (const member of members) {
      const set = fileCounts.get(member.file)
      if (set === undefined) fileCounts.set(member.file, new Set([member.site]))
      else set.add(member.site)
    }
    clusters.push({
      remedy,
      remedyHash: shortHash(canonical({ remedy })),
      sites: sites.length,
      findings: members.length,
      rules: rulesOf(members),
      files: [...fileCounts.entries()]
        .map(([file, set]) => ({ file, sites: set.size }))
        .sort((left, right) => right.sites - left.sites || left.file.localeCompare(right.file)),
      counterexamples: counterexamplesOf(members),
      crossRules: crossRulesOf(members, opinion),
      members,
    })
  }
  return clusters.sort(
    (left, right) => right.sites - left.sites || left.remedy.localeCompare(right.remedy),
  )
}

/** The highest, then the first, family answer among one rule's messages. */
const familyOfRule = (
  members: ReadonlyArray<RemedyFinding>,
  rule: string,
  opinion: RepairOpinion,
): Result.Result<string, NoMatch> => {
  const counts = new Map<string, number>()
  for (const member of members) {
    if (member.rule !== rule) continue
    const family = opinion.families?.get(messageKeyOf(member))
    if (family === undefined) continue
    counts.set(family, (counts.get(family) ?? 0) + 1)
  }
  return lookup(
    () =>
      [...counts.entries()].sort(
        ([leftLabel, leftCount], [rightLabel, rightCount]) =>
          rightCount - leftCount || leftLabel.localeCompare(rightLabel),
      )[0]?.[0],
    "the family answer for every " + rule + " finding",
  )
}

/**
 * The best-answered pair between two rules: the highest `j_remedy`, with that
 * same pair's two companion answers.
 *
 * A cluster holding several messages per rule has several possible pairs. The
 * one that argues most strongly for a merge is the one to audit: if even that
 * pair is split by `j_material`, the merge has no evidence. Taking each
 * probability's own maximum would mix three different pairs and recompute a
 * decision no one answered.
 */
const judgmentsBetween = ({
  aMembers,
  bMembers,
  opinion,
}: {
  readonly aMembers: ReadonlyArray<RemedyFinding>
  readonly bMembers: ReadonlyArray<RemedyFinding>
  readonly opinion: RepairOpinion
}): RemedyJudgments => {
  let best: RemedyJudgments = { remedy: undefined, material: undefined, subcase: undefined }
  for (const leftMember of aMembers) {
    const leftKey = messageKeyOf(leftMember)
    for (const rightMember of bMembers) {
      const key = pairKeyOf({ left: leftKey, right: messageKeyOf(rightMember) })
      const remedy = opinion.same.get(key)
      if (remedy === undefined) continue
      if (best.remedy !== undefined && remedy <= best.remedy) continue
      best = {
        remedy,
        material: opinion.material?.get(key),
        subcase: opinion.subcase?.get(key),
      }
    }
  }
  return best
}

/** The first message's witness clause for one rule, for a trace's facts. */
const clauseOfRule = (members: ReadonlyArray<RemedyFinding>, rule: string): string | undefined =>
  members.find((member) => member.rule === rule)?.message

/**
 * Audit the merges a cluster made between rules, from facts only.
 *
 * The measured defect was a cross-rule cluster whose two rules reached disjoint
 * sites and answered different repairs; the judgement had agreed on the family
 * and the pairwise question then joined them anyway. Printing the probability,
 * the intersection and the families per rule pair makes that shape visible
 * without inspecting the ledger, and each row is computed, never asked.
 */
const crossRulesOf = (
  members: ReadonlyArray<RemedyFinding>,
  opinion: RepairOpinion,
): ReadonlyArray<ClusterRuleMerge> => {
  const rules = rulesOf(members)
  const out: Array<ClusterRuleMerge> = []
  for (let left = 0; left < rules.length; left += 1) {
    for (let right = left + 1; right < rules.length; right += 1) {
      const a = rules[left]
      const b = rules[right]
      if (a === undefined || b === undefined) continue
      const aSites = new Set(a.sites)
      const intersect = b.sites.some((site) => aSites.has(site))
      const aMembers = members.filter((member) => member.rule === a.rule)
      const bMembers = members.filter((member) => member.rule === b.rule)
      const judgments = judgmentsBetween({ aMembers, bMembers, opinion })
      const aRepairs = new Set(
        aMembers
          .map((member) => opinion.repairs.get(messageKeyOf(member)))
          .filter(Predicate.isString),
      )
      const sharedRepair = bMembers.some((member) => {
        const repair = opinion.repairs.get(messageKeyOf(member))
        return repair !== undefined && repair !== "none" && aRepairs.has(repair)
      })
      out.push({
        a: { rule: a.rule, sites: a.sites.length },
        b: { rule: b.rule, sites: b.sites.length },
        intersect,
        probability: judgments.remedy,
        material: judgments.material,
        subcase: judgments.subcase,
        decision: remedyDecisionOf(judgments).branch,
        sharedRepair,
        families: {
          a: Result.getOrUndefined(familyOfRule(members, a.rule, opinion)),
          b: Result.getOrUndefined(familyOfRule(members, b.rule, opinion)),
        },
      })
    }
  }
  return out
}

/**
 * Turn each cross-rule merge into a facts / judgments / decision trace.
 *
 * The facts are computed from the site sets and the family answers, the
 * judgments are the three probabilities the run recorded, and the decision is
 * code applying the published thresholds. Nothing here asks the model, and the
 * emitted JSON carries enough to recompute the branch offline.
 */
const tracesOf = (clusters: ReadonlyArray<RemedyCluster>): ReadonlyArray<ClusterTrace> =>
  clusters.flatMap((cluster) =>
    cluster.crossRules.map((merge) => {
      const judgments: RemedyJudgments = {
        remedy: merge.probability,
        material: merge.material,
        subcase: merge.subcase,
      }
      return {
        cluster: cluster.remedy,
        a: merge.a.rule,
        b: merge.b.rule,
        facts: {
          a: {
            rule: merge.a.rule,
            sites: merge.a.sites,
            family: merge.families.a,
            clause: clauseOfRule(cluster.members, merge.a.rule),
          },
          b: {
            rule: merge.b.rule,
            sites: merge.b.sites,
            family: merge.families.b,
            clause: clauseOfRule(cluster.members, merge.b.rule),
          },
          intersect: merge.intersect,
        },
        judgments,
        decision: remedyDecisionOf(judgments),
      }
    }),
  )

const summaryOf = (clusters: ReadonlyArray<RemedyCluster>): ClusterSummary => {
  const largest = clusters[0]
  return {
    clusters: clusters.length,
    largestSites: largest?.sites ?? 0,
    largestRules: largest?.rules.length ?? 0,
  }
}

/**
 * Turn findings into remedy clusters.
 *
 * The judgement can only add an edge the witness did not see; it cannot delete
 * one the witness found. That is deliberate for rung 1: the cost of missing a
 * shared repair is a reader fixing two places for one concept, while the cost of
 * an extra edge is visible in the counterexample pack, which lists exactly the
 * sites one rule reaches that the other cannot.
 */
export const clusterRemedies = (
  findings: ReadonlyArray<RemedyFinding>,
  opinion: RepairOpinion,
): RemedyReport => {
  const messages = messageNodesOf(findings)
  const judges = clustersOf(findings, opinion, "judgement")
  const witnesses = clustersOf(findings, { ...opinion, same: new Map() }, "witness")
  const clusters = clustersOf(findings, opinion, "union")
  const disagreements: Array<{ a: string; b: string; probability: number }> = []
  for (const [key, probability] of opinion.same) {
    if (probability < policy.decision.gates.probabilityFloor) continue
    const [left, right] = key.split("\u0000")
    if (left === undefined || right === undefined) continue
    const leftMessage = messages.find((message) => message.key === left)
    const rightMessage = messages.find((message) => message.key === right)
    if (leftMessage === undefined || rightMessage === undefined) continue
    if (leftMessage.clause === rightMessage.clause) continue
    // Report only a join the clustering actually made: a high pair score that a
    // family boundary overruled is not a disagreement between witness and
    // judgement, it is the boundary doing its job.
    if (!sameRepair({ opinion, left, right })) continue
    disagreements.push({ a: leftMessage.clause, b: rightMessage.clause, probability })
  }
  const answeredPairs = opinion.same.size
  const answeredRepairs = opinion.repairs.size
  const judgementStatus: JudgementStatus =
    opinion.unavailable !== undefined
      ? "witness-only"
      : answeredPairs < opinion.pairs || answeredRepairs < opinion.questions
        ? "partial"
        : "complete"
  return {
    findings: findings.length,
    distinctMessages: messages.length,
    pairsAsked: opinion.pairs,
    counts: opinion.counts ?? {
      remedy: opinion.same.size,
      material: opinion.material?.size ?? 0,
      subcase: opinion.subcase?.size ?? 0,
      decidedByCode: 0,
    },
    answeredPairs,
    answeredRepairs,
    impliedRepairs: opinion.implied?.size ?? 0,
    judgementStatus,
    judgementUnavailable: opinion.unavailable,
    judgementFailures: opinion.failures,
    rejectedClauses: opinion.rejectedClauses ?? [],
    witness: summaryOf(witnesses),
    judgement: summaryOf(judges),
    disagreements,
    traces: tracesOf(clusters),
    clusters,
  }
}

/** What one persisted run wrote: its hash and its row count. */
export interface RemedyLedger {
  readonly run: string
  readonly written: number
}

/** Persist one run's clusters as the new `finding` rows. */
export const rememberRemedyFindings = (root: string, report: RemedyReport): RemedyLedger => {
  const run = shortHash(
    canonical(
      report.clusters
        .flatMap((cluster) =>
          cluster.members.map((member) => ({
            site: member.site,
            rule: member.rule,
            remedy: cluster.remedyHash,
          })),
        )
        .sort((left, right) =>
          (left.site + "\u0000" + left.rule).localeCompare(right.site + "\u0000" + right.rule),
        ),
    ),
  )
  const rows: Array<Omit<StoredFinding, "run">> = report.clusters.flatMap((cluster) =>
    cluster.members.map((member) => ({
      site: member.site,
      rule: member.rule,
      remedyHash: cluster.remedyHash,
    })),
  )
  const store = createFactStore(root)
  const written = store.rememberFindings(run, rows)
  store.close()
  return { run, written }
}

/** Read the rows a previous run wrote, so the store is not write-only. */
export const storedRemedies = ({
  root,
  run,
}: {
  readonly root: string
  readonly run: string
}): ReadonlyArray<StoredFinding> => {
  const store = createFactStore(root)
  const rows = store.findingsOf(run)
  store.close()
  return rows
}

/** A short, stable name for an input file, for the report header. */
export const describeInput = (findings: ReadonlyArray<RemedyFinding>): string => {
  const rules = new Set(findings.map((finding) => finding.rule))
  return String(findings.length) + " finding(s), " + String(rules.size) + " rule(s)"
}

/** The judgement result when no model can be reached: witness-only, and said so. */
export const witnessOnlyOpinion = (
  findings: ReadonlyArray<RemedyFinding>,
  reason: string,
): RepairOpinion => ({
  repairs: new Map(),
  same: new Map(),
  unavailable: reason,
  failures: [],
  questions: messageNodesOf(findings).length,
  pairs: 0,
  rejectedClauses: messageNodesOf(findings)
    .filter((message) => !isImperativeClause(message.clause))
    .map((message) => ({ message: message.message, clause: message.clause })),
})
