import { Effect, type Predicate } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { describeOperation, permitted, settle } from "../operation.ts"
import { policy } from "../policy.ts"
import { clusterOf, nameList, type Cluster } from "../cluster.ts"
import {
  budgetNote,
  declined,
  inScope,
  marginOfAnswer,
  outcome,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { planClusters, readClusters, type ClusterRule } from "./cluster-verdict.ts"
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
const nameQuestionnaire: ClusterRule["questionnaire"] = (cluster, described, workspace) =>
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
      const settled = settle({
        derived: score >= policy.decision.gates.probabilityFloor ? "merge" : undefined,
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
 * One spelling per concept.
 *
 * Names are addresses: an agent finds code by grepping a name, so two names for
 * one concept cost retrieval on every future change. This table is the only
 * hand-written knowledge in the rule, and it exists so the judgement sees
 * `orgId` and `organizationId` as the same phrase rather than as two strings.
 */
const abbreviations: Readonly<Record<string, string>> = {
  arg: "argument", auth: "authentication", cfg: "configuration", config: "configuration",
  ctx: "context", db: "database", dir: "directory", doc: "document", env: "environment",
  err: "error", fn: "function", id: "identifier", idx: "index", impl: "implementation",
  info: "information", init: "initialize", msg: "message", num: "number",
  org: "organization", param: "parameter", prev: "previous", repo: "repository",
  req: "request", res: "response", spec: "specification", stat: "statistic",
  str: "string", util: "utility", utils: "utility",
}

/** Split a name into words on its camelCase, snake_case and kebab-case seams. */
export const words = (name: string): ReadonlyArray<string> =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word.length > 0)

/** Split a name into words and expand the abbreviations in the table. */
export const expanded = (name: string): ReadonlyArray<string> =>
  words(name).map((word) => abbreviations[word] ?? word)

/** Two names compared for similarity: neither is privileged. */
interface NamePair {
  readonly one: string
  readonly two: string
}

/**
 * Jaccard over expanded words, and nothing else.
 *
 * This used to add a quarter when the two names shared a head noun, to catch
 * `fetchUserProfile` against `getUserProfile`. The bonus also lifted every pair
 * of `*Modal`s over the line, which is how one category became a "concept".
 * Those two names already score 0.5 without it, which is the threshold.
 */
const nameScore = ({ one, two }: NamePair): number => {
  const a = new Set(expanded(one))
  const b = new Set(expanded(two))
  let intersection = 0
  for (const word of a) if (b.has(word)) intersection += 1
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

/**
 * Whether a pair of names is worth asking the model about.
 *
 * Exported so the filter can be tested as a rule of its own. It is the whole
 * difference between a rule that costs money and one that spends it.
 *
 * It no longer decides whether the extra word CARRIES meaning -- `get` in front
 * of a name versus `formatted` in the middle. That is the question this rule
 * exists to ask, and a hand-maintained list of "words that do not count" was
 * answering it (docs/rule-coupling.md). The filter keeps the structural part:
 * the two names are nested and differ by exactly one word.
 */
export const worthJudging: Predicate.Predicate<NamePair> = ({ one, two }) => {
  if (one === two) return false
  const words = new Set(expanded(one))
  const other = new Set(expanded(two))
  let common = 0
  for (const word of words) if (other.has(word)) common += 1
  const differs = words.size - common + (other.size - common)
  // Identical expanded words: the spellings differ and nothing else does.
  if (differs === 0) return true
  // One side inside the other, by exactly one word. Whether that word carries
  // meaning is the QUESTION: a hand-maintained list of "words that do not count"
  // used to decide it (docs/rule-coupling.md).
  const nested = common === words.size || common === other.size
  return nested && differs === 1
}

const sharedWords = ({ one, two }: NamePair): number => {
  const a = new Set(expanded(one))
  let shared = 0
  for (const word of new Set(expanded(two))) if (a.has(word)) shared += 1
  return shared
}

/**
 * Every pair of names in a head-noun family that is worth asking about, judged
 * pair by pair.
 *
 * There is no clustering here and no cap before the judging. Pairs were once
 * sorted globally by score and sliced, so a whole family could go unexamined
 * while another spent the budget, silently. Now every qualifying pair is
 * enumerated, ordered so a budget keeps the strongest, and whatever the budget
 * does not reach is named in the report.
 */
const find = (workspace: Workspace, scope: Scope): ReadonlyArray<Cluster> => {
  const { minScore, minSharedWords } = policy.namingDrift
  const units = workspace.units
  const byHead = new Map<string, Array<number>>()
  units.forEach((unit, index) => {
    // Exported names only, and the number is why: on one 2,456-file application
    // removing this filter takes the candidate set from 23 to 77, three times the
    // cost, and the recall it buys is unmeasured. The argument FOR removing it is
    // real -- an agent greps a file-local name as readily as an exported one, and
    // the two duplications joggle found in a 110-file library were both
    // file-local -- but those were found by the near-duplicate rule, which has no
    // such filter, so nothing is lost by leaving this one in place.
    if (!unit.exported) return
    const head = expanded(unit.name).at(-1)
    if (head === undefined) return
    const existing = byHead.get(head)
    if (existing === undefined) byHead.set(head, [index])
    else existing.push(index)
  })

  const pairs: Array<{ left: number; right: number; score: number }> = []
  for (const group of byHead.values()) {
    for (let a = 0; a < group.length; a += 1) {
      for (let b = a + 1; b < group.length; b += 1) {
        const left = group[a]
        const right = group[b]
        if (left === undefined || right === undefined) continue
        const one = units[left]
        const two = units[right]
        if (one === undefined || two === undefined) continue
        if (one.name === two.name) continue
        if (one.file === two.file) continue
        if (one.kind !== two.kind) continue
        // Test fixtures are compared only against each other.
        if (one.test && two.test) continue
        if (sharedWords({ one: one.name, two: two.name }) < minSharedWords) continue
        // A new pair of spellings has to include the spelling that changed.
        if (!inScope(scope, one.file) && !inScope(scope, two.file)) continue
        const score = nameScore({ one: one.name, two: two.name })
        if (score < minScore) continue

        // Shape of the pair, measured over 1,864 judged candidates:
        //
        //   identical words            7 judged    5 findings    71%
        //   subset, one word differs 451 judged   11 findings   2.4%
        //   neither of those        1,406 judged    1 finding   0.07%
        //
        // The dropped buckets cost 75% of the API spend for 6% of the findings.
        // What separates them is the KIND of word that differs: `custom`,
        // `review` and `multi` name different things, while case, word order and
        // an accessor verb like `get` or `calculate` do not distinguish anything.
        // That is a judgement the filter may make, because it is about shape
        // rather than about which of two names is right.
        if (!worthJudging({ one: one.name, two: two.name })) continue

        pairs.push({ left, right, score })
      }
    }
  }

  return pairs
    .sort((a, b) => b.score - a.score || a.left - b.left || a.right - b.right)
    .flatMap((pair) => {
      const one = units[pair.left]
      const two = units[pair.right]
      if (one === undefined || two === undefined) return []
      return [clusterOf([one, two], false, pair.score)]
    })
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
    const phase = yield* planClusters(spec, clusters.slice(0, budget), scope, workspace)
    const layers = layersFrom(context.config)
    const unjudged = clusters.slice(budget)
    const notes = budgetNote({
      unitKind: "pairs",
      judged: budget,
      candidates: clusters.length,
      sample: unjudged.slice(0, 3).map((cluster) => nameList(cluster)),
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
