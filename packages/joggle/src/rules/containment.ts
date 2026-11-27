import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { fragmentsOf } from "../fragments.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import {
  allContainmentPairs,
  frequencyOf,
  inverseFrequencyOf,
  sharedOf,
  similarityOf,
} from "../similarity.ts"
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
import { testOrFixturePath, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/containment"

/** Which labels mean this rule is violated -- the read and calibration share it. */
const VIOLATIONS = { relation: ["extend_the_primitive", "extract_shared"] } as const

/** A declaration the identity pass encoded, with the pieces it is made of. */
interface Fragmented {
  readonly unit: Unit
  /** Deduplicated subtree ids: the declaration's fragments. */
  readonly ids: ReadonlySet<string>
  /** True when the policy bound cut the set, so containment is a lower bound. */
  readonly cut: boolean
}

/** A pair the fragment join found, with both scores and its ranking term. */
interface Candidate {
  readonly smaller: Unit
  readonly larger: Unit
  readonly containment: number
  readonly similarity: number
  /** How rare the shared fragment ids are across the repository, 0..1. */
  readonly rarity: number
  /** `containment * rarity`: the order the budget sees. */
  readonly rank: number
  /** Names of the sides whose fragment set was cut, so the finding can say so. */
  readonly truncated: ReadonlyArray<string>
}

/** A test or a fixture path. `Unit.test` catches declarations inside a test
 * file; this catches a fixture that is not named `.test` and lives under
 * `fixtures/`. Both rules that ask about design use the shared predicate. */
const isTestOrFixture = (unit: Unit): boolean => unit.test || testOrFixturePath(unit.file)

/** The two declarations could be a specialization pair at all. */
const related = (payload: { readonly part: Unit; readonly whole: Unit }): boolean =>
  payload.part !== payload.whole &&
  payload.part.file !== payload.whole.file &&
  payload.part.name !== payload.whole.name &&
  payload.part.kind === payload.whole.kind &&
  !(payload.part.test && payload.whole.test)

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

/**
 * What a cut fragment set does to the score, in the finding's own words.
 *
 * A set that stopped at the policy bound makes the containment a lower bound:
 * the pieces that were not encoded cannot be counted as shared. Silence here
 * would read as an exact measurement.
 */
const truncatedNote = (candidate: Candidate): string =>
  candidate.truncated.length === 0
    ? ""
    : " The fragment set for " +
      candidate.truncated.join(" and ") +
      " was cut at " +
      policy.identity.maxFragments +
      " ids, so this containment is a lower bound."

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

/**
 * A declaration that is a smaller version of another.
 *
 * The near-duplicate rules are blind here by construction. Jaccard divides by the
 * union, so when one declaration is a specialization of another the union grows
 * with every member the larger one adds and the score falls below the duplicate
 * threshold. Containment divides by the smaller side, so the relation survives.
 * The question is therefore not "are these the same?" but "is the smaller one a
 * special case of the larger, or two unrelated things that share tokens?".
 *
 * The measure is over FRAGMENT IDS, not token bigrams. A shingle set per
 * declaration is the wrong substrate twice over: it ran out of memory on this
 * repository (4GB heap, OOM, at 4,649 declarations), and a bigram is not a piece
 * one declaration can contain whole -- a run of statements inside a helper
 * matches the helper's body, but not any declaration's shingle set as a unit.
 * Fragment ids are cheap to compare and expensive to compute, which is the trade
 * a join wants: compute each declaration's subtrees once, then index id ->
 * declarations and visit only pairs that share an id. Two declarations that
 * share no fragment cannot be a specialization pair.
 *
 * Everything else the rule decided is unchanged: tests and fixtures are not
 * candidates, the floor is a size a declaration can actually specialize, the
 * Jaccard exclusion is computed for the pairs the fragment join surfaced, and the
 * budget is spent by containment weighted by how RARE the shared ids are. The
 * message and the question still say "token bigrams" on purpose: a judgement
 * cache keyed by question wording must not be reopened for a substrate change,
 * and the question being asked is the same one.
 */
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
      "{{action}} This pair was found by containment, not similarity, so the duplicate rules could not see it.{{review}}{{truncated}}{{unverifiedHelp}}",
  }),
  plan: Effect.fn("joggle/containment")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(containment, locator(workspace))
    const { minTokens, floor, percentile: cutoffPercentile, maxCandidates } = policy.containment
    const eligible = workspace.units.filter((unit) => unit.tokens.length >= minTokens)

    // The fragment index. `fragmentsOf` parses and hashes each declaration, which
    // is the expensive half of the trade; what the join keeps afterwards is a set
    // of 16-character ids per declaration and a postings map, not a shingle set
    // for every declaration in the repository.
    const fragmented: Array<Fragmented> = []
    const unencoded: Array<Unit> = []
    for (const unit of eligible) {
      const { ids, cut } = fragmentsOf(unit)
      if (ids.length === 0) unencoded.push(unit)
      else fragmented.push({ unit, ids: new Set(ids), cut })
    }
    // A declaration whose subtree ids could not be encoded is skipped rather than
    // forgotten. Tests and fixtures are already not candidates, so their silence
    // is the rule's own exclusion, not this one.
    const fragmentDrops: ReadonlyArray<Drop> = unencoded
      .filter((unit) => !isTestOrFixture(unit))
      .map((unit) => ({
        ruleId: RULE_ID,
        subject: unit.name + " (" + unit.file + ":" + String(unit.location.line) + ")",
        stage: "no_evidence" as const,
        reason:
          "no fragment ids could be encoded for this declaration, so containment cannot compare it",
      }))
    const cutSets = fragmented.filter((entry) => entry.cut).length

    const joined = allContainmentPairs(
      fragmented.map((entry, position) => ({ position, ids: entry.ids })),
      floor,
    )
    const relatedAll = joined
      .map((pair) => {
        const part = fragmented[pair.part]
        const whole = fragmented[pair.whole]
        return part === undefined || whole === undefined
          ? undefined
          : { part, whole, score: pair.score }
      })
      .filter(
        (entry): entry is { part: Fragmented; whole: Fragmented; score: number } =>
          entry !== undefined,
      )
      .filter((entry) => related({ part: entry.part.unit, whole: entry.whole.unit }))

    // Test and fixture declarations are not candidates. The pair count is kept
    // beside the survivors so the funnel still says how much the filter removed;
    // a filter nobody can see is indistinguishable from a rule with nothing to do.
    const excludedTestPairs = relatedAll.filter(
      (entry) => isTestOrFixture(entry.part.unit) || isTestOrFixture(entry.whole.unit),
    )
    const relatedPairs = relatedAll.filter(
      (entry) => !isTestOrFixture(entry.part.unit) && !isTestOrFixture(entry.whole.unit),
    )
    const sourceDeclarations = eligible.filter((unit) => !isTestOrFixture(unit)).length

    const population = relatedPairs.map((entry) => entry.score)
    const cutoff =
      population.length === 0 ? floor : Math.max(floor, percentile(population, cutoffPercentile))
    const thresholdNote =
      population.length === 0
        ? `no non-test distinct-file pair reached containment ${floor.toFixed(2)}, so no cutoff was derived`
        : `containment cutoff ${cutoff.toFixed(3)} (${cutoffPercentile}th percentile of ${population.length} non-test distinct-file pair(s) at or above ${floor.toFixed(2)})`

    const fragmentSizes = relatedPairs
      .map((entry) => Math.min(entry.part.ids.size, entry.whole.ids.size))
      .sort((left, right) => left - right)
    const fragmentNote =
      fragmentSizes.length === 0
        ? "no non-test pair shared a fragment id"
        : `fragment ids: across ${fragmentSizes.length} surviving pair(s), the smaller side has p50 ${percentile(fragmentSizes, 50)}, p90 ${percentile(fragmentSizes, 90)}, and p95 ${percentile(fragmentSizes, 95)} ids`

    const tokenSizes = relatedPairs
      .map((entry) => Math.min(entry.part.unit.tokens.length, entry.whole.unit.tokens.length))
      .sort((left, right) => left - right)
    const tokenNote =
      tokenSizes.length === 0
        ? `min-token floor ${minTokens}: no non-test pair survived it`
        : `min-token floor ${minTokens}: ${sourceDeclarations} source declaration(s) at or above it; across ${tokenSizes.length} surviving pair(s), the smaller side has p50 ${percentile(tokenSizes, 50)}, p90 ${percentile(tokenSizes, 90)}, and p95 ${percentile(tokenSizes, 95)} tokens`

    const similarityThreshold = policy.duplicateMeaning.minSimilarity
    const aboveCutoff = relatedPairs.filter((entry) => entry.score >= cutoff)
    // Document frequency is a counter over fragment ids: how many declarations
    // carry this subtree. This is where the memory went when shingles were the
    // substrate -- a set of strings per declaration instead of an integer per id.
    const frequency = frequencyOf(fragmented.map((entry) => entry.ids))
    let outOfScope = 0
    let skippedSimilar = 0
    const candidates: Array<Candidate> = []
    for (const entry of aboveCutoff) {
      if (
        !inScope(scope, entry.part.unit.file) &&
        !inScope(scope, entry.whole.unit.file)
      ) {
        outOfScope += 1
        continue
      }
      // The subset relation only. A pair Jaccard can also see belongs to the
      // duplicate rules, where the question is already being asked. The shingle
      // Jaccard is computed here, for the pairs the fragment join surfaced: it
      // is cheap once the pairs are few.
      const similarity = similarityOf({
        left: entry.part.unit.shingles,
        right: entry.whole.unit.shingles,
      })
      if (similarity >= similarityThreshold) {
        skippedSimilar += 1
        continue
      }
      const rarity = inverseFrequencyOf({
        shared: sharedOf({ left: entry.part.ids, right: entry.whole.ids }),
        frequency,
        documents: fragmented.length,
      })
      candidates.push({
        smaller: entry.part.unit,
        larger: entry.whole.unit,
        containment: entry.score,
        similarity,
        rarity,
        rank: entry.score * rarity,
        truncated: [
          ...(entry.part.cut ? [entry.part.unit.name] : []),
          ...(entry.whole.cut ? [entry.whole.unit.name] : []),
        ],
      })
    }

    candidates.sort(
      (left, right) =>
        right.rank - left.rank ||
        right.containment - left.containment ||
        left.smaller.name.localeCompare(right.smaller.name) ||
        left.larger.name.localeCompare(right.larger.name),
    )

    const funnelNote = `containment funnel: ${sourceDeclarations} source declaration(s) at or above ${minTokens} tokens; ${fragmented.length} with fragment ids (${unencoded.length} had none, ${cutSets} set(s) cut at ${policy.identity.maxFragments}); ${joined.length} joined pair(s); ${relatedAll.length} distinct-file pair(s); ${excludedTestPairs.length} removed as test/fixture; ${relatedPairs.length - aboveCutoff.length} below the cutoff; ${outOfScope} out of scope; ${skippedSimilar} left to the duplicate rules; ${candidates.length} candidate(s)`

    const extraNotes = [
      thresholdNote,
      tokenNote,
      fragmentNote,
      funnelNote,
      ...(excludedTestPairs.length === 0
        ? []
        : [
            `${excludedTestPairs.length} pair(s) were removed because a declaration is a test or fixture`,
          ]),
      ...(cutSets === 0
        ? []
        : [
            `${cutSets} fragment set(s) were cut at ${policy.identity.maxFragments} ids, so their containment is a lower bound`,
          ]),
      ...(unencoded.length === 0
        ? []
        : [
            `${fragmentDrops.length} declaration(s) at or above ${minTokens} tokens had no fragment ids and were dropped`,
          ]),
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
            fragmentDrops,
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
          truncated: truncatedNote(candidate),
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
        const drops: Array<Drop> = [...fragmentDrops, ...overflow]
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
