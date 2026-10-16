import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { locator, messages, reporter } from "../reporting.ts"
import { layersFrom } from "../architecture.ts"
import { classifyModules, moduleOf, modulesOf } from "../roles.ts"
import {
  budgetNote,
  inGraphScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { verdictsOf, type Plan, type PlannedCandidate } from "../plans.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Workspace } from "../workspace.ts"

const RULE_ID = "joggle/module-direction"

/**
 * Dependencies point one way, where the roles say the way is.
 *
 * `layer-direction` does this against layers a repository DECLARES, and it is
 * precise and free when they are written down. It has two problems that are not
 * about precision. Its globs go stale silently -- eight modules fell out of
 * joggle's own layering in one afternoon, and the rule reported zero upward
 * imports over the twenty-eight files it still covered. And a repository with no
 * config gets no direction check at all, which is two of the four repositories
 * this has been run against.
 *
 * This is the same check with the order INFERRED. It cannot come from the import
 * graph, because a topological order of the edges respects every edge by
 * construction, so a layering derived from the graph can never be violated by it.
 * It comes from what the roles mean instead: utilities and infrastructure sit
 * below the domain, which sits below the transport and rendering edges. That is a
 * fact about the words rather than a fact about this repository, so it needs no
 * declaration and cannot go stale.
 *
 * When layers ARE declared this rule stays out of the way and says so. A written
 * layering is more precise than a guessed one, and two rules reporting the same
 * upward import is how a report doubles without informing.
 *
 * The rank arithmetic is the CANDIDATE, not the verdict. An edge whose target
 * ranks above its source is worth asking about; whether it is a real upward
 * dependency, or the inferred order is what is wrong, is the question -- the same
 * question `layer-direction` asks, for the same reason. `rule-judgment` caught
 * this rule asserting the verdict from the arithmetic, which is the tool's own
 * rule applied to itself.
 */
export const moduleDirection: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A module depends on a module whose role sits above it.",
  judged: true,
  move: "contract",
  onUnavailable: "propagate",
  messages: messages({
    upward_module:
      "A {{from}} module imports a {{to}} module: {{fromModule}} -> {{toModule}}.",
    upward_module_help:
      "The roles are ordered {{order}}, and {{from}} sits below {{to}}. That order was inferred from what the two modules are, not from a declared layering -- write one in joggle.config.json if this repository disagrees, and this rule will step aside.{{unverified}}",
  }),
  plan: Effect.fn("joggle/module-direction")(function* (
    workspace: Workspace,
    scope: Scope,
    context,
  ) {
    const declared = layersFrom(context.config)
    if (declared.length > 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "layers are declared, so `layer-direction` owns this check and this rule stays out of it",
          ]),
      }
    }

    const classified = yield* classifyModules(workspace, context, RULE_ID)
    if (classified.roles.size === 0) {
      return { plans: [], read: () => outcome([], classified.notes, classified.drops) }
    }

    const modules = modulesOf(workspace)

    // One candidate per (source module, target module) pair. Forty edges between
    // two modules are one architectural statement, not forty.
    const seen = new Set<string>()
    const candidates: Array<{
      readonly from: string
      readonly to: string
      readonly fromModule: string
      readonly toModule: string
      readonly file: string
    }> = []
    for (const edge of workspace.imports.edges) {
      if (edge.resolution === "unresolved" || edge.importer === edge.to) continue
      // A scoped run asks about the change: an upward dependency is a candidate
      // when one of its two ends moved. A pure rename counts -- the move itself
      // can put a module on the wrong side of a boundary it used to respect.
      if (!inGraphScope(scope, edge.importer) && !inGraphScope(scope, edge.to)) continue
      const from = classified.roles.get(moduleKey(edge.importer, workspace))
      const to = classified.roles.get(moduleKey(edge.to, workspace))
      if (from === undefined || to === undefined) continue
      if (from === to) continue
      // A module and its own subdirectory are not two layers. `src/react/rules`
      // importing from `src/react` is a child reaching into its parent area,
      // which is what nesting is for, and reporting it as an architectural
      // violation is how a direction check becomes noise.
      if (from.startsWith(to + "/") || to.startsWith(from + "/")) continue
      const fromRank = classified.ranks.get(from)
      const toRank = classified.ranks.get(to)
      // A role with no rank is not part of the architecture: a test may import
      // anything, a module nobody could classify is not a claim about anyone, and
      // a run that could not order the roles reports no direction at all rather
      // than inventing one.
      if (fromRank === undefined || toRank === undefined) continue
      // The rank order is the CANDIDATE: an edge whose target sits above its
      // source is the one worth asking about.
      if (toRank <= fromRank) continue
      const key = from + "\u0000" + to
      if (seen.has(key)) continue
      seen.add(key)
      candidates.push({
        from,
        to,
        fromModule: moduleKey(edge.importer, workspace),
        toModule: moduleKey(edge.to, workspace),
        file: edge.importer,
      })
    }

    const order = orderOf(classified.ranks)
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      candidates,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            from: candidate.from,
            to: candidate.to,
            fromModule: candidate.fromModule,
            toModule: candidate.toModule,
            order,
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.fromModule + " -> " + candidate.toModule,
            concerns: [candidate.file],
            atoms: [id],
            violations: { verdict: ["upward"] },
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].fromModule\` is a ${candidate.from} module and it imports \`atoms[${id}].toModule\`, a ${candidate.to} module.`,
                  `The inferred order is ${order}: the roles are ranked ${candidate.from} below ${candidate.to}, and the order came from what the roles mean, not from a declared layering.`,
                  "Is that an upward dependency to break, or is the inferred order what is wrong?",
                  "Answer `upward` when the dependency genuinely points the wrong way, so the shared piece should move down or be passed in.",
                  "Answer `order_wrong` when these two roles are actually the other way round, so nothing is broken and the inferred order is what needs fixing.",
                  "Answer `exception` when the upward edge is deliberate and acceptable.",
                ].join("\n"),
                criteria: {
                  upward: "A real upward dependency. Move the shared piece down, or invert it.",
                  order_wrong: "These roles sit the other way round; the order is wrong, not the import.",
                  exception: "A deliberate, acceptable exception.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { candidate, id, plan } satisfies PlannedCandidate<(typeof candidates)[number]>
        }),
      { concurrency: "unbounded" },
    )

    const overBudget: ReadonlyArray<Drop> = []
    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((entry, index) => {
          const verdict = verdictOf(verdicts[index]?.["verdict"], ["upward"])
          const subject = entry.candidate.fromModule + " -> " + entry.candidate.toModule
          if (verdict === undefined || verdict.label !== "upward") {
            if (verdict !== undefined) {
              drops.push({
                ruleId: RULE_ID,
                subject,
                stage: "declined",
                reason:
                  verdict.label === "order_wrong"
                    ? "the inferred order is wrong, not the import"
                    : "a deliberate, acceptable exception",
              })
            }
            return
          }
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({ ruleId: RULE_ID, subject, stage: "gated", reason: quality.reason })
            return
          }
          diagnostics.push(
            reporterFor(workspace)({
              about: { file: entry.candidate.file, start: 0 },
              messageId: "upward_module",
              data: {
                from: entry.candidate.from,
                to: entry.candidate.to,
                fromModule: entry.candidate.fromModule,
                toModule: entry.candidate.toModule,
                order,
              },
              helpId: "upward_module_help",
              identity: [RULE_ID, entry.candidate.from, entry.candidate.to].join("\u0000"),
              judged: true,
              confidence: verdict.confidence,
              severity: quality.quality === "review" ? "info" : "warn",
            }),
          )
        })
        return outcome(
          diagnostics,
          [
            ...classified.notes,
            modules.size +
              " module(s); " +
              candidates.length +
              " upward candidate pair(s), " +
              diagnostics.length +
              " reported",
            ...budgetNote({
              unitKind: "module pairs",
              judged: candidates.length,
              candidates: candidates.length,
              sample: [],
            }),
          ],
          [...classified.drops, ...drops],
        )
      },
    }
  }),
}

/** The reporter, built once per read. */
const reporterFor = (workspace: Workspace) => reporter(moduleDirection, locator(workspace))

/** The module a file belongs to, without needing a declaration to ask about. */
const moduleKey = (file: string, workspace: Workspace): string => {
  const unit = workspace.units.find((candidate) => candidate.file === file)
  return unit === undefined ? file : moduleOf(unit)
}

/** The order, written once so the help and the candidate filter cannot disagree. */
const orderOf = (ranks: ReadonlyMap<string, number>): string =>
  [...ranks.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([role]) => role.replace(/_/g, " "))
    .join(" below ")
