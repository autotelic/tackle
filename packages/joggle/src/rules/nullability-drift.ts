import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { lineAt } from "../cascade.ts"
import { type PlannedCandidate } from "../plans.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import { lineStarts, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/nullability-drift"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["drift"] } as const

// One column, two nullabilities.
//
// `field-type-drift` compares two TypeScript declarations. This compares a type
// whose nullability comes from somewhere else: the database. A column the
// migration leaves nullable and a schema that requires it is a decode that fails
// the first time real data arrives.
//
// The mapping is explicit and OPT-IN, because it is not derivable: the row schema
// reads `payroll_crew.shakti_user_id` into a field called `person_id`, an alias in
// the query. A repository annotates the field with
// `.annotate({ sourceColumn: 'table.column' })`.
//
// Both halves -- the migration's `.notNullable()` chain and the schema's
// `Schema.NullOr` -- are specifications read from the source, so the DISAGREEMENT
// is a fact. Whether it is a defect, or a null that is data the adapter handles,
// is the judgement, and it is the one the help text used to hand to the reader.
export const nullabilityDrift: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A column nullable in the database and required in a schema, or the reverse.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    nullable_mismatch:
      "`{{source}}` is {{columnState}} in the migration and `{{field}}` is {{schemaState}} in the schema, so the database can hold a value the schema rejects{{tail}}.",
    nullable_mismatch_help:
      "The column is declared at {{columnAt}}. Make the schema agree with the migration (or the migration with the schema), or, if a null here is data rather than drift, say what the adapter does with it and pin the decision.{{unverified}}",
  }),
  plan: Effect.fn("joggle/nullability-drift")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(nullabilityDrift, locator(workspace))
    // Every column a migration declares, by `table.column`. Later migrations win:
    // they are timestamp-named, so path order is chronological order.
    const columns = new Map<string, { nullable: boolean; file: string; line: number }>()
    const files = [...workspace.files].sort((left, right) => left.path.localeCompare(right.path))
    for (const file of files) {
      const starts = lineStarts(file.text)
      for (const column of file.facts.columns) {
        columns.set(column.table + "." + column.column, {
          nullable: column.nullable,
          file: file.path,
          line: lineAt(starts, column.start),
        })
      }
    }

    const candidates: Array<{
      source: string
      field: string
      schemaNullable: boolean
      column: { nullable: boolean; file: string; line: number }
      schema: { file: string; line: number }
    }> = []
    let annotated = 0
    for (const file of workspace.files) {
      const starts = lineStarts(file.text)
      for (const object of file.facts.objects) {
        if (!object.declared) continue
        for (const [field, source] of Object.entries(object.sources)) {
          const column = columns.get(source)
          if (column === undefined) continue
          annotated += 1
          if (scope.changed !== undefined && !scope.changed.has(file.path) && !scope.changed.has(column.file)) {
            continue
          }
          const schemaNullable = object.nullable.includes(field)
          if (schemaNullable === column.nullable) continue
          candidates.push({
            source,
            field,
            schemaNullable,
            column,
            schema: { file: file.path, line: lineAt(starts, object.start) },
          })
        }
      }
    }

    if (annotated === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no schema field names its source column, so there was nothing to compare -- annotate with .annotate({ sourceColumn: 'table.column' }) to opt in",
          ]),
      }
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            annotated + " schema field(s) named a source column; all agree with the migration on nullability",
          ]),
      }
    }

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(candidates, (candidate) =>
      Effect.gen(function* () {
        const id = yield* atoms.add({
          source: candidate.source,
          field: candidate.field,
          schemaNullable: candidate.schemaNullable,
          columnNullable: candidate.column.nullable,
          schema: candidate.schema,
          column: { file: candidate.column.file, line: candidate.column.line },
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: RULE_ID,
          subject: candidate.source + " / " + candidate.field,
          concerns: [candidate.schema.file, candidate.column.file],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].source\` is \`${candidate.source}\`. The migration declares it ${candidate.column.nullable ? "nullable" : "required"} (\`atoms[${id}].columnNullable\`), and the schema field \`atoms[${id}].field\` is ${candidate.schemaNullable ? "nullable" : "required"} (\`atoms[${id}].schemaNullable\`).`,
                "Is that disagreement a defect, or is a null here data that the adapter handles?",
                "Answer `drift` when the schema should agree with the migration: the database can hold a null the schema rejects, or the schema accepts a null the database cannot.",
                "Answer `handled` when a null here is data rather than drift and the adapter does something deliberate with it.",
                "Answer `mismapped` when the field does not in fact read that column, so the annotation is wrong.",
              ].join("\n"),
              criteria: {
                drift: "The two should agree. Make the schema (or the migration) match.",
                handled: "A null is data, and the adapter handles it deliberately.",
                mismapped: "The field does not read that column.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { candidate, id, plan } satisfies PlannedCandidate<typeof candidate>
      }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        planned.forEach((value, index) => {
          const { candidate } = value
          const subject = candidate.source + " / " + candidate.field
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, candidate, undefined, "no judgement was available", false))
            return
          }
          if (verdict.label !== "drift") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "handled"
                  ? "a null here is data the adapter handles"
                  : "the field does not read that column",
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
          diagnostics.push(findingFor(report, candidate, verdict.confidence, undefined, review))
        })
        return outcome(diagnostics, [
          annotated +
            " schema field(s) named a source column; " +
            diagnostics.length +
            " of " +
            candidates.length +
            " disagreement(s) reported",
        ], drops)
      },
    }
  }),
}

const findingFor = (
  report: Report,
  candidate: {
    readonly source: string
    readonly field: string
    readonly schemaNullable: boolean
    readonly column: { readonly nullable: boolean; readonly file: string; readonly line: number }
    readonly schema: { readonly file: string; readonly line: number }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: { file: candidate.schema.file, line: candidate.schema.line, column: 1 },
    messageId: "nullable_mismatch",
    data: {
      source: candidate.source,
      field: candidate.field,
      columnState: candidate.column.nullable ? "nullable" : "required",
      schemaState: candidate.schemaNullable ? "nullable" : "required",
      tail: candidate.column.nullable ? "" : ", or the schema accepts one the database cannot",
      columnAt: candidate.column.file + ":" + String(candidate.column.line),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "nullable_mismatch_help",
    identity: [RULE_ID, candidate.source, candidate.field].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : "warn",
  })