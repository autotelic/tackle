import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import { allContainmentPairs, similarityOf } from "../similarity.ts"
import { percentile } from "../stats.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  inScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/containment"

/** Which labels mean this rule is violated -- the read and calibration share it. */
const VIOLATIONS = { relation: ["extend_the_primitive", "extract_shared"] } as const

/**
 * A declaration that is a smaller version of another.
 *
 * The near-duplicate rules are blind here by construction. Jaccard divides by the
 * union, so when one declaration is a specialization of another the union grows
 * with every member the larger one adds and the score falls below the duplicate
 * threshold. Containment divides by the smaller side, so the relation survives.
 * The question is therefore not "are these the same?" but "is the smaller one a
 * special case of the larger, or two unrelated things that share tokens?".
 */

/** A pair the containment join found, with both scores. */
interface Candidate {
  readonly smaller: Unit
  readonly larger: Unit
  readonly containment: number
  readonly similarity: number
}

/** The two declarations could be a specialization pair at all. */
const related = (part: Unit, whole: Unit): boolean =>
  part !== whole &&
  part.file !== whole.file &&
  part.name !== whole.name &&
  part.kind === whole.kind &&
  !(part.test && whole.test)

const percent = (value: number): string => (value * 100).toFixed(1)

const differenceOf = (label: string | undefined): string => {
  if (label === "extend_the_primitive") {
    return "The smaller adds a case the larger does not carry."
  }
  if (label === "extract_shared") {
    return "They share a core, and each carries a different variation of it."
  }
  return "The containment is a fact; no judgement says what the difference means."
}

const actionOf = (label: string | undefined): string => {
  if (label === "extend_the_primitive") {
    return "Add the smaller declaration's detail to the larger primitive as an option, parameter, generic or variant, and drop the smaller."
  }
  if (label === "extract_shared") {
    return "Extract the shared part into one primitive, then let each declaration keep only its own difference."
  }
  return "Read the two declarations and decide whether one is a specialization of the other. The containment is exact; the intent is not."
}

const relationReview = (input: {
  readonly id: string
  readonly containment: number
  readonly similarity: number
}) => ({
  relation: Decision.classify({
    instructions: [
      `\`atoms[${input.id}].pair\` describes two declarations from different files. The SMALLER one's token bigrams are ${percent(input.containment)}% contained in the larger one, while their Jaccard similarity is only ${percent(input.similarity)}%.`,
      "Containment is high when the smaller is a smaller version of the larger; Jaccard is low because the union grows with everything the larger adds.",
      `Is \`atoms[${input.id}].pair.smaller\` a specialization of \`atoms[${input.id}].pair.larger\`, or are they two unrelated things that share tokens?`,
      "Choose `extend_the_primitive` when the smaller adds one detail -- a case, option, parameter, variant or narrower domain -- that the larger primitive should carry.",
      "Choose `extract_shared` when both are legitimate but they share a core that belongs in one primitive, with each keeping its own difference.",
      "Choose `coincidence` when they are unrelated, or when the overlap is shared boilerplate rather than shared intent.",
    ].join("\n"),
    criteria: {
      extend_the_primitive: "The smaller is a specialization of the larger.",
      extract_shared: "They share a core that should be one primitive.",
      coincidence: "They are unrelated things that share tokens.",
    },
  }),
})

export const containment: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A declaration that is a specialization of another, invisible to similarity.",
  judged: true,
  move: "combine",
  // The containment is a fact. An unjudged pair is still worth reporting; only
  // the judgement is missing.
  onUnavailable: "report",
  messages: messages({
    contains:
      "`{{smaller}}` ({{smallerAt}}) is a smaller version of `{{larger}}` ({{largerAt}}): {{containment}}% of its token bigrams are in the larger, but Jaccard similarity is only {{similarity}}%. {{difference}}{{unverified}}",
    contains_help:
      "{{action}} This pair was found by containment, not similarity, so the duplicate rules could not see it.{{review}}{{unverifiedHelp}}",
  }),
  plan: Effect.fn("joggle/containment")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(containment, locator(workspace))
    const { minTokens, floor, percentile: cutoffPercentile, maxCandidates } = policy.containment
    const eligible = workspace.units.filter((unit) => unit.tokens.length >= minTokens)
    const joined = allContainmentPairs(
      eligible.map((unit, position) => ({ position, shingles: unit.shingles })),
      floor,
    )
    const relatedPairs = joined
      .map((pair) => {
        const part = eligible[pair.part]
        const whole = eligible[pair.whole]
        return part === undefined || whole === undefined
          ? undefined
          : { part, whole, score: pair.score }
      })
      .filter((entry): entry is { part: Unit; whole: Unit; score: number } => entry !== undefined)
      .filter((entry) => related(entry.part, entry.whole))

    const population = relatedPairs.map((entry) => entry.score)
    const cutoff =
      population.length === 0 ? floor : Math.max(floor, percentile(population, cutoffPercentile))
    const thresholdNote =
      population.length === 0
        ? `no distinct-file pair reached containment ${floor.toFixed(2)}, so no cutoff was derived`
        : `containment cutoff ${cutoff.toFixed(3)} (${cutoffPercentile}th percentile of ${population.length} distinct-file pair(s) at or above ${floor.toFixed(2)})`

    const similarityThreshold = policy.duplicateMeaning.minSimilarity
    let skippedSimilar = 0
    const candidates: Array<Candidate> = []
    for (const entry of relatedPairs) {
      if (entry.score < cutoff) continue
      if (!inScope(scope, entry.part.file) && !inScope(scope, entry.whole.file)) continue
      const similarity = similarityOf({ left: entry.part.shingles, right: entry.whole.shingles })
      // The subset relation only. A pair Jaccard can also see belongs to the
      // duplicate rules, where the question is already being asked.
      if (similarity >= similarityThreshold) {
        skippedSimilar += 1
        continue
      }
      candidates.push({
        smaller: entry.part,
        larger: entry.whole,
        containment: entry.score,
        similarity,
      })
    }

    candidates.sort(
      (left, right) =>
        right.containment - left.containment ||
        left.smaller.name.localeCompare(right.smaller.name) ||
        left.larger.name.localeCompare(right.larger.name),
    )

    const extraNotes = [
      thresholdNote,
      ...(skippedSimilar === 0
        ? []
        : [
            `${skippedSimilar} containment pair(s) were left to the duplicate rules: their Jaccard similarity is already at or above ${similarityThreshold}`,
          ]),
    ]

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome(
            [],
            [
              ...extraNotes,
              "no pair was a subset at the derived cutoff while remaining below the similarity threshold",
            ],
          ),
      }
    }

    const judged = candidates.slice(0, maxCandidates)
    const overflow: ReadonlyArray<Drop> = candidates.slice(maxCandidates).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.smaller.name + " inside " + candidate.larger.name,
      stage: "budget" as const,
      reason: "past the budget of " + maxCandidates + " containment pairs",
    }))
    const atoms = yield* Atoms
    const planned: Array<{ readonly candidate: Candidate; readonly plan: Plan<DecisionAnswers> }> =
      []
    for (const candidate of judged) {
      const id = yield* atoms.add({
        pair: {
          smaller: {
            name: candidate.smaller.name,
            kind: candidate.smaller.kind,
            file: candidate.smaller.file,
            line: candidate.smaller.location.line,
            source: candidate.smaller.text.slice(0, policy.evidence.maxSourceChars),
          },
          larger: {
            name: candidate.larger.name,
            kind: candidate.larger.kind,
            file: candidate.larger.file,
            line: candidate.larger.location.line,
            source: candidate.larger.text.slice(0, policy.evidence.maxSourceChars),
          },
          containment: Number(candidate.containment.toFixed(3)),
          similarity: Number(candidate.similarity.toFixed(3)),
        },
      })
      planned.push({
        candidate,
        plan: {
          ruleId: RULE_ID,
          subject: candidate.smaller.name + " inside " + candidate.larger.name,
          concerns: [candidate.smaller.file, candidate.larger.file],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: relationReview({
            id,
            containment: candidate.containment,
            similarity: candidate.similarity,
          }),
          read: (answers) => answers,
        },
      })
    }

    const findingFor = ({
      candidate,
      label,
      confidence,
      unverified,
      review = false,
    }: {
      readonly candidate: Candidate
      readonly label: string | undefined
      readonly confidence: number | undefined
      readonly unverified: string | undefined
      readonly review?: boolean
    }): Diagnostic =>
      report({
        about: candidate.smaller,
        messageId: "contains",
        data: {
          smaller: candidate.smaller.name,
          larger: candidate.larger.name,
          smallerAt: candidate.smaller.file + ":" + candidate.smaller.location.line,
          largerAt: candidate.larger.file + ":" + candidate.larger.location.line,
          containment: percent(candidate.containment),
          similarity: percent(candidate.similarity),
          difference: differenceOf(label),
          action: actionOf(label),
          review: review ? " For review: the choice was not decisive." : "",
          unverified: unverified === undefined ? "" : " Unjudged: " + unverified + ".",
          unverifiedHelp: unverified === undefined ? "" : " " + unverified + ".",
        },
        helpId: "contains_help",
        identity: [
          RULE_ID,
          candidate.smaller.file,
          candidate.smaller.name,
          candidate.larger.file,
          candidate.larger.name,
        ].join("\u0000"),
        confidence,
        score: candidate.containment,
        judged: unverified === undefined,
        severity: review ? "info" : containment.severity,
        move: containment.move,
      })

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overflow]
        planned.forEach((entry, index) => {
          const candidate = entry.candidate
          const verdict = verdictOf(verdicts[index]?.["relation"], VIOLATIONS.relation)
          if (verdict === undefined) {
            diagnostics.push(
              findingFor({
                candidate,
                label: undefined,
                confidence: undefined,
                unverified: "no judgement was available",
              }),
            )
            return
          }
          if (verdict.label === "coincidence") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.smaller.name + " inside " + candidate.larger.name,
              stage: "declined",
              reason: "the two declarations are unrelated things that share tokens",
            })
            return
          }
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.smaller.name + " inside " + candidate.larger.name,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          diagnostics.push(
            findingFor({
              candidate,
              label: verdict.label,
              confidence: verdict.confidence,
              unverified: undefined,
              review: quality.quality === "review",
            }),
          )
        })
        return outcome(
          diagnostics,
          [
            ...extraNotes,
            ...budgetNote({
              unitKind: "containment pairs",
              judged: maxCandidates,
              candidates: candidates.length,
              sample: candidates
                .slice(maxCandidates)
                .map((candidate) => candidate.smaller.name + " inside " + candidate.larger.name),
            }),
          ],
          drops,
        )
      },
    }
  }),
}
