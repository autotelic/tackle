import { Effect, Order, Schema } from "effect"
import { Decision } from "effect/ai"

import { Atoms } from "../atoms.ts"
import { clusterOf, type Cluster } from "../cluster.ts"
import { policy } from "../policy.ts"
import { budgetNote, inScope, outcome, qualityOf, type DecisionAnswers, type PlannedRule, type Scope } from "../rule.ts"
import { locator, messages, reporter, type Reporter } from "../reporting.ts"
import type { Diagnostic, Drop, JudgementPanel } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

/**
 * Same table, two writers.
 *
 * The finding this rule hunts came out of a real review: one endpoint checked
 * what the granter held before granting; a sibling endpoint wrote the same
 * authorization tables and checked only that the ids existed. Both files were
 * clean, both tests passed, and no single-file rule can see the pair -- the
 * defect is the DIFFERENCE between two writers, which is invisible from inside
 * either one.
 *
 * So the candidate is a cross-file fact (two declarations write one storage
 * table) and the judgement is the model's: do these writers carry the same
 * invariants -- tenant scope, ownership, an escalation check, validation -- or
 * does one accept what another refuses? The rule never names which writer is
 * wrong; it names the table and hands a person the pair.
 *
 * The join is a string literal, not a resolved type, so it is exact but shallow:
 * a table renamed through a constant is invisible to it. That is the honest
 * limit of a `knex("table")` scan, and the finding's wording says the evidence
 * is the literal.
 */

/** One write path's verdict: how sure the model is that the invariants differ. */
interface TableVerdict {
  /** P(the writers to this table enforce materially different invariants). */
  readonly drift: number
  readonly settled: string
  readonly panel: JudgementPanel
}

const MESSAGES = messages({
  drift:
    "`{{table}}` is written from {{count}} places that may not carry the same invariants: {{writers}}.{{review}}",
  drift_help:
    "Two write paths to one table are one policy carried twice. Read both writers beside each other and check the guards a write needs: tenant scope, ownership, the escalation rule, validation. Extract one guard both call, or record why they differ. The join is the table-name literal, so confirm the two writes really target the same table.",
  unverified:
    "`{{table}}` is written from {{count}} places: {{writers}}. Not judged: {{reason}}.",
  unverified_help: "Read both writers beside each other and check that they enforce the same guards on a write.",
})

/** A write to a table: `knex("…")` followed by a mutating call. */
const WRITE_CALL = /\.insert\(|\.update\(|\.del\(|\.onConflict\(|\.returning\(/

/** The table a declaration names, from the literal — the only join this rule trusts. */
const TABLE_LITERAL = /\bknex\s*\(\s*["']([a-z_][\w.]*?)["']/g

const tablesOf = (unit: Unit): ReadonlyArray<string> => {
  if (!WRITE_CALL.test(unit.text)) return []
  const names = new Set<string>()
  for (const match of unit.text.matchAll(TABLE_LITERAL)) names.add(match[1] ?? "")
  names.delete("")
  return [...names]
}

const tablesWritten = (
  workspace: Workspace,
  scope: Scope,
): ReadonlyArray<{ readonly table: string; readonly cluster: Cluster }> => {
  const byTable = new Map<string, Array<Unit>>()
  for (const unit of workspace.units) {
    if (unit.tokens.length < policy.tableInvariants.minTokens) continue
    if (!inScope(scope, unit.file)) continue
    for (const table of tablesOf(unit)) {
      const existing = byTable.get(table)
      if (existing === undefined) byTable.set(table, [unit])
      else existing.push(unit)
    }
  }
  const clusters: Array<{ readonly table: string; readonly cluster: Cluster }> = []
  for (const [table, members] of byTable) {
    if (members.length < 2) continue
    if (new Set(members.map((member) => member.file)).size < 2) continue
    clusters.push({ table, cluster: clusterOf(members, false, 0) })
  }
  return clusters.sort(
    (left, right) =>
      right.cluster.members.length - left.cluster.members.length ||
      left.table.localeCompare(right.table),
  )
}

/** One declaration as the model sees it — the same shape the cluster rules send. */
const evidence = (member: Unit): Schema.Json => ({
  symbol: member.name,
  kind: member.kind,
  path: member.file,
  line: member.location.line,
  source: member.text.slice(0, policy.evidence.maxSourceChars),
  documented: member.doc !== undefined,
})

/** Largest pairs first when a budget bites, so the note names what matters. */
const sampleOf = (clusters: ReadonlyArray<{ readonly table: string; readonly cluster: Cluster }>) =>
  clusters
    .slice(0, 3)
    .map((entry) => `${entry.cluster.members.length}× \`${entry.table}\``)

const identityOf = (ruleId: string, cluster: Cluster): string =>
  [
    ruleId,
    ...[...new Set(cluster.members.map((member) => `${member.file}:${member.name}`))].sort(
      Order.String,
    ),
  ].join("\u0000")

const writerList = (cluster: Cluster): string =>
  cluster.members
    .slice(0, policy.evidence.maxListedPaths)
    .map((member) => `${member.name} (${member.file}:${member.location.line})`)
    .join(", ")

const reviewerFor =
  (workspace: Workspace): Reporter =>
  reporter(
    {
      id: "joggle/table-invariants",
      severity: "warn",
      judged: true,
      messages: MESSAGES,
      move: "contract",
    },
    locator(workspace),
  )

/** The question, asked once per table: same guards, or does one accept what another refuses? */
const questionnaire = (input: {
  readonly table: string
  readonly described: ReadonlyArray<Unit>
}): Effect.Effect<
  {
    readonly atoms: ReadonlyArray<string>
    readonly decisions: Record<string, Decision.Any>
    readonly violations: Readonly<Record<string, ReadonlyArray<string>>>
    readonly read: (answers: DecisionAnswers) => TableVerdict | undefined
  },
  never,
  Atoms
> =>
  Effect.gen(function* () {
    const atoms = yield* Atoms
    const ids = yield* atoms.addAll(input.described.map((member) => evidence(member)))
    const facts = yield* atoms.add({
      table: input.table,
      count: input.described.length,
      files: [...new Set(input.described.map((member) => member.file))],
    })
    const refs = ids.map((id) => `atoms[${id}]`).join(", ")
    return {
      atoms: [...ids, facts],
      violations: { drift: [] },
      decisions: {
        drift: Decision.probability({
          instructions: [
            `The declarations named by \`${refs}\` each write to the same storage table (\`${input.table}\`). Each has a \`source\`.`,
            "Two write paths to one table are one policy carried twice: a tenant scope, an ownership check, an escalation rule, a validation the other skips.",
            "Answer with the probability that one of these writes accepts what another refuses — materially different invariants — rather than the writers carrying the same guard.",
            "Answer low when the guards plainly agree, or when the writes differ in kind (an insert beside a delete) with no invariant shared to drift.",
          ].join(" "),
        }),
      },
      read: (answers) => {
        const drift = answers["drift"]
        if (drift === undefined || !("probability" in drift)) return undefined
        return {
          drift: drift.probability,
          settled: "the model judged how far the writers' invariants may differ",
          panel: {
            answers: [
              { question: "drift", probability: drift.probability },
            ],
          },
        }
      },
    }
  })

export const tableInvariants: PlannedRule = {
  id: "joggle/table-invariants",
  severity: "warn",
  description: "Two write paths to one storage table that may not carry the same invariants.",
  judged: true,
  move: "contract",
  // The finding is a guess about intent, not a fact about the code: with no
  // judgement there is nothing to stand on, so the rule steps aside.
  onUnavailable: "propagate",
  plan: Effect.fn("joggle/table-invariants")(function* (workspace, scope) {
    const found = tablesWritten(workspace, scope)
    if (found.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], ["no storage table is written from more than one file, so there was nothing to compare"]),
      }
    }
    const budget = policy.tableInvariants.maxClusters
    const kept = found.slice(0, budget)
    const review = reviewerFor(workspace)
    const plans: Array<{
      readonly ruleId: string
      readonly subject: string
      readonly concerns: ReadonlyArray<string>
      readonly atoms: ReadonlyArray<string>
      readonly decisions: Record<string, Decision.Any>
      readonly violations: Readonly<Record<string, ReadonlyArray<string>>>
      readonly read: (answers: DecisionAnswers) => TableVerdict | undefined
    }> = []
    for (const entry of kept) {
      const described = entry.cluster.members.slice(0, policy.evidence.maxMembers)
      const q = yield* questionnaire({ table: entry.table, described })
      plans.push({
        ruleId: "joggle/table-invariants",
        subject: `writers of \`${entry.table}\``,
        concerns: entry.cluster.members.map((member) => member.file),
        atoms: q.atoms,
        decisions: q.decisions,
        violations: q.violations,
        read: q.read,
      })
    }
    const notes = [
      ...budgetNote({
        unitKind: "tables",
        judged: budget,
        candidates: found.length,
        sample: sampleOf(found.slice(budget)),
      }),
    ]
    return {
      plans,
      read: (answers) => {
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        kept.forEach((entry, index) => {
          // SAFETY: the plans were built here, so each answer is the TableVerdict
          // its own plan's read produced. The engine erased the type only so the
          // plans could be answered together.
          const verdict = answers[index] as TableVerdict | undefined
          const report = review
          const subject = `writers of \`${entry.table}\``
          if (verdict === undefined) {
            drops.push({
              ruleId: "joggle/table-invariants",
              subject,
              stage: "unreadable",
              reason: "no judgement was available",
            })
            return
          }
          const identity = identityOf("joggle/table-invariants", entry.cluster)
          // The shared gate, not a bare floor: below it the model said no —
          // the guards agree, and a no is a verdict, not a weak yes. Dropped,
          // with the reason kept. A probability answer carries no confidence,
          // so the gate is the floor alone — an answer the model shrugged over
          // is a classify's problem, not a Noul's.
          const quality = qualityOf({ score: verdict.drift, margin: undefined, confidence: undefined })
          if (quality.quality === "drop") {
            drops.push({
              ruleId: "joggle/table-invariants",
              subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          const first = entry.cluster.members[1]
          if (first === undefined) return
          const diagnostic = report({
            about: first,
            messageId: "drift",
            data: {
              table: entry.table,
              count: String(entry.cluster.members.length),
              writers: writerList(entry.cluster),
              review: "",
            },
            helpId: "drift_help",
            identity,
            judged: true,
            score: verdict.drift,
            panel: verdict.panel,
          })
          diagnostics.push(diagnostic)
        })
        return outcome(diagnostics, notes, drops)
      },
    }
  }),
}
