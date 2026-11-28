import { Effect } from "effect"
import { Decision } from "effect/ai"
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
import {
  dutyClausesOf,
  dutyFamilies,
  dutyFamilyVocabulary,
  EDGE_ROLES,
  edgeRolesOf,
  homeVocabulary,
} from "../vocabulary.ts"
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

/**
 * The family question and the home question, once per declaration.
 *
 * The duty vocabulary holds twelve labels -- more than one Choice may offer --
 * so code asks which family of work first. The duties inside that family are
 * asked by {@link dutyClauseReview} in the SAME request: answers are
 * independent, so the two questions need not be a round trip, and `read`
 * composes `family: duty` the way the remedy normaliser composes its key.
 */
const dutyFamilyReview = (id: string) => ({
  duty_family: Decision.classify({
    instructions: [
      `Which family of work is \`atoms[${id}].declaration.name\` doing?`,
      `Inspect \`atoms[${id}].declaration\` and \`atoms[${id}].repository\`.`,
      `\`atoms[${id}].repository\` describes what this codebase is trying to be. Judge what this declaration IS, not the directory it sits in: the same calculation is a domain rule in any file.`,
      "Choose `business_rule` for a rule, an invariant or a task about the business -- including one that reads or records stored data, because the next question separates those.",
      "Choose `none` when it is a helper with no meaning outside its immediate caller.",
    ].join("\n"),
    criteria: dutyFamilyVocabulary,
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

/**
 * The duty question, restricted to one family's clauses.
 *
 * Asked once per family in the same request as the family question; `read`
 * keeps the answer for the family that was chosen and ignores the rest. Each
 * question is under the contract's option limit, and no duty label is dropped.
 */
const dutyClauseReview = ({
  id,
  family,
}: {
  readonly id: string
  readonly family: string
}) => ({
  duty: Decision.classify({
    instructions: [
      `What is \`atoms[${id}].declaration.name\` doing, within the family \`${family}\`?`,
      `Inspect \`atoms[${id}].declaration\` and \`atoms[${id}].repository\`.`,
      `Judge what this declaration IS, not the directory it sits in: the same calculation is a domain rule in any file, and a function that takes a database handle is infrastructure however much business logic its rows carry.`,
      "Choose `request_validation` for what the endpoint ACCEPTS; `input_adaptation` when the only job is to reshape input; `mechanical` for a cache key, an identifier or a lookup table; `orchestration` when it mostly calls other things.",
    ].join("\n"),
    criteria: dutyClausesOf(family),
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
    rule_at_the_edge: "{{name}} in {{file}} is a rule about the business, living in {{home}}.",
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
          outcome(
            [],
            [
              "no exported declaration was long enough to hold a business rule, so nothing was a hoist candidate",
            ],
          ),
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
            : "this declaration is in a " +
              role.replace(/_/g, " ") +
              " module, so there is nothing to hoist it out of",
      })
    }

    const candidates = all.filter((unit) => edge.has(moduleOf(unit)))

    const budget = policy.hoistToDomain.maxDeclarations
    const judged = candidates.slice(0, budget)

    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((unit) => ({
      ruleId: RULE_ID,
      subject: label(unit),
      stage: "ceiling" as const,
      reason: "past the budget of " + budget + " declarations",
    }))

    const atoms = yield* Atoms
    type Question =
      | { readonly unit: Unit; readonly kind: "family" }
      | { readonly unit: Unit; readonly kind: "duty"; readonly family: string }
    const planned: Array<{
      readonly question: Question
      readonly plan: Plan<DecisionAnswers>
    }> = []
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
      const shared = {
        ruleId: RULE_ID,
        subject: label(unit),
        concerns: [unit.file],
        atoms: [id],
      }
      // The family question, once. The duty question is asked per family in the
      // SAME request, because answers are independent and a second round trip is
      // the only expensive thing a judgement can spend (jev rule 2).
      planned.push({
        question: { unit, kind: "family" },
        plan: {
          ...shared,
          violations: { duty_family: ["business_rule"] },
          decisions: dutyFamilyReview(id),
          read: (answers) => answers,
        },
      })
      for (const family of Object.keys(dutyFamilies)) {
        // A family with ONE duty is a fact, not a question: the effect library refuses a
        // Classify with fewer than two labels, and asking is what crashed every scoped run of
        // this rule (`none` has only `not_applicable`). The single-duty families cannot carry
        // the finding this rule reports, so they are skipped rather than guessed at.
        if (Object.keys(dutyClausesOf(family)).length < 2) continue
        const clause: Plan<DecisionAnswers> = {
          ...shared,
          decisions: dutyClauseReview({ id, family }),
          read: (answers) => answers,
        }
        // Only the business-rule clause can carry the finding this rule
        // reports, so calibration sees that decision and not the four others.
        // Built in two statements rather than a conditional spread: the spread
        // hid property omission behind an empty object.
        planned.push({
          question: { unit, kind: "duty", family },
          plan:
            family === "business_rule"
              ? { ...clause, violations: { duty: ["domain_logic"] } }
              : clause,
        })
      }
    }

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const families = new Map<Unit, string>()
        const homes = new Map<Unit, string>()
        const duties = new Map<
          Unit,
          Map<string, Decision.ClassifyAnswer<string> | Decision.RateAnswer<string>>
        >()
        planned.forEach((entry, index) => {
          const answer = verdicts[index]
          if (answer === undefined) return
          if (entry.question.kind === "family") {
            const family = answer["duty_family"]
            const home = answer["home"]
            if (family !== undefined && "label" in family) {
              families.set(entry.question.unit, family.label)
            }
            if (home !== undefined && "label" in home) homes.set(entry.question.unit, home.label)
            return
          }
          const duty = answer["duty"]
          if (duty === undefined || !("label" in duty)) return
          const byFamily = duties.get(entry.question.unit) ?? new Map()
          byFamily.set(entry.question.family, duty)
          duties.set(entry.question.unit, byFamily)
        })

        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...notAnEdge, ...overBudget]
        for (const unit of judged) {
          const family = families.get(unit)
          const home = homes.get(unit)
          // The answer to the family question selects which duty answer to read;
          // the other families were asked so the request stayed single, and their
          // answers are ignored.
          const duty = family === undefined ? undefined : duties.get(unit)?.get(family)
          if (family === undefined || home === undefined || duty === undefined) {
            drops.push({
              ruleId: RULE_ID,
              subject: label(unit),
              stage: "unreadable",
              reason: "the response did not classify this declaration",
            })
            continue
          }
          const isDomainRule = duty.label === "domain_logic"
          // A Choice that barely won is not a decision. The duplicate rules have
          // had this gate since it was shown to withhold 11 clusters of unrelated
          // `db*` functions; these two rules were built without it, which is how
          // one of them produced 199 findings on a single repository. Only the
          // domain clause carries the distribution this gate reads.
          const quality = isDomainRule
            ? qualityOf({
                score: duty.probabilities["domain_logic"] ?? duty.confidence ?? 1,
                margin: marginOfAnswer(duty),
                confidence: duty.confidence,
              })
            : undefined
          if (quality?.quality === "drop") {
            drops.push({
              ruleId: RULE_ID,
              subject: label(unit),
              stage: "gated" as const,
              reason: quality.reason,
            })
            continue
          }
          const review = quality?.quality === "review"
          if (!isDomainRule || declined(home) || home === "already_there") {
            drops.push({
              ruleId: RULE_ID,
              subject: label(unit),
              stage: "declined" as const,
              reason: isDomainRule
                ? "the model says this is already where it belongs"
                : "the model says this is " + family + ": " + duty.label,
            })
            continue
          }
          diagnostics.push(
            report({
              about: unit,
              messageId: "rule_at_the_edge",
              data: { name: unit.name, file: unit.file, home: home.replace(/_/g, " ") },
              helpId: "rule_at_the_edge_help",
              identity: [RULE_ID, unit.file, unit.name].join("\u0000"),
              confidence: duty.confidence ?? 1,
              judged: true,
              severity: review ? "info" : "warn",
            }),
          )
        }

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
  }),
}
