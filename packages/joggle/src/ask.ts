import { Effect, Result, Schema } from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import { Decision, DecisionModel } from "effect/unstable/ai"
import { isUnreachable } from "./decision.ts"
import { policy } from "./policy.ts"
import type { Unit, UnitKind, Workspace } from "./workspace.ts"

/**
 * Semantic search over the declarations, in one request.
 *
 * The pattern is TypeSafe's line-by-line search: put the query and the candidates
 * in the state, ask one Choice over the candidates so the whole probability
 * distribution is a ranking rather than a single winner, and ask one Noul for the
 * absolute question the Choice cannot answer -- does this codebase answer at all.
 * A Choice is relative (which of these) and a Noul is absolute (is there one), so
 * the two together separate "nothing here" from "the best of a bad set".
 *
 * The candidates are prefiltered in code by keyword overlap. That is not a
 * judgement, it is a state bound: the model reads worse as unrelated state grows,
 * so the query never sees the whole workspace.
 */

const AskEvidence = Schema.Struct({
  query: Schema.String,
  candidates: Schema.Array(
    Schema.Struct({
      symbol: Schema.String,
      kind: Schema.String,
      path: Schema.String,
      source: Schema.String,
      /**
       * The compiler's resolved type, when the run asked for a trace. Absent
       * otherwise, so the request a run without `--types` sends is byte-identical
       * to the one it always sent.
       */
      resolved: Schema.optionalKey(Schema.String),
    }),
  ),
})

const existsDecision = Decision.probability({
  instructions: [
    "Does any declaration in `candidates` answer the question in `query`?",
    "Answer about the code's meaning, not the words: a declaration answers the question when its behaviour or purpose is what the question asks about.",
    "Answer true when at least one declaration answers it, however imperfectly. Answer false when the question is about something this code does not do.",
  ].join("\n"),
  criteria: {
    false: "No declaration answers the question.",
    true: "At least one declaration answers the question.",
  },
})

/**
 * One Noul per candidate, not one Choice over all of them.
 *
 * A Choice is relative and, over a couple of hundred options, it concentrates:
 * one option takes almost all the probability and the rest go to zero, so it
 * names a winner but not a ranking. A Noul is absolute -- "is THIS one relevant?"
 * -- so every candidate gets a comparable score and the sort is a real ordering.
 * The `exists` Noul keeps the absolute question the per-candidate ones cannot
 * answer: whether the codebase answers at all.
 */
const relevanceInstructions = (index: number): string =>
  [
    "Is `candidates[" + index + "]` relevant to the question in `query`?",
    "Answer about what the declaration DOES, not whether its name shares words with the question.",
    "Answer true when a reader asking the question would want to read this declaration. Answer false for a declaration that merely mentions a related word.",
  ].join("\n")

export interface Match {
  readonly symbol: string
  readonly symbolKind: UnitKind
  readonly file: string
  readonly line: number
  /** The probability the Choice gave this declaration. */
  readonly confidence: number
}

export interface Answer {
  /** The probability that any declaration answers the question. */
  readonly exists: number
  readonly matches: ReadonlyArray<Match>
  /** How many declarations were ranked. */
  readonly considered: number
}

/** The candidates, ordered by keyword overlap so the state bound keeps the likely ones. */
const candidatesIn = (workspace: Workspace, query: string): ReadonlyArray<Unit> => {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2)
  const scored = workspace.units
    .filter((unit) => unit.tokens.length >= policy.ask.minTokens)
    .map((unit) => {
      const haystack = (unit.name + " " + unit.file + " " + unit.text).toLowerCase()
      const overlap = words.filter((word) => haystack.includes(word)).length
      return { unit, overlap }
    })
    .filter((entry) => words.length === 0 || entry.overlap > 0)
    .sort((left, right) => right.overlap - left.overlap || left.unit.file.localeCompare(right.unit.file))
  return scored.slice(0, policy.ask.maxCandidates).map((entry) => entry.unit)
}

/** One candidate as the model sees it, with the compiler's answer when there is one. */
const candidateEvidence = (unit: Unit) => {
  const evidence = {
    symbol: unit.name,
    kind: unit.kind,
    path: unit.file,
    source: unit.text.slice(0, policy.ask.maxSourceChars),
  }
  const facts = unit.typeFacts
  if (facts === undefined) return evidence
  return { ...evidence, resolved: facts.display }
}

/**
 * Answer a question about the code.
 *
 * A request carries one decision per candidate, so its output grows with the
 * candidate list and a whole-repository ask can exceed the provider's token
 * ceiling. Two bounds keep that from being fatal: the candidate list is trimmed
 * to the input budget before the request, and a request that still comes back
 * too large is halved and retried -- the same degradation `check` uses for its
 * chunks. Narrowing the paths remains the best answer, and is what the error
 * says when even one candidate does not fit.
 *
 * @param workspace - The loaded workspace.
 * @param query - The question, in plain language.
 * @param options - The input-token budget for the request.
 * @returns The existence probability and the ranked matches.
 */
export const ask = (
  workspace: Workspace,
  query: string,
  options: { readonly maxInputTokens?: number | undefined } = {},
): Effect.Effect<Answer, AiError.AiError, DecisionModel.DecisionModel> =>
  Effect.gen(function* () {
    const budget = options.maxInputTokens ?? policy.ask.maxInputTokens
    const candidates = fitToBudget(candidatesIn(workspace, query), query, budget)
    if (candidates.length === 0) return { exists: 0, matches: [], considered: 0 }

    const attempt = (list: ReadonlyArray<Unit>) =>
      Effect.gen(function* () {
        const decisions: Array<readonly [string, Decision.Any]> = [
          ["exists", existsDecision],
          ...list.map(
            (_unit, index): readonly [string, Decision.Any] => [
              `candidate_${index}`,
              Decision.probability({
                instructions: relevanceInstructions(index),
                criteria: {
                  false: "It does not answer the question.",
                  true: "It answers the question.",
                },
              }),
            ],
          ),
        ]
        const definition = Decision.make({ input: AskEvidence, decisions: Object.fromEntries(decisions) })
        const decided = yield* DecisionModel.decide(definition, {
          input: {
            query,
            candidates: list.map((unit) => candidateEvidence(unit)),
          },
        })
        return { decided, list }
      })

    // Cut and retry. A model that was never reached is not a bad answer, so it
    // is not retried; a request the provider rejected as too large is.
    const attemptWithinBudget = () =>
      Effect.gen(function* () {
        let list = candidates
        for (;;) {
          const outcome = yield* Effect.result(attempt(list))
          if (Result.isSuccess(outcome)) return outcome.success
          if (list.length <= 1 || isUnreachable(outcome.failure)) {
            return yield* outcome.failure
          }
          list = list.slice(0, Math.max(1, Math.ceil(list.length / 2)))
        }
      })

    const answered = yield* attemptWithinBudget()

    const exists = answered.decided.answers["exists"]
    const probability = exists !== undefined && "probability" in exists ? exists.probability : 0
    const matches = answered.list
      .map((unit, index) => {
        const answer = answered.decided.answers[`candidate_${index}`]
        return {
          symbol: unit.name,
          symbolKind: unit.kind,
          file: unit.file,
          line: unit.location.line,
          confidence: answer !== undefined && "probability" in answer ? answer.probability : 0,
        }
      })
      .sort((left, right) => right.confidence - left.confidence)
      .slice(0, policy.ask.top)
    return { exists: probability, matches, considered: answered.list.length }
  })

/**
 * Keep the candidates whose evidence fits the input budget, in rank order.
 *
 * The estimate is the same characters-over-four the check budget uses, and the
 * first candidate is always kept so a tiny budget still asks something.
 */
const fitToBudget = (
  candidates: ReadonlyArray<Unit>,
  query: string,
  budget: number,
): ReadonlyArray<Unit> => {
  const kept: Array<Unit> = []
  let chars = query.length
  for (const unit of candidates) {
    const cost =
      Math.min(unit.text.length, policy.ask.maxSourceChars) + unit.name.length + unit.file.length
    if (kept.length > 0 && Math.ceil((chars + cost) / 4) > budget) break
    kept.push(unit)
    chars += cost
  }
  return kept
}
