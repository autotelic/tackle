import { Effect } from "effect"
import { builtinModules } from "node:module"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import {
  budgetNote,
  inGraphScope,
  marginOfAnswer,
  outcome,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import { packageNameOf } from "../roles.ts"
import { dependencyVocabulary } from "../vocabulary.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Workspace } from "../workspace.ts"

// meta-allow: no-pattern-classifier -- a file-extension test (`/\.(?:[cm]?[jt]sx?)$/`) on an import specifier -- a
// language fact about what a source file is called, not this repository's naming. docs/rule-coupling.md.
const RULE_ID = "joggle/dependency-fit"

/**
 * Does each package depend on what a package like it should?
 *
 * The inferred replacement for `layer-purity`'s declared `forbid` list, and the
 * same lesson for the third time: a hand-maintained list of facts goes stale.
 * `ignoredDirectories` became .gitignore, the hand-bumped analysisVersion became
 * a source hash, and a regex per layer saying what it may not import should never
 * have been written two hours after removing the first of those.
 *
 * The material was already here: a package, the thing it imports, and the
 * sentence of prose a repository writes about itself. The TypeSafe docs call that
 * "the material you would present to a panel of experts before asking them to
 * make a judgment", and the judgement belongs in a question. "Should a domain
 * package import react" is not a fact. "Does this package import react" is, and
 * the import graph already answers it.
 *
 * The candidate set is DISTINCT (package, dependency) pairs, not import
 * statements. A repository with four services reaches for perhaps sixty external
 * things in total, so this is sixty questions about sixty decisions rather than
 * sixty thousand questions about sixty thousand lines.
 */
interface Dependency {
  /** The module that reached for it: its package, or its path without one. */
  readonly path: string
  /** The directory of the file that reached for it, for the manifest lookup. */
  readonly directory: string
  /** What that package declares it depends on, so the state can say so. */
  readonly declares: ReadonlyArray<string>
  readonly specifier: string
  readonly count: number
  readonly examples: ReadonlyArray<string>
}

/**
 * The module a file belongs to, from its path alone.
 *
 * Two segments: `services/ui/app/routes/x.ts` is `services/ui`. This is a
 * heuristic, and the only one in this rule -- but it is DERIVED from the paths
 * rather than declared, so it cannot go stale, and a repository that groups its
 * code some other way still gets questions about the groups it actually has.
 */
const moduleOf = (file: string): string => file.split("/").slice(0, 2).join("/")

/**
 * Node's own modules, which no manifest declares and no repository should.
 *
 * From the runtime rather than a written list: `import { builtinModules } from
 * "node:module"` is the same set the interpreter enforces, so it cannot go stale
 * as Node adds modules.
 */
const BUILTINS = new Set([...builtinModules, ...builtinModules.map((name) => "node:" + name)])

interface Candidates {
  readonly dependencies: ReadonlyArray<Dependency>
  /** Imports the package declares for itself: answered, not asked. */
  readonly declared: ReadonlyArray<{ dependency: Dependency; specifier: string }>
}

/**
 * Whether a specifier names something inside this repository.
 *
 * An unresolved import is not automatically a dependency. `src/authorization/
 * index.js` in 37 files and `@shared/types/safety-forms` are paths and path
 * aliases that the resolver could not follow -- tsconfig `paths` are not read --
 * and reporting them as undeclared dependencies is noise that buries the seven
 * real ones.
 *
 * Derived from the file set rather than from a list of aliases: the directories
 * the repository actually contains. A specifier that mentions one of them names
 * something here, whatever prefix it wears.
 */
const internalNames = (workspace: Workspace): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const file of workspace.files) {
    const parts = file.path.split("/")
    for (const part of parts.slice(0, -1)) names.add(part)
  }
  return names
}

const isInternalPath = (specifier: string, internal: ReadonlySet<string>): boolean => {
  // A specifier with a source extension names a file.
  if (/\.(?:[cm]?[jt]sx?)$/.test(specifier)) return true
  return specifier.split("/").some((segment) => internal.has(segment))
}

const dependenciesIn = (workspace: Workspace): Candidates => {
  const internal = internalNames(workspace)
  const grouped = new Map<
    string,
    {
      path: string
      directory: string
      declares: ReadonlyArray<string>
      specifier: string
      count: number
      examples: Array<string>
    }
  >()
  for (const edge of workspace.imports.edges) {
    // Internal imports are `layer-direction`'s business, and a relative specifier
    // cannot be a dependency on a framework.
    if (edge.resolution === "resolved") continue
    if (edge.specifier.startsWith(".") || edge.specifier.startsWith("/")) continue
    if (BUILTINS.has(edge.specifier)) continue
    // A path into an installed tree is not an import of a package, and a package
    // importing itself is internal structuring rather than a dependency.
    if (edge.specifier.includes("/node_modules/")) continue
    if (isInternalPath(edge.specifier, internal)) continue
    const cut = edge.importer.lastIndexOf("/")
    const directory = cut === -1 ? "." : edge.importer.slice(0, cut)
    const manifest = workspace.manifests.get(directory)
    // The package's own name is a better grouping than two path segments: it is
    // what the package IS rather than where it happens to sit, and it collapses
    // `packages/fasdentify/src/a.ts` and `packages/fasdentify/test/b.ts` into one
    // thing without guessing at a directory depth.
    const path = manifest?.name ?? moduleOf(edge.importer)
    if (path.length === 0) continue
    const key = path + "\u0000" + edge.specifier
    const existing = grouped.get(key)
    if (existing === undefined) {
      grouped.set(key, {
        path,
        directory,
        declares: manifest?.declares ?? [],
        specifier: edge.specifier,
        count: 1,
        examples: [edge.importer],
      })
      continue
    }
    existing.count += 1
    if (existing.examples.length < policy.evidence.maxListedPaths) existing.examples.push(edge.importer)
  }
  const sorted = [...grouped.values()].sort(
    (left, right) =>
      left.path.localeCompare(right.path) || left.specifier.localeCompare(right.specifier),
  )
  // A dependency the package declares for itself is answered before it is asked.
  // This is the case that made the rule look foolish: `packages/fasdentify
  // depends on fastify in 29 files` is not a violation, it is what fasdentify is
  // FOR, and its own manifest said so all along. No call, no judgement, no
  // configuration -- a fact, derived from the file the package already keeps.
  const dependencies: Array<Dependency> = []
  const declared: Array<{ dependency: Dependency; specifier: string }> = []
  for (const entry of sorted) {
    const named = packageNameOf(entry.specifier)
    const manifest = workspace.manifests.get(entry.directory)
    if (manifest !== undefined && manifest.name === named) continue
    if (entry.declares.includes(named)) {
      declared.push({ dependency: entry, specifier: entry.specifier })
      continue
    }
    dependencies.push(entry)
  }
  return { dependencies, declared }
}

/** The one question about one dependency, pointing at its atom by id. */
const dependencyReview = (id: string) => ({
  fit: Decision.classify({
    instructions: [
      `Does \`atoms[${id}].dependency.specifier\` belong in \`atoms[${id}].package.path\`?`,
      `Inspect \`atoms[${id}].package\` and \`atoms[${id}].dependency\`.`,
      `\`atoms[${id}].package.describes_itself_as\` is what this package says it is, and \`atoms[${id}].repository\` describes what the codebase is trying to be. Judge the dependency against BOTH: a Fastify plugin importing fastify is a package doing its job, and the same import in a domain package is the thing the architecture exists to prevent. Do not apply a constraint that belongs to one package to every package.`,
      "Choose `belongs` unless something is clearly wrong. This rule is meant to be quiet.",
    ].join("\n"),
    criteria: dependencyVocabulary,
  }),
})

// meta-allow: band-the-answer -- the finding is the FACT (an undeclared import),
// which is true whatever the model says; the judgement only qualifies it, so
// there is no judged finding to withhold.
export const dependencyFit: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A package depends on something its architecture says it should not.",
  judged: true,
  // The finding is a fact -- an undeclared import -- and the rule reads the
  // absence of a judgement itself, so the engine must call it rather than skip it.
  onUnavailable: "report",
  messages: messages({
    undeclared_dependency:
      "{{path}} imports {{specifier}} in {{count}} file(s) but does not declare it.",
    undeclared_dependency_help:
      "Add {{package}} to the package's manifest: an undeclared import resolves only because something else hoisted it into the tree. {{qualifier}}",
  }),
  plan: Effect.fn("joggle/dependency-fit")(function* (
    workspace: Workspace,
    scope: Scope,
    context,
  ) {
    const report = reporter(dependencyFit, locator(workspace))
    const { dependencies: all, declared } = dependenciesIn(workspace)
    // A scoped run asks about the CHANGE, and the change to a dependency is an
    // IMPORT: the candidate is in scope when one of the files that imports it
    // moved. Judging every undeclared import in the repository on every push is
    // the full cost with none of the scoping.
    const dependencies =
      scope.changed === undefined
        ? all
        : all.filter((dependency) => dependency.examples.some((file) => inGraphScope(scope, file)))
    if (dependencies.length === 0 && declared.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no external dependency needed judging: everything imported is declared by its package or built into node",
          ]),
      }
    }
    const budget = policy.dependencyFit.maxDependencies
    const judged = dependencies.slice(0, budget)
    const label = (dependency: Dependency): string =>
      dependency.path + " -> " + dependency.specifier
    const answeredItself = declared.map((entry) => ({
      ruleId: RULE_ID,
      subject: label(entry.dependency),
      stage: "declined" as const,
      reason:
        "the package declares " +
        entry.specifier +
        " in its own manifest, so importing it is what the package is for",
    }))
    // Declared dependencies are drops, not answers: the funnel has to account for
    // every candidate, and 129 of 241 never reached the model. This was computed
    // and then thrown away until plumb's no-unused-vars reported it, which is a
    // per-file rule finding a bug in the cross-file tool's own reporting.
    const overBudget: ReadonlyArray<Drop> = dependencies.slice(budget).map((dependency) => ({
      ruleId: RULE_ID,
      subject: label(dependency),
      stage: "budget" as const,
      reason: "this run judged " + budget + " dependencies and this one was past the budget",
    }))

    const atoms = yield* Atoms
    const planned: Array<{ readonly dependency: Dependency; readonly plan: Plan<DecisionAnswers> }> = []
    for (const dependency of judged) {
      const manifest = workspace.manifests.get(dependency.directory)
      const id = yield* atoms.add({
        repository: context.config.evidence?.repository ?? null,
        package: {
          path: dependency.path,
          // What the package says it IS. Without this the panel is asked whether
          // a package should import a framework while being told nothing about
          // the package -- and answers correctly for the wrong package.
          name: manifest?.name ?? null,
          describes_itself_as: manifest?.summary ?? null,
          imports_this_in: dependency.count,
          examples: dependency.examples,
        },
        dependency: { specifier: dependency.specifier },
      })
      planned.push({
        dependency,
        plan: {
          ruleId: RULE_ID,
          subject: label(dependency),
          concerns: dependency.examples,
          atoms: [id],
          violations: { fit: ["violates"] },
          decisions: dependencyReview(id),
          read: (answers) => answers,
        },
      })
    }

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...answeredItself, ...overBudget]
        planned.forEach((entry, index) => {
          const dependency = entry.dependency
          const answer = verdicts[index]
          if (answer === undefined) {
            drops.push({
              ruleId: RULE_ID,
              subject: label(dependency),
              stage: "unreadable",
              reason: "the response contained nothing for this dependency",
            })
            return
          }
          const verdict = answer["fit"]
          if (verdict === undefined || !("label" in verdict)) {
            drops.push({
              ruleId: RULE_ID,
              subject: label(dependency),
              stage: "unreadable",
              reason: "the response contained nothing for this dependency",
            })
            return
          }
      // The model only decides WHICH of two problems this is. That the package
      // imports something it does not declare is a fact, and it is the more
      // common one: `@autotelic/fasdentify` imports `fastify` in 29 files and its
      // manifest has no `fastify` entry. That works on a developer's machine and
      // fails on a clean install, because it is only there by hoisting.
      // A Choice that barely won is not a decision, and a package that imports
      // something it does not declare is a fact regardless of what the model
      // thinks of it -- so the gate decides the QUALIFIER, not the finding.
      const margin = marginOfAnswer(verdict)
      const decisive = margin >= policy.decision.gates.minMargin
      // The FACT leads and the judgement qualifies it. That the package imports
      // something it does not declare is derived, not decided -- and it is the
      // finding that matters most here, because it works on a developer's machine
      // and fails on a clean install.
      const misplaced = verdict.label === "violates"
      diagnostics.push(
        report({
                  about: { file: dependency.examples[0] ?? dependency.path, start: 0 },
                  messageId: "undeclared_dependency",
                  data: {
                    path: dependency.path,
                    specifier: dependency.specifier,
                    count: dependency.count,
                    package: packageNameOf(dependency.specifier),
                    qualifier:
                      misplaced && decisive
                        ? "It also does not appear to fit what this package is for, so consider removing it instead."
                        : "The dependency itself fits what this package does.",
                  },
                  helpId: "undeclared_dependency_help",
                  identity: [
                    RULE_ID,
                    misplaced ? "misplaced" : "undeclared",
                    dependency.path,
                    dependency.specifier,
                  ].join("\u0000"),
                  confidence: verdict.confidence ?? 1,
                  judged: false,
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "dependencies",
            judged: budget,
            candidates: dependencies.length,
            sample: dependencies.slice(budget).map(label),
          }),
          drops,
        )
      },
    }
  })
}
