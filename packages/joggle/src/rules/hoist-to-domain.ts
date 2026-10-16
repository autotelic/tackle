import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import {
  budgetNote,
  declined,
  marginOfAnswer,
  qualityOf,
  outcome,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { classifyModules, moduleOf } from "../roles.ts"
import { dutyVocabulary, EDGE_ROLES, edgeRolesOf, homeVocabulary } from "../vocabulary.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Unit, Workspace } from "../workspace.ts"

const RULE_ID = "joggle/hoist-to-domain"

/*
 * Business logic that lives at the edge and belongs in the middle.
 *
 * The other half of a domain migration. `dependency-fit` asks what a package
 * depends on; this asks where the RULES live -- a calculation, an invariant, a
 * decision about the business sitting in a route handler or a React component,
 * where it will be re-implemented the moment a second caller needs it.
 *
 * Nothing here is derived from a config. The candidate filter is structural (a
 * non-trivial exported declaration), and the two judgements are the ones a
 * reviewer actually makes: what IS this declaration, and is this file already
 * where logic like this belongs. The second question is what a declared `domain`
 * layer would have answered, and the model answers it from the path and the
 * prose instead.
 */

/**
 * Route and framework exports that exist because a framework requires them.
 *
 * A `loader` is not a hoist candidate whatever it contains; the framework asked
 * for it by name. Everything a loader CALLS is fair game, which is why the filter
 * is by name and not by file.
 */
const isCandidate = (unit: Unit): boolean => {
  if (!unit.exported) return false
  if (unit.kind !== "function") return false
  // Names a framework calls by file. Nothing to hoist and nothing to merge,
  // whatever the declaration contains -- the list lives in policy because two
  // rules need it and a second copy is a second thing to update.
  if (policy.frameworkExports.some((name) => name === unit.name)) return false
  // Test declarations are compared against each other by the duplicate rules and
  // are candidates for nothing here: a fixture is not a business rule.
  if (unit.test) return false
  // A declaration with nothing in it has no rule in it either.
  if (unit.tokens.length < policy.hoistToDomain.minTokens) return false
  // A React component renders; it does not decide. Components are recognised by
  // the name convention rather than by JSX, because a component can return
  // another component's output and never write a tag itself.
  const first = unit.name[0]
  if (first !== undefined && first >= "A" && first <= "Z") return false
  return true
}

/**
 * Whether everything that uses this declaration is a test.
 *
 * A helper only tests reach for is test support, whatever directory it sits in.
 * `services/db/src/support/seed-kit.js` is not in a test folder and every one of
 * its declarations exists for tests -- and it ranked FIRST, because a seed helper
 * names types, compares values and is imported widely.
 *
 * Derived from the import graph, which already knows who imports what, so this
 * cannot go stale and needs no list of support directories.
 */
const onlyTestsUse = (unit: Unit, workspace: Workspace): boolean => {
  const importers = workspace.imports.importersOfName(unit.file, unit.name)
  if (importers.length === 0) return false
  return importers.every((edge) => policy.testFiles.test(edge.importer))
}

const candidatesIn = (workspace: Workspace, scope: Scope): ReadonlyArray<Unit> =>
  workspace.units
    .filter(isCandidate)
    .filter((unit) => !onlyTestsUse(unit, workspace))
    .filter((unit) => scope.changed === undefined || scope.changed.has(unit.file))
    // Ordered by path, NOT by rule-likeness. I built that score and it was worse
    // than nothing: "somebody else imports it" promoted a CRUD delete above an
    // authorization rule, because such a function is imported widely, names types
    // and compares values -- every signal I chose. What separates a rule from a
    // query is what the body DOES, and that is a judgement rather than a shape.
    // Ranking by a guess about it spent the budget on the wrong end of the list.
    //
    .sort((left, right) => left.file.localeCompare(right.file) || left.start - right.start)

/** The two questions about one declaration, pointing at its atom by id. */
const hoistReview = (id: string) => ({
  duty: Decision.classify({
    instructions: [
      `What is \`atoms[${id}].declaration.name\` doing?`,
      `Inspect \`atoms[${id}].declaration\` and \`atoms[${id}].repository\`.`,
      `\`atoms[${id}].repository\` describes what this codebase is trying to be. Judge what this declaration IS, not the directory it sits in: the same calculation is a domain rule in any file. A rule, an invariant or a decision about the business is \`domain_logic\` no matter which file holds it.`,
      "Choose `request_validation` when the rule is about what the endpoint ACCEPTS -- a required field, a range, a mutual exclusion, a 400 -- rather than about the business.",
      "Choose `input_adaptation` when its only job is to reshape input into what another layer (usually the domain's own parser) expects.",
      "Choose `mechanical` for a cache key, an identifier or a lookup table.",
      "Choose `infrastructure` when it takes a database handle (Knex, a transaction, a connection) or runs a query. The domain is pure by design, so moving SQL into it is the wrong repair, however much business logic the query's result carries.",
      "Choose `orchestration` when it mostly calls other things and decides little itself.",
    ].join("\n"),
    criteria: dutyVocabulary,
  }),
  home: Decision.classify({
    instructions: [
      `Is \`atoms[${id}].declaration.path\` already the right home for logic like this?`,
      `Inspect \`atoms[${id}].declaration.path\` and \`atoms[${id}].repository\`.`,
      `Decide by the path and what \`atoms[${id}].repository\` says the architecture is. A route, a component directory or a transport handler is not a home for business rules; a domain or model package is.`,
    ].join("\n"),
    criteria: homeVocabulary,
  }),
})

export const hoistToDomain: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "Business logic at the edge that belongs in a domain package.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    rule_at_the_edge:
      "{{name}} in {{file}} is a rule about the business, living in {{home}}.",
    rule_at_the_edge_help:
      "Move it into the domain package and import it from here. Business rules at the edge get re-implemented by the next caller, and the two copies then disagree. If this is deliberately local, pin the decision in the config so the question is not asked again.",
  }),
  plan: Effect.fn("joggle/hoist-to-domain")(function* (
    workspace: Workspace,
    scope: Scope,
    context,
  ) {
    const report = reporter(hoistToDomain, locator(workspace))
    const all = candidatesIn(workspace, scope)
    // Declared before its first use, not after: a generator's body is one scope and
    // the type checker cannot see the temporal dead zone that produced
    // "Cannot access 'label' before initialization" at runtime.
    const label = (unit: Unit): string => unit.name + " (" + unit.file + ")"
    if (all.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no exported declaration was long enough to hold a business rule, so nothing was a hoist candidate",
          ]),
      }
    }

    // ROUND ONE: what is each module for?
    //
    // The same classification `module-direction` uses, shared rather than
    // repeated: one Decision, one answer, and the content-addressed cache makes
    // the second reader free. Business logic at the edge is only a problem at an
    // edge, so a declaration in a domain package or a utility module is not a
    // hoist candidate whatever it contains.
    const classified = yield* classifyModules(workspace, context, RULE_ID)

    const edge = new Map<string, string>()
    const notAnEdge: Array<Drop> = []
    // Derived from the rank the run decided, so a repository whose outer layer is
    // the API rather than the UI gets the right edge. The constant is the
    // fallback for a run that could not order the roles.
    const edgeRoles = classified.ranks.size === 0 ? EDGE_ROLES : edgeRolesOf(classified.ranks)
    for (const unit of all) {
      const path = moduleOf(unit)
      const role = classified.roles.get(path)
      if (role !== undefined && edgeRoles.has(role)) {
        edge.set(path, role)
        continue
      }
      notAnEdge.push({
        ruleId: RULE_ID,
        subject: label(unit),
        stage: "declined" as const,
        reason:
          role === undefined
            ? "the module this declaration lives in could not be classified"
            : "this declaration is in a " + role.replace(/_/g, " ") + " module, so there is nothing to hoist it out of",
      })
    }

    const candidates = all.filter((unit) => edge.has(moduleOf(unit)))

    const budget = policy.hoistToDomain.maxDeclarations
    const judged = candidates.slice(0, budget)

    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((unit) => ({
      ruleId: RULE_ID,
      subject: label(unit),
      stage: "budget" as const,
      reason: "past the budget of " + budget + " declarations",
    }))

    const atoms = yield* Atoms
    const planned: Array<{ readonly unit: Unit; readonly plan: Plan<DecisionAnswers> }> = []
    for (const unit of judged) {
      const id = yield* atoms.add({
        repository: context.config.evidence?.repository ?? null,
        // What the module IS, from round one. Every question about a declaration
        // is easier to answer knowing whether it sits in a route handler or a
        // domain package, and round one already paid for the answer.
        module: { path: moduleOf(unit), role: edge.get(moduleOf(unit)) ?? null },
        declaration: {
          name: unit.name,
          path: unit.file,
          line: unit.location.line,
          source: unit.text.slice(0, policy.evidence.maxSourceChars),
          documented: unit.doc !== undefined,
          doc: unit.doc?.slice(0, policy.evidence.maxDocChars) ?? null,
          types: unit.typeRefs,
        },
      })
      planned.push({
        unit,
        plan: {
          ruleId: RULE_ID,
          subject: label(unit),
          concerns: [unit.file],
          atoms: [id],
          violations: { duty: ["domain_logic"] },
          decisions: hoistReview(id),
          read: (answers) => answers,
        },
      })
    }

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...notAnEdge, ...overBudget]
        planned.forEach((entry, index) => {
          const unit = entry.unit
          const answer = verdicts[index]
          if (answer === undefined) {
            drops.push({
              ruleId: RULE_ID,
              subject: label(unit),
              stage: "unreadable",
              reason: "the response did not classify this declaration",
            })
            return
          }
          const duty = answer["duty"]
          const home = answer["home"]
      if (duty === undefined || !("label" in duty) || home === undefined || !("label" in home)) {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "unreadable",
          reason: "the response did not classify this declaration",
        })
        return
      }
      // A Choice that barely won is not a decision. The duplicate rules have had
      // this gate since it was shown to withhold 11 clusters of unrelated `db*`
      // functions; these two rules were built without it, which is how one of them
      // produced 199 findings on a single repository. The shared gate, so the
      // reasoning sits in one place.
      const quality = qualityOf({
        score: duty.probabilities["domain_logic"] ?? duty.confidence ?? 1,
        margin: marginOfAnswer(duty),
        confidence: duty.confidence,
      })
      if (quality.quality === "drop") {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "gated" as const,
          reason: quality.reason,
        })
        return
      }
      const review = quality.quality === "review"
      if (duty.label !== "domain_logic" || declined(home.label) || home.label === "already_there") {
        drops.push({
          ruleId: RULE_ID,
          subject: label(unit),
          stage: "declined" as const,
          reason:
            duty.label === "domain_logic"
              ? "the model says this is already where it belongs"
              : "the model says this is " + duty.label,
        })
        return
      }
      diagnostics.push(
        report({
                  about: unit,
                  messageId: "rule_at_the_edge",
                  data: { name: unit.name, file: unit.file, home: (home.label ?? "").replace(/_/g, " ") },
                  helpId: "rule_at_the_edge_help",
                  identity: [RULE_ID, unit.file, unit.name].join("\u0000"),
                  confidence: duty.confidence ?? 1,
                  judged: true,
                  severity: review ? "info" : "warn",
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "declarations",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map(label),
          }),
          drops,
        )
      },
    }
  })
}
