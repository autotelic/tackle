import { Effect, Option, Schema } from "effect"
import { Decision, DecisionModel } from "effect/unstable/ai"
import { policy } from "../policy.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import {
  declined,
  defineRule,
  inScope,
  marginOfAnswer,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop, DropStage } from "../schema.ts"
import { pageDecisions, pageVerdictByRole } from "../vocabulary.ts"
import { dirOf } from "../bundles.ts"
import type { Result } from "./cluster-verdict.ts"
import type { SourceFile, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/page-needs-composition"

/*
 * Does a page's own state and markup belong in a composition bundle?
 *
 * This is the CONSUMER half of the pattern, and the only half that needs a
 * judgement. The producer half is structural and is checked by bundle-conformance
 * with no model at all.
 *
 * The trigger matters more than the question. The first version asked about every
 * file under `routes/`: 1,216 candidates against Shakti's 280 real route and
 * modal files, 392 flagged, and 237 of those scored under 0.3 by the model -- it
 * was being asked whether pages follow a pattern that pages with no shared state
 * have no reason to follow. Now the rule only asks when a page carries enough
 * local state and inline markup that a bundle would pay for itself.
 */

/** A page is a route, a page, or a modal -- not merely something under routes/. */
interface Page {
  readonly source: SourceFile
  readonly localState: number
  readonly inlineElements: number
  readonly lines: number
  readonly importsBundles: number
  readonly rendersProvider: boolean
}

const candidatesIn = (workspace: Workspace): ReadonlyArray<Page> => {
  const bundleDirs = new Set<string>()
  for (const file of workspace.files) {
    if (
      file.facts.callSites.some(
        (site) => site.name === "createContext" || site.name.endsWith(".createContext"),
      )
    ) {
      bundleDirs.add(dirOf(file.path))
    }
  }

  const { minLocalState, minInlineElements } = policy.pageNeedsComposition
  const pages: Array<Page> = []
  for (const file of workspace.files) {
    // Call SITES, not distinct names. This was counting a deduplicated set, so a
    // file with thirty-four useState calls reported one and the gate below --
    // which wants three -- could never be satisfied. The rule had never fired.
    const localState = file.facts.callSites.filter(
      (site) => site.name === "useState" || site.name.endsWith(".useState"),
    ).length
    const inlineElements = file.facts.jsx.length
    if (localState < minLocalState || inlineElements < minInlineElements) continue
    pages.push({
      source: file,
      localState,
      inlineElements,
      lines: file.text.split("\n").length,
      importsBundles: workspace.imports.edges.filter(
        (edge) => edge.importer === file.path && edge.resolution === "resolved" && bundleDirs.has(dirOf(edge.to)),
      ).length,
      rendersProvider: file.facts.jsx.some((element) => element.endsWith(".Provider")),
    })
  }
  return pages
}

const gaps = (page: Page): ReadonlyArray<string> => {
  const found: Array<string> = []
  if (!page.rendersProvider) found.push("no provider as the composition root")
  if (page.importsBundles === 0) found.push("no blocks from a composition bundle")
  if (page.localState >= policy.pageNeedsComposition.minLocalState + 2) {
    found.push(`${page.localState} useState calls that a provider would own`)
  }
  return found
}

const PageEvidence = Schema.Struct({
  page: Schema.Struct({
    path: Schema.String,
    lines: Schema.Number,
    local_state_calls: Schema.Number,
    inline_elements: Schema.Number,
    imports_from_pattern_bundles: Schema.Number,
    renders_a_provider: Schema.Boolean,
  }),
  gaps: Schema.Array(Schema.String),
  role: Schema.optionalKey(Schema.String),
})

const PageRole = Decision.make({
  input: PageEvidence,
  decisions: { role: pageDecisions.role },
})

const findingFor = (report: Report, page: Page, answers: DecisionAnswers): Result => {
  const dropOf = (stage: DropStage, reason: string): Result => ({
    drop: { ruleId: RULE_ID, subject: page.source.path, stage, reason },
  })
  const verdict = answers["verdict"]
  if (verdict === undefined || !("label" in verdict)) {
    return dropOf("unreadable", "no verdict came back")
  }
  if (declined(verdict.label)) {
    return dropOf("declined", "the state is this page's own")
  }
  // The yes/no question is a verdict, not a ranking: when it says the extraction
  // is not worth a reviewer's time, there is no finding, however loudly the
  // Choice said `extract_to_bundle`.
  const worth = answers["worth_fixing"]
  const probability = worth !== undefined && "probability" in worth ? worth.probability : undefined
  const confidence = verdict.confidence ?? 1
  const quality = qualityOf({
    score: probability ?? confidence,
    margin: marginOfAnswer(verdict),
    confidence,
  })
  if (quality.quality === "drop") return dropOf("gated", quality.reason)
  const review = quality.quality === "review"
  const gap = answers["primary_gap"]
  const missing = gaps(page)
  return {
    diagnostic: report({
      about: page.source,
      messageId: "state_pressure",
      data: {
        file: page.source.path,
        state: page.localState,
        inline: page.inlineElements,
        gaps: missing.join("; "),
        start:
          gap === undefined || !("label" in gap) || declined(gap.label)
            ? ""
            : ` Start with: ${gap.label.replace(/_/g, " ")}.`,
      },
      helpId: missing.length === 0 ? "state_pressure_help_none" : "state_pressure_help_gaps",
      identity: [RULE_ID, page.source.path].join("\u0000"),
      confidence,
      score: probability ?? confidence,
      judged: true,
      severity: review ? "info" : "warn",
    }),
  }
}

export const pageNeedsComposition = defineRule({
  id: RULE_ID,
  severity: "warn",
  description: "Pages whose own state and markup belong in a composition bundle.",
  judged: true,
  move: "expand",
  messages: messages({
    state_pressure:
      "{{file}} carries {{state}} useState call(s) and {{inline}} inline element(s) that may belong in a composition bundle.",
    state_pressure_help_none:
      "See the composition pattern guide: a provider owns `{ state, actions, meta }` and blocks are exported by dot notation.",
    state_pressure_help_gaps: "Gaps: {{gaps}}.{{start}}",
  }),
  run: Effect.fn("joggle/page-needs-composition")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(pageNeedsComposition, locator(workspace))
    const pages = candidatesIn(workspace).filter((page) => inScope(scope, page.source.path))
    if (pages.length === 0) {
      return outcome([], [
        "no file looks like a page under state pressure: the trigger is " +
          policy.pageNeedsComposition.minLocalState +
          " or more useState calls and " +
          policy.pageNeedsComposition.minInlineElements +
          " or more inline elements",
      ])
    }

    const budget = policy.pageNeedsComposition.maxPages
    const judged = pages.slice(0, budget)
    const evidenceFor = (page: Page) => ({
      page: {
        path: page.source.path,
        lines: page.lines,
        local_state_calls: page.localState,
        inline_elements: page.inlineElements,
        imports_from_pattern_bundles: page.importsBundles,
        renders_a_provider: page.rendersProvider,
      },
      gaps: gaps(page),
    })

    // ROUND ONE: what is this file?
    //
    // Cheaper and more useful than asking the real question directly, because the
    // answer decides which real question to ask. The first version of this rule
    // asked every file under routes/ whether it should be a bundle, produced
    // 1,216 candidates, and got 237 shrugs -- a model asked a question that does
    // not apply to the thing in front of it does not say so, it says 0.2.
    const classified = yield* Effect.forEach(
      judged,
      (page) =>
        DecisionModel.decide(PageRole, { input: evidenceFor(page) }).pipe(
          Effect.map((result) => Option.some(result.answers.role.label)),
          Effect.orElseSucceed(() => Option.none<string>()),
        ),
      { concurrency: policy.decision.requestConcurrency },
    )

    const roles: Array<{ page: Page; role: string }> = []
    const drops: Array<Drop> = pages.slice(budget).map((page) => ({
      ruleId: RULE_ID,
      subject: page.source.path,
      stage: "budget" as const,
      reason: `the run judged ${budget} page(s) and this one was past the budget`,
    }))

    judged.forEach((page, index) => {
      const role = classified[index]
      if (role === undefined || Option.isNone(role)) {
        drops.push({
          ruleId: RULE_ID,
          subject: page.source.path,
          stage: "unreadable",
          reason: "the response did not classify this file",
        })
        return
      }
      if (declined(role.value)) {
        drops.push({
          ruleId: RULE_ID,
          subject: page.source.path,
          stage: "declined",
          reason: "the model classified it as not a page, modal or layout",
        })
        return
      }
      roles.push({ page, role: role.value })
    })

    if (roles.length === 0) {
      return outcome(
        [],
        ["every candidate was classified as something other than a page, modal or layout"],
        drops,
      )
    }

    // ROUND TWO: the decision the classification selected, with the vocabulary
    // that kind of file is judged by.
    const results = yield* Effect.forEach(
      roles,
      ({ page, role }) => {
        const definition = Decision.make({
          input: PageEvidence,
          decisions: {
            verdict: {
              ...pageDecisions.verdict,
              criteria: pageVerdictByRole[role] ?? pageDecisions.verdict.criteria,
            },
            primary_gap: pageDecisions.primary_gap,
            worth_fixing: pageDecisions.worth_fixing,
          },
        })
        return DecisionModel.decide(definition, { input: { ...evidenceFor(page), role } }).pipe(
          Effect.map((result) => Option.some(result.answers)),
          Effect.orElseSucceed(() => Option.none<DecisionAnswers>()),
        )
      },
      { concurrency: policy.decision.requestConcurrency },
    )

    const diagnostics: Array<Diagnostic> = []
    // Only the files that survived classification are read here, and the index
    // is into THAT list: round two asked about a different, shorter set.
    roles.forEach(({ page }, index) => {
      const result = results[index]
      if (result === undefined || Option.isNone(result)) {
        drops.push({
          ruleId: RULE_ID,
          subject: page.source.path,
          stage: "unreadable",
          reason: "the response contained nothing for this candidate",
        })
        return
      }
      const decided = findingFor(report, page, result.value)
      if (decided.diagnostic !== undefined) diagnostics.push(decided.diagnostic)
      if (decided.drop !== undefined) drops.push(decided.drop)
    })

    return outcome(diagnostics, [], drops)
  }),
})

