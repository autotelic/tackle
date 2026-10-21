import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  inGraphScope,
  inScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop, SourceLocation } from "../schema.ts"
import type { ImportEdge } from "../imports.ts"
import type { SourceFile, Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/intent-drift"

// meta-allow: no-pattern-classifier -- the regexes read TypeScript and JSDoc SYNTAX
// (a tag, an identifier, an import line), not meaning. Whether a live import is a
// defect is the model's question.

/** Which labels mean the migration promise is broken. */
const VIOLATIONS = { verdict: ["migrate", "fix_tag"] } as const

const isViolating = (label: string | undefined): label is "migrate" | "fix_tag" =>
  label === "migrate" || label === "fix_tag"

/*
 * Authored deprecation, checked against the code that still uses it.
 *
 * `@deprecated` is the one lifecycle claim a reader can make without a catalog, and
 * nothing verifies it today: a comment says "use Button instead", the old import keeps
 * working, and the replacement may have been renamed two quarters ago. A deprecation is
 * a migration promise, so the rule checks both halves of it -- that the replacement
 * exists, and that the old path is no longer taken.
 *
 * The FACTS are deterministic: the tag, the names it mentions, whether those names are
 * declared, and who still imports the old one. Whether a live import is a defect is not.
 * A test, a compatibility shim, or a staged migration can import a deprecated part on
 * purpose, and a tool that reports every one of those trains people to ignore the rule.
 * The model answers that question with the call sites in front of it.
 *
 * Cutlist's `status`/`useInstead` is the catalog-shaped version of the same fact;
 * `plumb-ui/no-deprecated-parts` checks imports against that record. This rule is what a
 * repository without a catalog still gets.
 */

/** One deprecated declaration, the names it promises, and the call sites still on it. */
interface Deprecation {
  readonly unit: Unit
  readonly replacements: ReadonlyArray<string>
  readonly declared: ReadonlyArray<string>
  readonly unknown: ReadonlyArray<string>
  readonly imports: ReadonlyArray<{ readonly edge: ImportEdge; readonly site: SourceLocation }>
}

/**
 * The names a `@deprecated` tag says to reach for.
 *
 * Backticked identifiers are unambiguous. Unbackticked names must be capitalized, which
 * keeps ordinary prose ("use the new API") from becoming a phantom replacement. The tag
 * ends at the next JSDoc tag, so a `@deprecated` line in a long doc block cannot borrow a
 * name from `@param`.
 */
const replacementsOf = (doc: string | undefined): ReadonlyArray<string> => {
  if (doc === undefined) return []
  const tag = /@deprecated\b([\s\S]*?)(?:\n\s*\*\s*@|$)/iu.exec(doc)?.[1] ?? ""
  const names = new Set<string>()
  for (const match of tag.matchAll(/`([A-Za-z_$][\w$]*)`/gu)) {
    if (match[1] !== undefined) names.add(match[1])
  }
  for (const match of tag.matchAll(
    /\b(?:use|prefer|replace(?:d)?\s+with|switch\s+to)\s+(?:`([^`]+)`|([A-Z][A-Za-z0-9_$]*))/gu,
  )) {
    const name = match[1] ?? match[2]
    if (name !== undefined && !name.includes(" ")) names.add(name)
  }
  return [...names]
}

const isDeprecated = (unit: Unit): boolean => /\B@deprecated\b/u.test(unit.doc ?? "")

/** Find the import statement and the binding, so the finding lands where a reader looks. */
const importSite = (
  file: SourceFile | undefined,
  edge: ImportEdge,
  name: string,
): SourceLocation => {
  if (file === undefined) return { file: edge.importer, line: 1, column: 1 }
  const lines = file.text.split("\n")
  const start = lines.findIndex(
    (line) => line.includes(edge.specifier) && /\b(?:import|export)\b/u.test(line),
  )
  const from = start === -1 ? 0 : start
  const end = Math.min(lines.length, from + 12)
  for (let index = from; index < end; index += 1) {
    if (name === "default" || name === "*") {
      return { file: edge.importer, line: index + 1, column: 1 }
    }
    const line = lines[index] ?? ""
    const at = line.indexOf(name)
    if (at >= 0) return { file: edge.importer, line: index + 1, column: at + 1 }
  }
  return { file: edge.importer, line: from + 1, column: 1 }
}

const replacementLabel = (names: ReadonlyArray<string>): string =>
  names.map((name) => `\`${name}\``).join(" or ")

/**
 * Every diagnostic a candidate supports, narrowed to the repair the verdict chose.
 *
 * `unjudged` reports both halves, because without a verdict the facts are all a reader
 * has. `migrate` reports only call sites and `fix_tag` only broken targets, so a model
 * that picks one repair cannot make the rule print the other.
 */
const findingsFor = (
  report: Report,
  candidate: Deprecation,
  mode: "migrate" | "fix_tag" | "unjudged",
  provenance: { readonly judged: boolean; readonly review: boolean },
  confidence: number | undefined,
): ReadonlyArray<Diagnostic> => {
  const { judged, review } = provenance
  const diagnostics: Array<Diagnostic> = []
  const severity = review ? "info" : undefined
  for (const name of mode === "migrate" ? [] : candidate.unknown) {
    diagnostics.push(
      report({
        about: candidate.unit,
        messageId: "missing_replacement",
        data: { name: candidate.unit.name, replacement: replacementLabel([name]) },
        helpId: "missing_replacement_help",
        judged,
        ...(severity === undefined ? {} : { severity }),
        ...(confidence === undefined ? {} : { confidence }),
        identity: [RULE_ID, candidate.unit.file, candidate.unit.name, name].join("\u0000"),
      }),
    )
  }
  const hasTarget = candidate.declared.length > 0
  for (const { edge, site } of mode === "fix_tag" ? [] : candidate.imports) {
    diagnostics.push(
      report({
        about: site,
        messageId: hasTarget ? "deprecated_import" : "deprecated_import_no_target",
        data: {
          name: candidate.unit.name,
          replacement: replacementLabel(candidate.declared),
          file: candidate.unit.file,
        },
        ...(hasTarget
          ? { helpId: "deprecated_import_help" }
          : { helpId: "deprecated_import_no_target_help" }),
        judged,
        ...(severity === undefined ? {} : { severity }),
        ...(confidence === undefined ? {} : { confidence }),
        identity: [RULE_ID, edge.importer, candidate.unit.name].join("\u0000"),
      }),
    )
  }
  return diagnostics
}

export const intentDrift: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A deprecated declaration with no replacement, or a replacement still imported.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    deprecated_import: "`{{name}}` is deprecated; use {{replacement}} instead.",
    deprecated_import_help:
      "{{file}} marks `{{name}}` deprecated. Update the import, or remove the deprecation if the old name is still the right one.",
    deprecated_import_no_target:
      "`{{name}}` is deprecated and imported, but its deprecation names no replacement.",
    deprecated_import_no_target_help:
      "A deprecation without a replacement is a dead end for the reader. Name the part to migrate to in the `@deprecated` tag.",
    missing_replacement:
      "`{{name}}` is deprecated in favor of {{replacement}}, which no declaration exports.",
    missing_replacement_help:
      "The migration target must exist before the deprecation can be followed. Rename the target or correct the tag.",
  }),
  plan: Effect.fn("joggle/intent-drift")(function* (workspace: Workspace, scope: Scope) {
    const files = new Map(workspace.files.map((file) => [file.path, file]))
    const candidates: Array<Deprecation> = []
    for (const unit of workspace.units) {
      if (!isDeprecated(unit)) continue
      const replacements = replacementsOf(unit.doc)
      const declared = replacements.filter((name) => {
        if (name === unit.name) return false
        return (workspace.byName.get(name) ?? []).some(
          (candidate) =>
            candidate.exported && !(candidate.file === unit.file && candidate.name === unit.name),
        )
      })
      const unknown = replacements.filter((name) => !declared.includes(name))
      const imports = workspace.imports
        .importersOfName(unit.file, unit.name)
        .filter((edge) => edge.importer !== unit.file)
        .filter(
          (edge) => inGraphScope(scope, edge.importer) || inGraphScope(scope, unit.file),
        )
        .slice(0, policy.intentDrift.maxImports)
        .map((edge) => ({ edge, site: importSite(files.get(edge.importer), edge, unit.name) }))
      // A broken tag is only in scope when its declaration is; a call site is enough
      // on its own, because a scoped run is asking what the change introduced.
      const reportedUnknown = inScope(scope, unit.file) ? unknown : []
      if (reportedUnknown.length === 0 && imports.length === 0) continue
      candidates.push({
        unit,
        replacements,
        declared,
        unknown: reportedUnknown,
        imports,
      })
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no deprecated declaration has a live import or a missing target"]),
      }
    }

    const budget = policy.intentDrift.maxDeclarations
    const judged = candidates.slice(0, budget)
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            declaration: {
              name: candidate.unit.name,
              file: candidate.unit.file,
              doc: (candidate.unit.doc ?? "").slice(0, policy.evidence.maxSourceChars),
            },
            replacements: candidate.replacements,
            missing: candidate.unknown,
            imports: candidate.imports.map(({ edge, site }) => ({
              file: edge.importer,
              line: site.line,
              specifier: edge.specifier,
            })),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.unit.file + ":" + candidate.unit.name,
            concerns: [
              candidate.unit.file,
              ...candidate.imports.map(({ edge }) => edge.importer),
            ],
            atoms: [id],
            violations: VIOLATIONS,
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].declaration\` carries an \`@deprecated\` tag.`,
                  `\`atoms[${id}].replacements\` are the names the tag says to use.`,
                  `\`atoms[${id}].missing\` are replacement names with no exported declaration.`,
                  `\`atoms[${id}].imports\` are the call sites that still import the old name.`,
                  "What should happen?",
                  "Answer `migrate` when a replacement exists and the imports should move to it.",
                  "Answer `fix_tag` when the replacement the tag names does not exist, so the tag or the target is wrong.",
                  "Answer `keep` when the old path is deliberately still in use -- a test, a compatibility shim, a staged migration -- or the tag itself is wrong.",
                ].join("\n"),
                criteria: {
                  migrate: "The replacement exists; move the imports.",
                  fix_tag: "The named replacement does not exist; fix the tag or add the target.",
                  keep: "The old path is intentional, or the deprecation is wrong. Change nothing.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { candidate, plan }
        }),
      { concurrency: "unbounded" },
    )

    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.file + ":" + candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + String(budget) + " deprecated declarations",
    }))

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const report = reporter(intentDrift, locator(workspace))
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach(({ candidate, plan }, index) => {
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(
              ...findingsFor(report, candidate, "unjudged", { judged: false, review: false }, undefined),
            )
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
              subject: plan.subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          if (!isViolating(verdict.label)) {
            drops.push({
              ruleId: RULE_ID,
              subject: plan.subject,
              stage: "declined",
              reason: "the old path is intentional",
            })
            return
          }
          // A model can name a repair the facts do not support. Keep the facts
          // authoritative about WHICH repair is available; the model decides whether
          // anything should change at all.
          if (verdict.label === "migrate" && candidate.declared.length === 0) {
            drops.push({
              ruleId: RULE_ID,
              subject: plan.subject,
              stage: "gated",
              reason: "the tag names no existing replacement",
            })
            return
          }
          if (verdict.label === "fix_tag" && candidate.unknown.length === 0) {
            drops.push({
              ruleId: RULE_ID,
              subject: plan.subject,
              stage: "gated",
              reason: "the tag names no missing replacement",
            })
            return
          }
          const repair: "migrate" | "fix_tag" =
            verdict.label === "migrate" ? "migrate" : "fix_tag"
          diagnostics.push(
            ...findingsFor(
              report,
              candidate,
              repair,
              { judged: true, review: quality.quality === "review" },
              verdict.confidence,
            ),
          )
        })
        return outcome(
          diagnostics,
          [
            ...budgetNote({
              unitKind: "deprecated declarations",
              judged: budget,
              candidates: candidates.length,
              sample: candidates.slice(budget).map((candidate) => candidate.unit.name),
            }),
          ],
          drops,
        )
      },
    }
  }),
}
