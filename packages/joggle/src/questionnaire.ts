import type { Decision } from "effect/ai"
import type { Plan, Questionnaire } from "./plans.ts"
import { policy } from "./policy.ts"

/*
 * The question-shape gate, over every questionnaire before it is sent.
 *
 * `docs/jev.md` constrains the FORM of a question, not only its content: one
 * snap judgment, candidates code derived, at most eight options. The measured
 * failure was a Choice with 55 candidates, asked 150 times in one run, where the
 * only answer an unfamiliar repair could get was the one that was not a repair.
 * A question that cannot be wrong in a way the ledger can see is not a
 * question. This module is the cheap, deterministic check that keeps that shape
 * from reaching the provider.
 */

/** One way a questionnaire breaks the contract in `docs/jev.md`. */
export type QuestionRule =
  | "primitive"
  | "atom-reference"
  | "instruction-length"
  | "option-count"
  | "option-description-length"
  | "declared-atom"

/** A breach, named with the plan and decision it belongs to. */
export interface QuestionViolation {
  readonly rule: QuestionRule
  /** The plan's subject, or the questionnaire's question when it has no plan. */
  readonly subject: string
  readonly decision: string
  readonly message: string
}

/** Counts over one run's collected plans, for the report to paste. */
export interface QuestionCensus {
  readonly plans: number
  readonly questions: number
  readonly violations: ReadonlyArray<QuestionViolation>
  readonly byRule: Readonly<Record<QuestionRule, number>>
  /** The first breach in policy order, so a report has one thing to name. */
  readonly worst: QuestionViolation | undefined
}

/** The shape limits, published in `policy` beside every other threshold. */
export interface QuestionShapePolicy {
  readonly maxInstructionChars: number
  readonly maxOptionDescriptionChars: number
  readonly maxChoiceOptions: number
}

const shapePolicyOf = (): QuestionShapePolicy => ({
  maxInstructionChars: policy.decision.questionShape.maxInstructionChars,
  maxOptionDescriptionChars: policy.decision.questionShape.maxOptionDescriptionChars,
  maxChoiceOptions: policy.decision.maxChoiceOptions,
})

/** A description as the text a reader (and the provider) actually receives. */
export const descriptionText = (description: unknown): string => {
  if (typeof description === "string") return description
  if (description === null || description === undefined) return ""
  return JSON.stringify(description) ?? ""
}

/** Every `atoms[...]` path one instruction names. */
export const atomReferencesOf = (instructions: unknown): ReadonlyArray<string> => {
  const text = descriptionText(instructions)
  const references: Array<string> = []
  const pattern = /atoms\[([^\]]+)\]/gu
  let match = pattern.exec(text)
  while (match !== null) {
    const id = match[1]
    if (id !== undefined && !references.includes(id)) references.push(id)
    match = pattern.exec(text)
  }
  return references
}

const optionDescriptionsOf = (
  decision: Decision.Any,
): ReadonlyArray<{
  readonly label: string
  readonly description: string
}> => {
  if (decision._tag === "Classify") {
    return Object.entries(decision.criteria).map(([label, description]) => ({
      label,
      description: descriptionText(description),
    }))
  }
  if (decision._tag === "Rate") {
    return decision.criteria.map((criterion) => ({
      label: criterion.label,
      description: descriptionText(criterion.description),
    }))
  }
  return []
}

const optionCountOf = (decision: Decision.Any): number => {
  if (decision._tag === "Classify") return Object.keys(decision.criteria).length
  if (decision._tag === "Rate") return decision.criteria.length
  return 0
}

/**
 * Check one questionnaire against the six shape rules.
 *
 * The rules are the contract's own, and each message cites the passage that
 * says so. A violation is returned, not thrown: the caller decides whether the
 * run stops, reports, or continues with the questions that are still valid --
 * the measured corpus contains working questions that a threshold would reject,
 * and hiding that behind a pass would be the wrong fix.
 *
 * @param questionnaire - the questions about to be sent.
 * @param subject - what the caller names the questionnaire, for the report.
 * @returns every breach, in decision declaration order.
 */
export const validateQuestionnaire = (
  questionnaire: Questionnaire<unknown>,
  subject = "questionnaire",
): ReadonlyArray<QuestionViolation> => {
  const limits = shapePolicyOf()
  const violations: Array<QuestionViolation> = []
  const declared = new Set(questionnaire.atoms)
  for (const [name, decision] of Object.entries(questionnaire.decisions)) {
    const add = (rule: QuestionRule, message: string): void => {
      violations.push({ rule, subject, decision: name, message })
    }
    // `docs/jev.md`, "Four primitives": every answer is Choice, Score, Noul or
    // Box. Joggle sends only the three it can read, so a Locate is a bug here.
    if (
      decision._tag !== "Classify" &&
      decision._tag !== "Probability" &&
      decision._tag !== "Rate"
    ) {
      add(
        "primitive",
        "Decision `" +
          name +
          "` is a " +
          decision._tag +
          ", not a Choice, Score or Noul (docs/jev.md, Four primitives).",
      )
      continue
    }
    const instructions = descriptionText(decision.instructions)
    const references = atomReferencesOf(decision.instructions)
    // `docs/jev.md`, rule 4: name the parts of `state` by path. A question that
    // names no atom is asking about nothing the state can answer.
    if (references.length === 0) {
      add(
        "atom-reference",
        "Decision `" + name + "` names no `atoms[...]` path (docs/jev.md, rule 4).",
      )
    }
    if (instructions.length > limits.maxInstructionChars) {
      add(
        "instruction-length",
        "Decision `" +
          name +
          "` has " +
          String(instructions.length) +
          " instruction characters, over the " +
          String(limits.maxInstructionChars) +
          "-character limit (docs/jev.md, rule 1: one snap judgment).",
      )
    }
    for (const option of optionDescriptionsOf(decision)) {
      if (option.description.length <= limits.maxOptionDescriptionChars) continue
      add(
        "option-description-length",
        "Decision `" +
          name +
          "` option `" +
          option.label +
          "` has " +
          String(option.description.length) +
          " description characters, over the " +
          String(limits.maxOptionDescriptionChars) +
          "-character limit (docs/jev.md, rule 6: code acts on the candidate directly).",
      )
    }
    const options = optionCountOf(decision)
    if (options > limits.maxChoiceOptions) {
      add(
        "option-count",
        "Decision `" +
          name +
          "` offers " +
          String(options) +
          " options, over " +
          String(limits.maxChoiceOptions) +
          " (docs/jev.md, rule 4: more than eight is a decision wearing a question's clothes).",
      )
    }
    // `docs/jev.md`, rule 3: questions are independent, and the state a question
    // reads is the state its plan declared. A path outside `atoms` is a fact the
    // model cannot see.
    for (const reference of references) {
      if (declared.has(reference)) continue
      add(
        "declared-atom",
        "Decision `" +
          name +
          "` reads `atoms[" +
          reference +
          "]` but the plan declared " +
          (declared.size === 0 ? "no atoms" : "[" + [...declared].join(", ") + "]") +
          " (docs/jev.md, rule 3: put the fact in state, not in an earlier answer).",
      )
    }
  }
  return violations
}

/** Check one plan, keeping the subject it reports under. */
export const validatePlan = (plan: Plan<unknown>): ReadonlyArray<QuestionViolation> =>
  validateQuestionnaire(plan, plan.subject)

const emptyCounts = (): Record<QuestionRule, number> => ({
  primitive: 0,
  "atom-reference": 0,
  "instruction-length": 0,
  "option-count": 0,
  "option-description-length": 0,
  "declared-atom": 0,
})

/**
 * Validate every plan a run collected and count the breaches by rule.
 *
 * This is the number the rung reads: total questions, violations by rule, and
 * the worst offender. It is computed from the plans alone, so it costs nothing
 * and can run before a single token is spent.
 *
 * @param plans - every questionnaire the run is about to send.
 * @returns the census a report or a gate can paste.
 */
export const questionnaireCensus = (plans: ReadonlyArray<Plan<unknown>>): QuestionCensus => {
  const byRule = emptyCounts()
  const violations: Array<QuestionViolation> = []
  let questions = 0
  for (const plan of plans) {
    questions += Object.keys(plan.decisions).length
    for (const violation of validatePlan(plan)) {
      byRule[violation.rule] += 1
      violations.push(violation)
    }
  }
  return {
    plans: plans.length,
    questions,
    violations,
    byRule,
    worst: violations[0],
  }
}

/** One line for the report: the counts, then the first offender. */
export const describeQuestionCensus = (census: QuestionCensus): string => {
  const counts = (Object.entries(census.byRule) as ReadonlyArray<[QuestionRule, number]>)
    .filter(([, count]) => count > 0)
    .map(([rule, count]) => rule + " " + String(count))
    .join(", ")
  const worst = census.worst
  return (
    "question shape: " +
    String(census.plans) +
    " plan(s), " +
    String(census.questions) +
    " question(s), " +
    String(census.violations.length) +
    " violation(s)" +
    (counts === "" ? "" : " (" + counts + ")") +
    (worst === undefined
      ? ""
      : "; worst " + worst.subject + " / " + worst.decision + ": " + worst.message)
  )
}
