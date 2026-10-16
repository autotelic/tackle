import { Effect, Order, Schema } from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import { Decision, DecisionModel } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { isUnreachable } from "../decision.ts"
import { cascadeOf } from "../cascade.ts"
import { derivedOperation, describeOperation, permitted, settle } from "../operation.ts"
import { answerPlans, PlanAnswers, type Plan, type Questionnaire } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import type { Move } from "../moves.ts"
import { policy } from "../policy.ts"
import { canImport, sharedLayerFor, type Layer } from "../architecture.ts"
import {
  declined,
  everyFile,
  marginOfAnswer,
  qualityOf,
  type Quality,
  type Scope,
} from "../rule.ts"
import { duplicateVocabulary } from "../vocabulary.ts"
import type { Diagnostic, Drop, DropStage, Operation, Severity } from "../schema.ts"
import { namesOf, type Cluster } from "../cluster.ts"
import type { ImportGraph } from "../imports.ts"
import type { Unit, Workspace } from "../workspace.ts"

/** What a rule decided about one cluster. */
export interface ClusterVerdict {
  /** Index into the described members to keep, or undefined to leave it alone. */
  readonly keep: number | undefined
  readonly confidence: number
  /** What the report sorts by: how much sharing these would change. */
  readonly score: number
  /**
   * What to do about it, decided in code from `role` and `relationship`.
   *
   * Absent when the model did not answer both, in which case the caller falls
   * back to what the declared layers say -- and to neutral wording when there are
   * none. A repository with no architecture config still gets a prescription.
   */
  readonly prescription?: string | undefined
  /**
   * Which prescription the model chose, when it chose one.
   *
   * The label, not the wording: the report BANDS on it. `leave_it` and
   * `share_a_contract` are expected duplication, so they are a notice; a merge or
   * a move is a warning. The finding is still reported -- a band is not a reason
   * to discard an answer -- it just does not shout.
   */
  readonly prescriptionKind?: string | undefined
  /**
   * What the GATE reads: whether this is duplication at all.
   *
   * Kept separate from `score` because they answer different questions, and
   * conflating them would mean a real duplicate nobody cares about gets DROPPED
   * rather than sorted last. A finding that does not matter is still a finding.
   */
  readonly redundancy: number
  /** Winner minus runner-up in the verdict's own distribution. */
  readonly margin: number
  /**
   * The operation the two estimators settled on.
   *
   * Undefined means there is nothing to do: the model declined, or the table read
   * the answers as two things. A finding with no operation is an observation.
   */
  readonly operation: Operation | undefined
  /**
   * Whether the table and the model agreed.
   *
   * `review` means they disagreed, which is the case a person should look at: the
   * two methods fail differently, so a disagreement is information rather than an
   * error to resolve.
   */
  readonly agreement: Quality
  /** Why it settled where it did, in one sentence. */
  readonly settled: string
}

/**
 * A rule's question about one cluster, the state it needs, and how to read the
 * answer.
 *
 * This seam exists because a shared question set is a real hazard, not a
 * simplification. When every rule asked the same "is one of these redundant?",
 * naming-drift was asking it about two declarations with different names and
 * different bodies, and the model -- correctly -- said no. Across 1,864 name
 * candidates that produced six findings. The rule was never starved of budget;
 * it was asked the wrong question, and the answer was right.
 *
 * Each cluster is its own `DecisionModel.decide`, so the input is that
 * cluster's own evidence and there is no marker to rewrite.
 */
export interface ClusterRule {
  readonly ruleId: string
  readonly severity: Severity
  /** The entropy reversal this rule proposes, when it proposes one. */
  readonly move?: Move | undefined
  /**
   * What to do when no judgement is available.
   *
   * `report` is for rules whose finding is a fact -- exact shape equality is
   * provable, so an unjudged cluster is still worth a reader's attention.
   * `propagate` is for rules whose finding is a guess; without a judgement there
   * is nothing to stand on, so the rule stays silent and the engine reports it
   * as skipped rather than inventing a candidate.
   */
  readonly onUnavailable: "report" | "propagate"
  /** How to say what the cluster is, for the finding's first line. */
  readonly nameOf: (cluster: Cluster) => string
  readonly questionnaire: (
    cluster: Cluster,
    described: ReadonlyArray<Unit>,
    workspace: Workspace,
  ) => Effect.Effect<Questionnaire<ClusterVerdict>, never, Atoms>
}

/**
 * The members actually described to the model.
 *
 * A capped prefix of the cluster, so the member ids stay aligned -- but ORDERED so
 * the members this run is about come first. A cluster is sorted by path, and a
 * scoped run is asking about the declarations that MOVED: in a cluster of forty
 * where the changed one sorts thirtieth, a plain prefix shows the model the
 * cluster without the change, and the change is the whole question. The kept
 * member could not even be the one that moved.
 */
export const describedMembers = (cluster: Cluster, scope: Scope): ReadonlyArray<Unit> => {
  const changed = scope.changed
  const ordered =
    changed === undefined
      ? cluster.members
      : [...cluster.members].sort(
          (left, right) => Number(changed.has(right.file)) - Number(changed.has(left.file)),
        )
  return ordered.slice(0, policy.evidence.maxMembers)
}

/**
 * One declaration as the model sees it.
 *
 * The resolved type is added only when the run asked for a trace, and that is
 * deliberate: the state is the judgement cache key, so an unconditional field
 * would invalidate every verdict made before the type layer existed. A run
 * without `--types` sends exactly the panel it always did; a run with it sends a
 * richer one and earns its own verdicts.
 */
const declarationEvidence = (member: Unit): Schema.Json => {
  const evidence = {
    symbol: member.name,
    kind: member.kind,
    path: member.file,
    line: member.location.line,
    source: member.text.slice(0, policy.evidence.maxSourceChars),
    documented: member.doc !== undefined,
    doc: member.doc?.slice(0, policy.evidence.maxDocChars) ?? null,
    types: member.typeRefs,
  }
  const facts = member.typeFacts
  if (facts === undefined) return evidence
  return {
    ...evidence,
    resolved: {
      display: facts.display,
      symbol: facts.symbol,
      flags: facts.flags,
      arguments: facts.arguments,
      members: facts.members,
      origin: facts.origin,
    },
  }
}

const describedNote = (cluster: Cluster, described: ReadonlyArray<Unit>): string =>
  described.length < cluster.members.length
    ? ` The cluster has ${cluster.members.length} members in total; only ${described.length} are shown, and only those can be chosen.`
    : ""

/**
 * The line that points the model at the compiler's answer, when the run has one.
 *
 * The TypeSafe docs are explicit that a question should name the part of the
 * state it is about, with a backticked path. The resolved type is the one part of
 * this panel that is a compiler fact rather than source text, so the question
 * names it and says what it means -- otherwise the model reads `source` and never
 * looks at `resolved`.
 *
 * Empty when the run had no trace, so a run without `--types` sends the questions
 * it always did and keeps its cached verdicts.
 */
const resolvedNote = (described: ReadonlyArray<Unit>): string =>
  described.some((member) => member.typeFacts !== undefined)
    ? "The compiler resolved each declaration's type; each entry of `atoms` carries it on `resolved.display`. Two identical resolved types are one type written twice; two different ones are two types that only read alike."
    : ""

/**
 * The shared question for exact and near duplicates: is one of these redundant?
 *
 * Both rules ask it because for them it is the same question -- the declarations
 * are the same shape or near enough that the only thing left is intent.
 */
export const collapseQuestionnaire: ClusterRule["questionnaire"] = (cluster, described, workspace) =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    // What the repository permits here. A fact, so the model cannot propose a
    // merge across a package boundary.
    const operations = permitted(workspace, cluster.members)
    const ids = yield* atoms.addAll(described.map((member) => declarationEvidence(member)))
    const facts = yield* atoms.add({
      identical: cluster.identical,
      overlap: Number(cluster.overlap.toFixed(3)),
      // The material a panel would need before judging where a thing belongs.
      // No configuration: the paths are in the graph and the relationships are
      // in the paths.
      files: [...new Set(cluster.members.map((member) => member.file))],
      common_directory: commonDirectory(cluster.members.map((member) => member.file)),
      count: cluster.members.length,
      described: described.length,
    })
    const refs = ids.map((id) => `atoms[${id}]`).join(", ")
    const criteria: Record<string, string> = {}
    described.forEach((member, index) => {
      criteria[`member_${index}`] =
        `Keep member_${index}: ` + "`atoms[" + (ids[index] ?? "") + "]` — " + member.name + ", " + member.kind + ", in " + member.file + "."
    })
    const note = describedNote(cluster, described)
    const resolved = resolvedNote(described)
    return {
      atoms: [...ids, facts],
      // The Noul is the violation: its probability IS P(redundant), so the
      // violating set is empty. Calibration reduces this decision.
      violations: { redundant: [] },
      decisions: {
        redundant: Decision.probability({
          instructions: [
            `Are the ${cluster.members.length} declarations named by \`${refs}\` one thing written repeatedly? Each has a \`source\`.`,
            "Answer yes only if a reader is worse off for there being more than one.",
            resolved,
          ]
            .filter((line) => line !== "")
            .join(" "),
          criteria: duplicateVocabulary.redundant,
        }),
        role: Decision.classify({
          instructions: [
            "What IS this declaration, apart from the fact that it is duplicated?",
            `Inspect \`${refs}\`.`,
            "Answer about what the declaration IS, not about what should happen to it. Two copies of a wire contract are correct; two copies of a domain concept are the defect. This answer decides which of those this is.",
            "Choose `implementation_detail` when it is a helper with no meaning of its own.",
          ].join("\n"),
          criteria: duplicateVocabulary.role,
        }),
        relationship: Decision.classify({
          instructions: [
            `How do \`atoms[${facts}].common_directory\` and the files in \`atoms[${facts}].files\` relate?`,
            "Decide from the paths whether any of these files could import another. Same directory, same deployable, sibling packages, or separate services.",
            "Choose `different_deployables` when nothing suggests they can share code.",
          ].join("\n"),
          criteria: duplicateVocabulary.relationship,
        }),
        verdict: Decision.classify({
          instructions: [
            `What should happen to the declarations named by \`${refs}\`?`,
            cluster.identical
              ? `They are syntactically identical, including property names and types.${note}`
              : `They are up to ${Math.round(cluster.overlap * 100)}% structurally similar but not identical.${note}`,
            "Choose `no_issue` when the similarity is coincidence rather than repetition.",
            "Choose `keep_variants` when the copies are DELIBERATELY separate, so one should not replace the other: a wire contract or a framework-required shape defined on each side of a deployable boundary (neither side may import the other), a special case of a general routine, or a stable shape the framework requires.",
            "Two identical request bodies in two independently deployed services are `keep_variants`, not `collapse`: sharing them would couple the deploys, which is worse than the repetition.",
            resolved,
          ]
            .filter((line) => line !== "")
            .join("\n"),
          criteria: duplicateVocabulary.verdict,
        }),
        consequence: Decision.rate({
          instructions: [
            `Would a reader be better off if the declarations named by \`${refs}\` were one?`,
            "Answer about the EFFECT of the duplication, not about whether it exists. Two identical helpers that nobody will ever change are still one thing.",
            "Choose the level that fits, lowest to highest:",
            "`no_difference`: nobody would notice either way; the copies are stable and independent.",
            "`slightly_clearer`: one copy would read a little better, but nothing is at stake.",
            "`meaningfully_better`: sharing one would remove work or stop the copies diverging.",
            "`removes_a_hazard`: the copies will diverge and cause a bug, or already have.",
          ].join("\n"),
          criteria: duplicateVocabulary.consequenceLevels,
        }),
        canonical: Decision.classify({
          instructions: `If one of them should be kept, which one? The declarations are \`${refs}\`. Choose the declaration that best fits this codebase's conventions, its location, and its name.`,
          criteria,
        }),
        difference: Decision.classify({
          instructions: [
            `The declarations named by \`${refs}\` are not identical. What IS the difference between them?`,
            "Inspect their `source`.",
            "Choose `value` when they are one thing with a different constant, option or parameter, so one of them could take the other's value.",
            "Choose `meaning` when they are two concepts that happen to read alike.",
          ].join("\n"),
          criteria: duplicateVocabulary.difference,
        }),
        // The prescription, asked rather than tabulated. The operation options
        // the graph permits are in the criteria, so the model cannot propose a
        // merge across a package boundary -- the same guard `permitted` gave the
        // table, now enforced on the answer instead of before the question.
        prescription: Decision.classify({
          instructions: [
            `What should be done about the declarations named by \`${refs}\`?`,
            "Answer with the ONE thing a reviewer should do, having read what they are and where they live.",
            `The operations the import graph permits here are: ${operations.join(", ") || "none"}. \`atoms[${facts}].files\` lists every file involved.`,
            "Choose `share_a_contract` when the copies cross a boundary that must not import across, and both sides must still agree.",
            "Choose `leave_it` when the repetition is framework-required or stable enough that changing it costs more than it saves.",
          ].join("\n"),
          criteria: duplicateVocabulary.prescription,
        }),
        operation: Decision.classify({
          instructions: [
            `What should happen to the declarations named by \`${refs}\`?`,
            "Answer with the one that fits what they ARE and where they live.",
            "Choose `no_issue` when nothing should change.",
          ].join("\n"),
          criteria: {
            ...Object.fromEntries(
              operations.map((operation) => [operation, describeOperation(operation)]),
            ),
            no_issue: "Leave them as they are.",
          },
        }),
      },
      read: (answers) => {
      const verdict = answers["verdict"]
      if (verdict === undefined || !("label" in verdict)) return undefined
      const redundant = answers["redundant"]
      const redundancy =
        redundant !== undefined && "probability" in redundant
          ? redundant.probability
          : (verdict.confidence ?? 1)
      const role = answers["role"]
      const relationship = answers["relationship"]
      // The prescription is the model's answer; the table that used to derive it
      // is gone. `prescriptionFor` remains for the unverified path and for tests.
      const prescribed = answers["prescription"]
      const prescriptionKind =
        prescribed !== undefined && "label" in prescribed ? prescribed.label : undefined
      const prescription =
        prescribed !== undefined && "label" in prescribed
          ? // SAFETY: the label is the model's choice among this vocabulary's own
            // criteria, which DecisionModel validated before returning it, so the
            // index is always a key of the table. `?? undefined` keeps an outside
            // label a miss rather than a defect.
            duplicateVocabulary.prescription[
              prescribed.label as keyof typeof duplicateVocabulary.prescription
            ] ?? undefined
          : role === undefined || !("label" in role) || relationship === undefined || !("label" in relationship)
            ? undefined
            : prescriptionFor({ role: role.label, relationship: relationship.label })
      // Ranked by consequence, gated by redundancy. A finding that does not
      // matter is still a finding and still reported; it sorts last.
      //
      // The Score answers with a probability-weighted position on its levels, so
      // the position is normalised onto [0, 1] -- the same range a Noul would
      // have given, with the degrees kept.
      const consequence = answers["consequence"]
      const span = duplicateVocabulary.consequenceLevels.length - 1
      const score =
        consequence !== undefined && "rating" in consequence
          ? span <= 0
            ? 0
            : consequence.rating / span
          : redundancy
      const margin = marginOfAnswer(verdict)
      const confidence = verdict.confidence ?? 1

      // The difference between the copies, and the model's own read of the
      // operation. The two together settle it, and their disagreement is
      // reported rather than resolved.
      const differenceAnswer = answers["difference"]
      const difference =
        differenceAnswer !== undefined &&
        "label" in differenceAnswer &&
        (differenceAnswer.label === "value" || differenceAnswer.label === "meaning")
          ? differenceAnswer.label
          : "unclear"
      const operationAnswer = answers["operation"]
      const proposed =
        operationAnswer !== undefined &&
        "label" in operationAnswer &&
        (operationAnswer.label === "merge" || operationAnswer.label === "move")
          ? operationAnswer.label
          : undefined
      const settled = settle({
        derived: derivedOperation({ candidate: "duplicated", oneThing: redundancy, difference }),
        proposed,
        margin: operationAnswer !== undefined && "label" in operationAnswer ? marginOfAnswer(operationAnswer) : 1,
        confidence:
          operationAnswer !== undefined && "confidence" in operationAnswer
            ? operationAnswer.confidence
            : undefined,
      })

      // `keep_variants` is a decision about the declarations; a decline is a
      // decision about the question. Both suppress the finding, and only the
      // second says the rule should not have asked.
      if (verdict.label === "keep_variants" || declined(verdict.label)) {
        return {
          keep: undefined,
          confidence,
          score,
          redundancy,
          margin,
          prescription,
          prescriptionKind,
          operation: undefined,
          agreement: "drop" as const,
          settled: "the model said " + verdict.label,
        }
      }
      const canonical = answers["canonical"]
      const index =
        canonical === undefined || !("label" in canonical)
          ? 0
          : Number.parseInt(canonical.label.replace("member_", ""), 10)
      return {
        keep: Number.isNaN(index) ? 0 : index,
        confidence,
        score,
        redundancy,
        margin,
        prescription,
        prescriptionKind,
        operation: settled.operation,
        agreement: settled.quality,
        settled: settled.reason,
      }
      },
    }
  })

/** The deepest directory every one of these files sits inside. */
const commonDirectory = (paths: ReadonlyArray<string>): string => {
  const split = paths.map((file) => file.split("/").slice(0, -1))
  const first = split[0]
  if (first === undefined) return "."
  let depth = 0
  for (let index = 0; index < first.length; index += 1) {
    if (split.every((parts) => parts[index] === first[index])) depth = index + 1
    else break
  }
  return depth === 0 ? "." : first.slice(0, depth).join("/")
}

/** The role and the relationship the two cluster members have. */
interface PrescriptionInput {
  readonly role: string
  readonly relationship: string
}

/**
 * What to do about it, from what the declaration IS and how the files relate.
 *
 * This is the whole judgement, and it is decided in code. The model answers two
 * questions it can actually answer -- what is this, and how do these files
 * relate -- and the prescription follows from the pair. No repository has to
 * declare its boundaries for this to work, which is the point: a hand-maintained
 * map of a codebase's architecture goes stale the moment someone moves a
 * directory, and the paths say the same thing for free.
 *
 * The two rows that matter are the same duplication with opposite answers. A
 * wire contract repeated across a service boundary is CORRECT -- two services
 * share a shape, not a module. A domain concept repeated across one is the
 * defect the architecture exists to prevent.
 */
export const prescriptionFor = ({ role, relationship }: PrescriptionInput): string => {
  if (relationship === "same_module" || relationship === "same_package") {
    return "Delete the copies and import one: these files can reach each other."
  }
  if (role === "wire_contract") {
    return "Expected. A contract that crosses a deployable boundary is duplicated by design: give it a shared contracts package if the two must agree, and leave it alone if they must not."
  }
  if (role === "domain_concept") {
    return "The same concept in two deployables that cannot import each other, which is the case a shared package exists for. Move the concept into one both depend on."
  }
  if (role === "framework_glue") {
    return "Framework shapes are repeated per file by construction. If these are framework glue, leave them."
  }
  return "Different deployables and not a contract: hoist the shared part into a package both can depend on, or accept the duplication."
}

/**
 * What to do about it, given who may import whom.
 *
 * Used when there is no judgement to read a role from -- an unverified finding
 * still deserves advice -- and when a repository has declared its layers, which
 * is a fact worth using even though it is no longer required.
 *
 * "Delete the copies and import one" is only advice if the copies can reach the
 * one being kept, and across a package boundary they usually cannot. On one
 * repository 78 of 261 duplicate findings told a Remix app to import a type from
 * a Fastify service, and 67 of those were the frontend and the backend pointing
 * at each other. The duplication was real and the prescription was impossible,
 * which is the worst combination: a reader who tries it learns to ignore the
 * tool.
 *
 * The relationship is decidable from the declared layers, so it is decided here
 * rather than asked about. The model answers whether the declarations are one
 * thing; where the one thing should LIVE is a fact about the repository.
 */
const prescription = (
  layers: ReadonlyArray<Layer>,
  cluster: Cluster,
  keep: Unit,
  drops: ReadonlyArray<Unit>,
): string => {
  if (drops.every((unit) => canImport({ layers, importer: unit.file, to: keep.file }))) {
    return `Delete or import instead of redeclaring: ${memberList(drops)}.`
  }
  const shared = sharedLayerFor(
    layers,
    cluster.members.map((member) => member.file),
  )
  if (shared !== undefined) {
    return `None of these may import the others, so hoist the declaration into ${shared.name} and import it from all of them: ${memberList(drops)}.`
  }
  return `These sit in layers that cannot see each other and share nothing below them. Extract a shared package, or accept the duplication as a contract: ${memberList(drops)}.`
}

const memberList = (units: ReadonlyArray<Unit>): string => {
  const shown = units.slice(0, policy.evidence.maxListedPaths)
  const rest = units.length - shown.length
  const listed = shown.map((unit) => `${unit.file}:${unit.location.line}`).join(", ")
  return rest > 0 ? `${listed} and ${rest} more` : listed
}

/**
 * A stable name for a finding, for comparing one run against the next.
 *
 * Membership and the kept symbol, never line numbers: code moves constantly and
 * a baseline that reports every edit as new is a baseline nobody reads.
 */
const identityOf = (ruleId: string, cluster: Cluster, keep: Unit): string =>
  [ruleId, keep.name, ...[...new Set(cluster.members.map((m) => m.file))].sort(Order.String)].join("\u0000")

/** Prescriptions that mean expected duplication: reported, but as a notice. */
const EXPECTED_DUPLICATION: ReadonlySet<string> = new Set(["leave_it", "share_a_contract"])

/** Every cluster rule reports through these. */
const CLUSTER_MESSAGES = messages({
  unverified: "{{subject}}.",
  unverified_help:
    "Keep `{{keep}}` ({{keepAt}}) and import it elsewhere. Not verified: {{reason}}.{{shape}} Duplicates: {{duplicates}}.",
  duplicate: "{{subject}} — keep `{{keep}}` in {{keepAt}}{{extra}}.",
  duplicate_help: "{{prescription}}{{shape}} {{dependents}}.{{review}}",
})

/** Bind a cluster rule's messages to a workspace's locator. */
export const clusterReporter = (rule: ClusterRule, workspace: Workspace): Report =>
  reporter(
    { id: rule.ruleId, severity: rule.severity, judged: true, messages: CLUSTER_MESSAGES, move: rule.move },
    locator(workspace),
  )

/** No judgement available: report the fact, say so, and never guess a canonical. */
export const unverifiedFinding = (
  report: Report,
  rule: ClusterRule,
  cluster: Cluster,
  reason = "no judgement was available",
): Diagnostic | undefined => {
  const keep = cluster.members[0]
  const drops = cluster.members.slice(1)
  const first = drops[0]
  if (keep === undefined || first === undefined) return undefined
  return report({
    about: first,
    messageId: "unverified",
    data: {
      subject: rule.nameOf(cluster),
      keep: keep.name,
      keepAt: keep.file + ":" + keep.location.line,
      reason,
      shape: shapeOnlyNote(cluster),
      duplicates: memberList(drops),
    },
    helpId: "unverified_help",
    identity: identityOf(rule.ruleId, cluster, keep),
    judged: false,
    severity: rule.severity,
  })
}

/**
 * The caveat a shape-only cluster earns.
 *
 * Empty when the cluster has types to stand on. Otherwise it says what the
 * finding actually rests on, because in a JavaScript codebase this is the COMMON
 * case rather than the exception: nothing in the declaration says what it
 * operates on, so two shapes matching is all the evidence there is. The finding
 * is still true; saying what it rests on is the difference between a weaker
 * finding and a misleading one.
 */
const shapeOnlyNote = (cluster: Cluster): string =>
  cluster.typed
    ? ""
    : " No member carries a type annotation, so only the shape could be compared."

/**
 * Who depends on the declaration being kept.
 *
 * This is the sentence that used to be a wish. "Keep X and import it here" is
 * only true advice if we know what imports the copy going away, and until the
 * graph existed we had never checked.
 */
const dependents = (imports: ImportGraph, unit: Unit): string => {
  const named = imports.importersOfName(unit.file, unit.name)
  const files = [...new Set(named.map((edge) => edge.importer))]
  if (files.length === 0) {
    return imports.importersOf.get(unit.file) === undefined
      ? "nothing in the analysed set imports this file"
      : `no file imports \`${unit.name}\` by name`
  }
  const shown = files.slice(0, policy.evidence.maxListedPaths).join(", ")
  const more =
    files.length > policy.evidence.maxListedPaths
      ? ` and ${files.length - policy.evidence.maxListedPaths} more`
      : ""
  return `${files.length} file${files.length === 1 ? "" : "s"} import \`${unit.name}\`: ${shown}${more}`
}

/** One cluster's plan, ready for the engine. */
export const planCluster = (
  rule: ClusterRule,
  cluster: Cluster,
  scope: Scope,
  workspace: Workspace,
): Effect.Effect<Plan<ClusterVerdict> | undefined, never, Atoms> =>
  Effect.gen(function* () {
    const described = describedMembers(cluster, scope)
    if (described.length === 0) return undefined
    const questionnaire = yield* rule.questionnaire(cluster, described, workspace)
    return {
      ruleId: rule.ruleId,
      subject: rule.nameOf(cluster),
      concerns: cluster.members.map((member) => member.file),
      atoms: questionnaire.atoms,
      decisions: questionnaire.decisions,
      violations: questionnaire.violations,
      read: questionnaire.read,
    }
  })

/* Turn a verdict into a finding, or into silence. Pure, so it is testable alone. */
/**
 * A candidate the rule looked at and did not report.
 *
 * Returned alongside the finding rather than counted separately, so the reason a
 * candidate was dropped is produced by the same code that decides to drop it. A
 * second pass that re-derives the reason is a second chance to disagree.
 */
export const dropOf = (
  rule: ClusterRule,
  cluster: Cluster,
  stage: DropStage,
  reason: string,
): Drop => ({ ruleId: rule.ruleId, subject: rule.nameOf(cluster), stage, reason })

/** Either a finding, or the reason there is none. Never both. */
export interface Result {
  readonly diagnostic?: Diagnostic
  readonly drop?: Drop
}

/** Turn a cluster's verdict into a finding, or into silence. */
export const findingFor = (
  rule: ClusterRule,
  workspace: Workspace,
  cluster: Cluster,
  verdict: ClusterVerdict | undefined,
  layers: ReadonlyArray<Layer>,
): Result => {
  const imports = workspace.imports
  const report = clusterReporter(rule, workspace)
  if (verdict === undefined) {
    const fallback = rule.onUnavailable === "report" ? unverifiedFinding(report, rule, cluster) : undefined
    return fallback === undefined
      ? { drop: dropOf(rule, cluster, "unreadable", "no judgement available") }
      : { diagnostic: fallback }
  }
  if (verdict.keep === undefined) {
    return { drop: dropOf(rule, cluster, "declined", "the model found nothing to change") }
  }

  // A verdict that fails its gates is not a worse verdict, it is not a verdict.
  // Handling it exactly like an absent answer means one gate serves every rule,
  // and each rule keeps the degrade behaviour it already declared: a provable
  // finding is still reported, marked unverified with the reason; a guessed one
  // stays silent. The gate never has to know which rule it is in.
  const quality = qualityOf({
    score: verdict.redundancy,
    margin: verdict.margin,
    confidence: verdict.confidence,
  })
  if (quality.quality === "drop") {
    const fallback =
      rule.onUnavailable === "report" ? unverifiedFinding(report, rule, cluster, quality.reason) : undefined
    return fallback === undefined
      ? { drop: dropOf(rule, cluster, "gated", quality.reason) }
      : { diagnostic: fallback }
  }

  // Two ways to land in review: the redundancy gate was not decisive, or the
  // table and the model disagreed about the operation.
  const review = quality.quality === "review" || verdict.agreement === "review"

  const keep = cluster.members[verdict.keep] ?? cluster.members[0]
  if (keep === undefined) {
    return { drop: dropOf(rule, cluster, "no_evidence", "the chosen member is not in the cluster") }
  }
  const drops = cluster.members.filter((member) => member !== keep)
  const first = drops[0]
  if (first === undefined) {
    return { drop: dropOf(rule, cluster, "no_evidence", "keeping every member leaves nothing to drop") }
  }

  const names = namesOf(cluster)
  const extra =
    names.length > 1 ? ` (also named ${names.filter((name) => name !== keep.name).join(", ")})` : ""
  // The smaller form, and what it costs. The cascade is a graph walk, so it is
  // exact, and an operation with no cascade is an operation that costs nothing.
  const repair =
    verdict.operation === undefined
      ? undefined
      : {
          operation: verdict.operation,
          keep: keep.location,
          remove: drops.map((member) => member.location),
          cascade: cascadeOf(workspace, keep, drops),
          complete: true,
          settled: verdict.settled,
        }
  return {
    diagnostic: report({
      about: first,
      messageId: "duplicate",
      data: {
        subject: rule.nameOf(cluster),
        keep: keep.name,
        keepAt: keep.file + ":" + keep.location.line,
        extra,
        // The model's answer when there is one, the declared layers when there
        // are not. A repository that configures nothing still gets advice.
        prescription: verdict.prescription ?? prescription(layers, cluster, keep, drops),
        shape: shapeOnlyNote(cluster),
        dependents: dependents(imports, keep),
        review: review ? " For review: " + quality.reason + "." : "",
      },
      helpId: "duplicate_help",
      identity: identityOf(rule.ruleId, cluster, keep),
      confidence: verdict.confidence,
      score: verdict.score,
      judged: true,
      repair,
      severity:
        review || EXPECTED_DUPLICATION.has(verdict.prescriptionKind ?? "")
          ? "info"
          : rule.severity,
    }),
  }
}

/*
 * Ask about many clusters and turn the answers into findings.
 *
 * One call per cluster, and the cache is the reason: the key is the state and the
 * questions, so a call that carried several clusters would lose every cluster's
 * verdict when one of them changed. Per-candidate calls keep a verdict keyed to
 * its own evidence.
 *
 * This is deliberately NOT the speculative fan-out the TypeSafe docs measure at
 * 11.5x cheaper, and the difference is worth stating rather than copying the
 * pattern by name: fan-out amortises ONE state across many questions, while each
 * candidate here has its OWN state, so a batched call would send the same total
 * bytes and save only round trips. `ask.ts` is where fan-out belongs, and it is
 * used there -- one state, one decision per candidate.
 *
 * `requestConcurrency` overlaps the calls, and the decision layer serializes its
 * own cache writes.
 */
/** What a rule's assistant pass produced: the findings, and the funnel. */
export interface Assessment {
  readonly diagnostics: ReadonlyArray<Diagnostic>
  readonly drops: ReadonlyArray<Drop>
}

/** A cluster's plans, and the clusters that could not be described. */
export interface ClusterPhase {
  readonly unreadable: ReadonlyArray<Drop>
  readonly planned: ReadonlyArray<{ readonly cluster: Cluster; readonly plan: Plan<ClusterVerdict> }>
}

/**
 * Build every cluster's plan, without answering anything.
 *
 * The phase is separate from the answer so the engine can collect plans from
 * every planned rule and answer them in one request. A rule that answered its own
 * plans could not share a request with another, which is the whole point.
 */
export const planClusters = (
  rule: ClusterRule,
  clusters: ReadonlyArray<Cluster>,
  scope: Scope,
  workspace: Workspace,
): Effect.Effect<ClusterPhase, never, Atoms> =>
  Effect.gen(function* () {
    const unreadable: Array<Drop> = []
    const planned: Array<{ readonly cluster: Cluster; readonly plan: Plan<ClusterVerdict> }> = []
    const built = yield* Effect.forEach(clusters, (cluster) => planCluster(rule, cluster, scope, workspace), {
      concurrency: "unbounded",
    })
    clusters.forEach((cluster, index) => {
      const plan = built[index]
      if (plan === undefined) {
        unreadable.push(
          dropOf(rule, cluster, "no_evidence", "no member could be described to the model"),
        )
        return
      }
      planned.push({ cluster, plan })
    })
    return { unreadable, planned }
  })

/** Turn a phase's answers into findings, in the phase's own order. */
export const readClusters = (
  rule: ClusterRule,
  workspace: Workspace,
  phase: ClusterPhase,
  layers: ReadonlyArray<Layer>,
  answers: ReadonlyArray<unknown>,
): Assessment => {
  // SAFETY: the phase built these plans, so every answer is a ClusterVerdict its
  // own questionnaire produced. The engine erased the type only to batch rules
  // together, and the order is the phase's own order.
  const verdicts = answers as ReadonlyArray<ClusterVerdict | undefined>
  const diagnostics: Array<Diagnostic> = []
  const drops: Array<Drop> = [...phase.unreadable]
  phase.planned.forEach((entry, index) => {
    const outcome = findingFor(rule, workspace, entry.cluster, verdicts[index], layers)
    if (outcome.diagnostic !== undefined) diagnostics.push(outcome.diagnostic)
    if (outcome.drop !== undefined) drops.push(outcome.drop)
  })
  return { diagnostics, drops }
}

/**
 * Plan and answer one rule's clusters, when the rule does not want batching.
 *
 * A planned rule does not use this; it hands its plans to the engine. This is for
 * a rule that is the only judge in a run, or a test that wants one call's worth of
 * behaviour.
 */
export const assessClusters = (
  rule: ClusterRule,
  workspace: Workspace,
  clusters: ReadonlyArray<Cluster>,
  layers: ReadonlyArray<Layer> = [],
  scope: Scope = everyFile,
): Effect.Effect<
  Assessment,
  AiError.AiError,
  Atoms | PlanAnswers | DecisionModel.DecisionModel
> =>
  Effect.gen(function* () {
    const phase = yield* planClusters(rule, clusters, scope, workspace)
    if (phase.planned.length === 0) return { diagnostics: [], drops: phase.unreadable }
    // A fact-based rule still reports its facts when the model was never reached;
    // a guess-based rule steps aside and the engine reports it as skipped.
    const verdicts = yield* answerPlans(phase.planned.map((entry) => entry.plan)).pipe(
      Effect.catchIf(
        (error) => rule.onUnavailable === "report" || !isUnreachable(error),
        () => Effect.succeed(phase.planned.map(() => undefined)),
      ),
    )
    return readClusters(rule, workspace, phase, layers, verdicts)
  })
