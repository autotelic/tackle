import { policy } from "./policy.ts"
import type { Operation } from "./schema.ts"
import { qualityOf, type Quality } from "./rule.ts"
import type { Unit, Workspace } from "./workspace.ts"

// The operations a rule proposes, and how one is settled.
//
// Two estimators, and they are diverse by construction. `derivedOperation` is a
// table a person wrote once; the model's own read sees the whole candidate. Their
// errors are different, so agreement is evidence and disagreement is a signal --
// the method the approximation book opens with, applied to the tool rather than
// to a physics problem.
//
// The table is NOT a proof. It reads like one, and the first version of this file
// presented it as one, which is the exact defect `joggle/rule-judgment` exists to
// find: a person's opinion wearing the costume of a rule. So it is named for what
// it is, it is cross-checked, and a disagreement is reported rather than hidden.

/** The words a Choice offers for one operation. */
export const describeOperation = (operation: Operation): string => {
  switch (operation) {
    case "merge":
      return "Keep one of them and delete the rest. The copies can reach each other, so the others can import the survivor."
    case "split":
      return "One name, two meanings. Give the two meanings two names, and give each its own declaration."
    case "move":
      return "The shared part belongs somewhere all of them can depend on. Move it there and import it."
    case "replace":
      return "An existing declaration already does this. Call it instead."
    case "migrate":
      return "The declaration changed and its dependents must follow. Update each site."
  }
}

/** The package a file belongs to, by its nearest manifest. */
const packageOf = (workspace: Workspace, file: string): string | undefined => {
  const cut = file.lastIndexOf("/")
  const directory = cut === -1 ? "." : file.slice(0, cut)
  return workspace.manifests.get(directory)?.name
}

/**
 * What the graph permits. A fact, so the model cannot propose the impossible.
 *
 * `merge` needs the copies to live in one package: a declaration in a package
 * that cannot depend on another cannot be replaced by it. joggle has already told
 * a Remix app to import a type from a Fastify service, and this is what stops it.
 *
 * @param workspace - The analysed workspace, for the package boundaries.
 * @param members - The declarations that would collapse into one.
 * @returns The operations the repository permits here.
 */
export const permitted = (
  workspace: Workspace,
  members: ReadonlyArray<Unit>,
): ReadonlyArray<Operation> => {
  const packages = new Set(members.map((member) => packageOf(workspace, member.file)))
  return packages.size <= 1 ? ["merge", "move"] : ["move"]
}

/**
 * The table. ONE estimator, and a policy rather than a proof.
 *
 * It is a PEER of the model's own read, not a stage before it: `settle` compares
 * the two and reports a disagreement rather than letting either decide alone.
 * That is what the `difference` question is for -- it is the one input the model
 * supplies to the table, and the table's answer is then a second opinion rather
 * than a verdict the question was designed to rubber-stamp.
 *
 * @param input.candidate - What the candidate is: a name declared twice, a name
 *   with two meanings, or logic in the wrong place. A fact, not an answer.
 * @param input.oneThing - The probability that the declarations are one concept.
 * @param input.difference - Whether the difference between them is a value or a
 *   meaning.
 * @returns The operation the answers imply, or undefined when they imply none.
 */
export const derivedOperation = (input: {
  readonly candidate: "duplicated" | "overloaded" | "misplaced"
  readonly oneThing: number
  readonly difference: "value" | "meaning" | "unclear"
}): Operation | undefined => {
  if (input.candidate === "overloaded") return "split"
  if (input.candidate === "misplaced") return "move"
  if (input.oneThing < policy.decision.gates.probabilityFloor) return undefined
  if (input.difference === "value") return "merge"
  if (input.difference === "meaning") return "move"
  return undefined
}

/** What two estimators agreed on, and how much to trust it. */
export interface Settled {
  readonly operation: Operation | undefined
  readonly quality: Quality
  readonly reason: string
}

/** The two estimators and how much each is worth, for `settle`. */
export interface SettleInput {
  readonly derived: Operation | undefined
  readonly proposed: Operation | undefined
  readonly margin: number
  readonly confidence: number | undefined
}

/**
 * Reconcile the table with the model's own read, as peers.
 *
 * Agreement is the strongest signal this tool has, because the two methods fail
 * differently. Disagreement is not a failure: it is the case a person should
 * look at, so it is reported rather than resolved.
 *
 * Neither decides first. The table is a policy a person wrote; the model read
 * the whole candidate. A question built so that one of them is pre-computed is a
 * question whose answer was fixed before it was asked -- the defect the deleted
 * `merge_changes_behavior` had -- so both are read and compared.
 *
 * @param input.derived - The table's answer, or undefined when it has none.
 * @param input.proposed - The model's answer, or undefined when it declined.
 * @param input.margin - Winner minus runner-up in the model's own distribution.
 * @param input.confidence - The provider's confidence in its answer.
 */
export const settle = (input: SettleInput): Settled => {
  if (input.proposed === undefined) {
    return { operation: undefined, quality: "drop", reason: "the model declined" }
  }
  if (input.derived === undefined) {
    const quality = qualityOf({ score: 0.5, margin: input.margin, confidence: input.confidence })
    return {
      operation: input.proposed,
      quality: quality.quality,
      reason: "the table had no opinion, so the model's read stands alone",
    }
  }
  if (input.derived === input.proposed) {
    return { operation: input.proposed, quality: "act", reason: "the table and the model agree" }
  }
  return {
    operation: input.proposed,
    quality: "review",
    reason: "the table says " + input.derived + ", the model says " + input.proposed,
  }
}
