import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { describeOperation, permitted, settle } from "../operation.ts"
import { policy } from "../policy.ts"
import { expanded, namePairs, rankSpeculative } from "../candidates.ts"
import { clusterOf, nameList, type Cluster } from "../cluster.ts"
import {
  budgetNote,
  declined,
  marginOfAnswer,
  outcome,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { panelFromAnswers, planClusters, readClusters, type ClusterRule } from "./cluster-verdict.ts"
import { layersFrom } from "../architecture.ts"
import { nameVocabulary } from "../vocabulary.ts"
import type { Unit, Workspace } from "../workspace.ts"

/**
 * The question naming-drift should always have been asking.
 *
 * It asks whether two NAMES denote one concept -- a question about words -- not
 * whether one declaration is a redundant copy of the other, which is a question
 * about bodies and is correctly answered "no" for two different things that
 * merely share a name root. The state carries the expanded words for both, so
 * the model compares meanings rather than strings, and `same_words` reports the
 * case where only the spelling differs.
 */
const nameQuestionnaire: ClusterRule["questionnaire"] = ({
  cluster,
  described,
  workspace,
}) =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    const operations = permitted(workspace, cluster.members)
    const left = described[0]
    const right = described[1]
    const wordsOf = (unit: Unit | undefined) => (unit === undefined ? [] : expanded(unit.name))
    const leftWords = wordsOf(left)
    const rightWords = wordsOf(right)
    const sameWords = leftWords.join(" ") === rightWords.join(" ")

    const leftId = yield* atoms.add({
      symbol: left?.name ?? null,
      words: leftWords,
      kind: left?.kind ?? null,
      path: left?.file ?? null,
    })
    const rightId = yield* atoms.add({
      symbol: right?.name ?? null,
      words: rightWords,
      kind: right?.kind ?? null,
      path: right?.file ?? null,
    })
    const factsId = yield* atoms.add({ same_words: sameWords })

    return {
      atoms: [leftId, rightId, factsId],
      decisions: {
        one_concept: Decision.probability({
          instructions:
            "Do `atoms[" + leftId + "].symbol` and `atoms[" + rightId + "].symbol` denote the same concept? Compare `atoms[" + leftId + "].words` and `atoms[" + rightId + "].words` word by word. Two names for one concept are a spelling problem; two names for two different things are not, however similar they read.",
          criteria: nameVocabulary.oneConcept,
        }),
        verdict: Decision.classify({
          instructions:
            "What should happen to these two names? Compare `atoms[" + leftId + "].symbol` and `atoms[" + rightId + "].symbol`. `atoms[" + leftId + "].words` and `atoms[" + rightId + "].words` are what each name means; `atoms[" + factsId + "].same_words` is true when only the spelling differs. Choose `no_issue` when the names denote two different concepts.",
          criteria: {
            same_use_left: nameVocabulary.standardize(left?.name ?? "left"),
            same_use_right: `One concept, two spellings. Standardize on \`${right?.name ?? "right"}\`.`,
            no_issue: "Two different concepts. Both names are correct. Change nothing.",
          },
        }),
        // The model's own read, over the operations the graph permits. A merge
        // across a package boundary is not among them.
        operation: Decision.classify({
          instructions: [
            "What should happen to these two names?",
            "Answer with the one that fits what they are and where they live.",
            "Choose `no_issue` when nothing should change.",
          ].join("\n"),
          criteria: {
            ...Object.fromEntries(operations.map((operation) => [operation, describeOperation(operation)])),
            no_issue: "Leave both names as they are.",
          },
        }),
      },
      read: (answers) => {
      const verdict = answers["verdict"]
      if (verdict === undefined || !("label" in verdict)) return undefined
      const oneConcept = answers["one_concept"]
      const score =
        oneConcept !== undefined && "probability" in oneConcept
          ? oneConcept.probability
          : (verdict.confidence ?? 1)
      const margin = marginOfAnswer(verdict)
      const confidence = verdict.confidence ?? 1

      // The table here is one line, because a name pair has one repair: two
      // spellings of one concept standardize on one of them. The model's own read
      // is the second estimator, and the graph decides what it may propose.
      const operationAnswer = answers["operation"]
      const proposed =
        operationAnswer !== undefined &&
        "label" in operationAnswer &&
        (operationAnswer.label === "merge" || operationAnswer.label === "move")
          ? operationAnswer.label
          : undefined
      const derived: "merge" | undefined =
        score >= policy.decision.gates.probabilityFloor ? "merge" : undefined
      const settled = settle({
        derived,
        proposed,
        margin: operationAnswer !== undefined && "label" in operationAnswer ? marginOfAnswer(operationAnswer) : 1,
        confidence:
          operationAnswer !== undefined && "confidence" in operationAnswer
            ? operationAnswer.confidence
            : undefined,
      })

      if (declined(verdict.label)) {
        return {
          keep: undefined,
          confidence,
          score,
          redundancy: score,
          margin,
          derived,
          panel: panelFromAnswers(answers, { derived, agreement: "drop" }),
          operation: undefined,
          agreement: "drop" as const,
          settled: "the model said " + verdict.label,
        }
      }
      return {
        keep: verdict.label === "same_use_right" ? 1 : 0,
        confidence,
        score,
        // Names have no consequence axis: whether two spellings matter is what
        // `one_concept` already asks.
        redundancy: score,
        margin,
        derived,
        panel: panelFromAnswers(answers, {
          operation: settled.operation,
          derived,
          agreement: settled.quality,
        }),
        operation: settled.operation,
        agreement: settled.quality,
        settled: settled.reason,
      }
      },
    }
  })

const spec: ClusterRule = {
  ruleId: "joggle/naming-drift",
  severity: "warn",
  move: "contract",
  onUnavailable: "propagate",
  questionnaire: nameQuestionnaire,
  nameOf: (cluster) => {
    const names = [...new Set(cluster.members.map((member) => member.name))]
    return names.length === 1
      ? `\`${names[0] ?? "?"}\` is spelled ${cluster.members.length} ways`
      : `${names.join(", ")} may be one concept`
  },
}

/**
 * Pairs of names in one head-noun family, from the candidate engine.
 *
 * Exported names only, and the number is why: on one 2,456-file application
 * removing this filter takes the candidate set from 23 to 77, three times the
 * cost, and the recall it buys is unmeasured. The argument FOR removing it is
 * real -- an agent greps a file-local name as readily as an exported one -- but
 * the two duplications joggle found in a 110-file library were both file-local,
 * and those were found by the near-duplicate rule, which has no such filter.
 */
const find = (workspace: Workspace, scope: Scope): ReadonlyArray<Cluster> => {
  const { minScore, minSharedWords } = policy.namingDrift
  return namePairs({
    units: workspace.units,
    minScore,
    minSharedWords,
    scope,
    exportedOnly: true,
  }).map((pair) => clusterOf([pair.left, pair.right], false, pair.score))
}
export const namingDrift: PlannedRule = {
  id: spec.ruleId,
  severity: spec.severity,
  description: "Two spellings of one concept across files.",
  judged: true,
  onUnavailable: spec.onUnavailable,
  plan: Effect.fn("joggle/naming-drift")(function* (workspace, scope, context) {
    const clusters = find(workspace, scope)
    if (clusters.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no two exported names were near enough to be worth judging"]),
      }
    }
    const budget = policy.namingDrift.maxClusters
    // Name pairs are a guess, so the budget is filled by a relevance judgement
    // over a deterministic window rather than by a global sort-and-slice.
    const ordered = yield* rankSpeculative({
      budget,
      items: clusters.map((cluster) => ({
        item: cluster,
        strength: cluster.overlap,
        evidence: {
          names: cluster.members.slice(0, 2).map((member) => member.name),
          files: [...new Set(cluster.members.map((member) => member.file))].slice(0, 4),
          signal: Math.round(cluster.overlap * 100) + "% shared name words",
        },
      })),
    })
    const phase = yield* planClusters(spec, ordered.slice(0, budget), scope, workspace)
    const layers = layersFrom(context.config)
    const unjudged = ordered.slice(budget)
    const notes = budgetNote({
      unitKind: "pairs",
      judged: budget,
      candidates: clusters.length,
      sample: unjudged.slice(0, 3).map((cluster) => nameList({ cluster })),
    })
    return {
      plans: phase.planned.map((entry) => entry.plan),
      read: (answers) => {
        const judged = readClusters(spec, workspace, phase, layers, answers)
        return outcome(judged.diagnostics, notes, judged.drops)
      },
    }
  }),
}
