import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Workspace } from "../workspace.ts"
import { words } from "./naming-drift.ts"

const RULE_ID = "joggle/field-type-drift"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["drift", "two_concepts"] } as const

// One field name declared with two incompatible types.
//
// A field name is a promise about meaning. When `projectId` is a `string` in one
// declaration and a `number` in another, code that moves between them compiles
// against whichever it imported and fails against the other.
//
// What is deterministic is the detection. Field types are compared after the
// index's own resolution (indexed access, local alias, union), a nullability
// difference counts, raw mirrors are skipped, and only declarations that can
// reach each other are related. What is a JUDGEMENT is what the disagreement
// means: one concept declared twice, two concepts sharing a name, or a deliberate
// difference that breaks nothing.
//
// That judgement is the one this rule used to make for the reader, and it is the
// reason the migration is cautious: an earlier experiment asking a concept
// question here produced MORE findings, not fewer (the model answered "one
// concept" about 85% of the time), so the question is worded to let it decline
// (`compatible`) and a non-decisive answer is flagged rather than printed. See
// `docs/type-resolution.md`.

const related = (
  one: Declaration,
  two: Declaration,
  workspace: Workspace,
  reachable: ReadonlySet<string>,
  isTest: (file: string) => boolean,
): boolean => {
  if (one.file === two.file) return true
  if (isTest(one.file) !== isTest(two.file)) return false
  if (reachable.has(one.file + "\u0000" + two.file)) return true
  if (reachable.has(two.file + "\u0000" + one.file)) return true
  const packageOf = (file: string): string => {
    const cut = file.lastIndexOf("/")
    return workspace.manifests.get(cut === -1 ? "." : file.slice(0, cut))?.name ?? ""
  }
  const leftPackage = packageOf(one.file)
  return leftPackage !== "" && leftPackage === packageOf(two.file)
}

interface Declaration {
  readonly type: string
  readonly unitName: string
  readonly file: string
  readonly line: number
}

/** One field whose two declarations disagree. */
interface Drift {
  readonly field: string
  readonly oneDecl: Declaration
  readonly twoDecl: Declaration
}

export const fieldTypeDrift: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "One field name declared with different, incompatible types.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    two_types: "{{unit}} has a field declared with two incompatible types.",
    single_drift:
      "`{{field}}` is `{{leftType}}` in {{leftUnit}} and `{{rightType}}` in {{rightUnit}}.",
    many_drifts:
      "{{count}} field(s) of {{unit}} disagree with another declaration: {{fields}}.",
    drift_help: "{{lead}}{{where}}.{{unverified}}",
  }),
  plan: Effect.fn("joggle/field-type-drift")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(fieldTypeDrift, locator(workspace))
    const byField = new Map<string, Map<string, Array<Declaration>>>()
    for (const unit of workspace.units) {
      if (unit.kind !== "interface" && unit.kind !== "type") continue
      for (const [field, annotation] of unit.fieldTypes) {
        const type = annotation.replace(/^\s*:\s*/, "").replace(/\s+/g, " ").trim()
        if (type === "" || type === field) continue
        const types = byField.get(field) ?? new Map<string, Array<Declaration>>()
        const declarations = types.get(type) ?? []
        declarations.push({ type, unitName: unit.name, file: unit.file, line: unit.location.line })
        types.set(type, declarations)
        byField.set(field, types)
      }
    }

    if (byField.size === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], ["no interface or type alias declared a field with a type to compare"]),
      }
    }

    const reachable = new Set<string>()
    for (const edge of workspace.imports.edges) {
      if (edge.resolution === "resolved") reachable.add(edge.importer + "\u0000" + edge.to)
    }
    const isTest = (file: string): boolean => policy.testFiles.test(file)
    const minWords = policy.fieldTypeDrift.minWords

    // Group by the declaration the finding is anchored to: a type with five
    // drifting fields is one thing a reader has to decide, not five.
    const groups = new Map<string, { file: string; line: number; unitName: string; drifts: Array<Drift> }>()
    let unrelated = 0
    let drifted = 0
    // The fact this rule collects: one field name whose declared annotation
    // differs between two declarations. Whether that difference is drift or a
    // deliberate variant is the QUESTION -- this used to be decided in code, by a
    // little text type-parser (a word-subset test for compatibility, a regex for
    // `null`, name patterns for raw mirrors), which is meaning decided in code
    // (docs/rule-coupling.md). The generator keeps the fact; the model keeps the
    // judgement it was already being asked for.
    for (const [field, types] of byField) {
      if (types.size < 2) continue
      // A single-word field is a generic slot: `id`, `name`, `type`, `files`
      // mean whatever their declaration says, and two of them with different
      // types are two concepts, not one that drifted. A name of two words or
      // more is a concept -- `supervisorRate`, `regularPayTotal` -- and one
      // concept with two types is the defect. The policy says this; the rule
      // read the map and forgot it, so every `paths`, `id` and `plan` in the
      // tree was compared as if it named a concept.
      if (words(field).length < minWords) continue
      const entries = [...types.values()]
        .map((declarations) => declarations[0])
        .filter((declaration): declaration is Declaration => declaration !== undefined)
      let chosen: readonly [Declaration, Declaration] | undefined
      for (let left = 0; left < entries.length && chosen === undefined; left += 1) {
        for (let right = left + 1; right < entries.length; right += 1) {
          const one = entries[left]
          const two = entries[right]
          if (one === undefined || two === undefined) continue
          if (one.file === two.file && one.unitName === two.unitName) continue
          if (!related(one, two, workspace, reachable, isTest)) {
            unrelated += 1
            continue
          }
          chosen = [one, two]
          break
        }
      }
      if (chosen === undefined) continue
      const left = chosen[0]
      const right = chosen[1]
      if (scope.changed !== undefined && !(scope.changed.has(left.file) || scope.changed.has(right.file))) {
        continue
      }
      drifted += 1
      const key = left.file + "\u0000" + String(left.line)
      const group = groups.get(key) ?? { file: left.file, line: left.line, unitName: left.unitName, drifts: [] }
      group.drifts.push({ field, oneDecl: left, twoDecl: right })
      groups.set(key, group)
    }

    if (groups.size === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            byField.size + " field name(s) across the type declarations; none with incompatible types" +
              (unrelated > 0
                ? ", " + unrelated + " skipped because the declarations cannot reach each other"
                : ""),
          ]),
      }
    }

    const candidates = [...groups.values()]
    const judged = candidates.slice(0, policy.fieldTypeDrift.maxFindings)
    const overBudget: ReadonlyArray<Drop> = candidates
      .slice(policy.fieldTypeDrift.maxFindings)
      .map((group) => ({
        ruleId: RULE_ID,
        subject: group.unitName + " (" + group.file + ":" + String(group.line) + ")",
        stage: "budget" as const,
        reason: "past the budget of " + String(policy.fieldTypeDrift.maxFindings) + " declarations",
      }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(judged, (group) =>
      Effect.gen(function* () {
        // The state is the drifts themselves, bounded, each with the two
        // declarations and the resolved types, which is what the question needs.
        const drifts = group.drifts.slice(0, 5).map((drift) => ({
          field: drift.field,
          left: { unit: drift.oneDecl.unitName, file: drift.oneDecl.file, line: drift.oneDecl.line, type: drift.oneDecl.type },
          right: { unit: drift.twoDecl.unitName, file: drift.twoDecl.file, line: drift.twoDecl.line, type: drift.twoDecl.type },
        }))
        const id = yield* atoms.add({ declaration: { unit: group.unitName, file: group.file, line: group.line }, drifts })
        const plan: Plan<DecisionAnswers> = {
          ruleId: RULE_ID,
          subject: group.unitName + " (" + group.file + ":" + String(group.line) + ")",
          concerns: [...new Set(group.drifts.flatMap((drift) => [drift.oneDecl.file, drift.twoDecl.file]))],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].drifts\` lists field(s) declared with two different types in two declarations that can reach each other.`,
                "What does each disagreement mean?",
                "Answer `drift` when the same concept is written with two incompatible types, so code that moves between the declarations breaks.",
                "Answer `two_concepts` when one name has been reused for two different things, so one of them should be renamed.",
                "Answer `compatible` when the difference is deliberate and nothing breaks -- a raw or unparsed mirror, a wider or partial variant, a type that only reads differently.",
              ].join("\n"),
              criteria: {
                drift: "One concept, two incompatible types. Share one declaration of it.",
                two_concepts: "One name, two different things. Rename one.",
                compatible: "A deliberate difference. Nothing breaks.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { group, id, plan }
      }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((value, index) => {
          const { group } = value
          const subject = group.unitName + " (" + group.file + ":" + String(group.line) + ")"
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, group, undefined, "no judgement was available", false, false))
            return
          }
          if (verdict.label !== "drift" && verdict.label !== "two_concepts") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason: "the difference is deliberate and nothing breaks",
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
              subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          const review = quality.quality === "review"
          const renamed = verdict.label === "two_concepts"
          diagnostics.push(findingFor(report, group, verdict.confidence, undefined, renamed, review))
        })
        return outcome(
          diagnostics,
          [
            byField.size + " field name(s) across the type declarations; " + drifted + " with incompatible types",
            ...(unrelated > 0
              ? [
                  unrelated +
                    " were skipped: the two declarations are in different packages and neither imports the other",
                ]
              : []),
            ...budgetNote({
              unitKind: "declarations",
              judged: policy.fieldTypeDrift.maxFindings,
              candidates: candidates.length,
              sample: candidates
                .slice(policy.fieldTypeDrift.maxFindings)
                .map((group) => group.unitName),
            }),
          ],
          drops,
        )
      },
    }
  }),
}

const findingFor = (
  report: Report,
  group: { readonly file: string; readonly line: number; readonly unitName: string; readonly drifts: ReadonlyArray<Drift> },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  renamed = false,
  review = false,
): Diagnostic => {
  const first = group.drifts[0]
  if (first === undefined) {
    return report({
      about: { file: group.file, line: group.line, column: 1 },
      messageId: "two_types",
      data: { unit: group.unitName },
      judged: false,
    })
  }
  const where = group.drifts
    .map(
      (drift) =>
        drift.field +
        ": " +
        drift.oneDecl.file +
        ":" +
        String(drift.oneDecl.line) +
        " and " +
        drift.twoDecl.file +
        ":" +
        String(drift.twoDecl.line),
    )
    .join("; ")
  const listed =
    group.drifts
      .slice(0, 3)
      .map((drift) => "`" + drift.field + "` (`" + drift.oneDecl.type + "` vs `" + drift.twoDecl.type + "`)")
      .join(", ") +
    (group.drifts.length > 3 ? ", and " + String(group.drifts.length - 3) + " more" : "")
  return report({
    about: { file: group.file, line: group.line, column: 1 },
    messageId: group.drifts.length === 1 ? "single_drift" : "many_drifts",
    data: {
      unit: group.unitName,
      count: group.drifts.length,
      fields: listed,
      field: first.field,
      leftType: first.oneDecl.type,
      leftUnit: first.oneDecl.unitName,
      rightType: first.twoDecl.type,
      rightUnit: first.twoDecl.unitName,
      lead: renamed
        ? "One name, two different things. Rename one of them so each field name means one thing. "
        : "One field name, two incompatible types. If they are one concept, share one declaration of it; if they are two concepts, give them two names. ",
      where,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "drift_help",
    identity: [
      RULE_ID,
      group.file,
      String(group.line),
      ...group.drifts.map((drift) => drift.field).sort((left, right) => left.localeCompare(right)),
    ].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })
}