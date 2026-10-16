import { Effect, Option, Order, Schema } from "effect"
import * as AiError from "effect/unstable/ai/AiError"
import { Decision, DecisionModel } from "effect/unstable/ai"
import { isUnreachable } from "./decision.ts"
import { policy } from "./policy.ts"
import { budgetNote, type RunContext } from "./rule.ts"
import { moduleRoles, rankOfLabel, RoleRanking } from "./vocabulary.ts"
import type { Drop } from "./schema.ts"
import type { Unit, Workspace } from "./workspace.ts"

/*
 * What each module is for, and where that role sits, asked once and shared.
 *
 * This was inside `hoist-to-domain`, which classifies a module before asking
 * about its declarations. A second rule now needs the same answers, and the
 * judgement cache is content-addressed, so the second reader pays a replay rather
 * than a call: same module, same evidence, same question, same key.
 *
 * It is also the INFERRED replacement for a declared layering. A layering
 * computed from the import graph can never be violated by the import graph -- a
 * topological order respects every edge by construction -- so direction needs an
 * order from somewhere else. That order used to be `roleRank`, a hand-ranked
 * table in this file; it is now a question (`roleQuestions.rank`), because a
 * rank is a taste about what "domain" means and a repository whose UI is the
 * product would have been reported upside down.
 */

/**
 * The module a declaration belongs to.
 *
 * Four path segments, not the package. `services/rest` contains both
 * `src/routes` and `src/domain`, and asking whether the package is a transport
 * edge has no answer; four segments separates the two inside one package, which
 * is the line being looked for.
 */
export const moduleOf = (unit: Unit): string => {
  // The DIRECTORY, never the file.
  //
  // Four segments was right about the depth -- it separates `services/rest/src/
  // routes` from `services/rest/src/domain` inside one package -- and wrong about
  // the last segment. Taking the whole path when it was short made a file its own
  // module, so two files in one directory became an upward dependency between two
  // modules: `src/shared/is-node.ts` importing `src/shared/structural.ts` was
  // reported as utilities importing library core.
  const directories = unit.file.split("/").slice(0, -1)
  return directories.length <= 4 ? directories.join("/") : directories.slice(0, 4).join("/")
}

/**
 * The package a specifier names: `react`, `@oxlint/plugins`, `effect/unstable/...`.
 *
 * Shared with the dependency check, which learned it first: `fastify-cli/start.js`
 * is a path INTO `fastify-cli`, and comparing raw specifiers reports subpath
 * imports as undeclared.
 */
export const packageNameOf = (specifier: string): string => {
  const parts = specifier.split("/")
  const [first, second] = parts
  if (first === undefined) return specifier
  return first.startsWith("@") && second !== undefined ? first + "/" + second : first
}

/**
 * What the repository actually depends on, from its manifests and its imports.
 *
 * The material that separates `../react` from `@react`. A directory called
 * `react` and the React framework have the same name and nothing else in common,
 * and a model reading a path cannot tell which it is looking at -- but the
 * repository can: the framework is a declared dependency, or an unresolved
 * specifier some file imports, and a directory is neither.
 */
export const externalNames = (workspace: Workspace): ReadonlySet<string> => {
  const names = new Set<string>()
  for (const manifest of workspace.manifests.values()) {
    for (const declared of manifest.declares) names.add(declared)
  }
  for (const edge of workspace.imports.edges) {
    if (edge.resolution === "resolved") continue
    if (edge.specifier.startsWith(".") || edge.specifier.startsWith("/")) continue
    if (edge.specifier.startsWith("node:")) continue
    names.add(packageNameOf(edge.specifier))
  }
  return names
}

/** Every module in the workspace, with the declarations it holds. */
export const modulesOf = (
  workspace: Workspace,
): ReadonlyMap<string, ReadonlyArray<Unit>> => {
  const modules = new Map<string, Array<Unit>>()
  for (const unit of workspace.units) {
    const path = moduleOf(unit)
    const existing = modules.get(path)
    if (existing === undefined) modules.set(path, [unit])
    else existing.push(unit)
  }
  return modules
}

export const moduleDecisions = {
  role: Decision.classify({
    instructions: [
      "What is `module.path` for?",
      "Inspect `module` and `repository`.",
      "`repository` describes what this codebase is trying to be. Classify the module by what it IS, not by whether it is doing it well: a route directory full of business rules is still a transport edge.",
      "Choose `utilities` when it is a generic helper with no business meaning.",
    ].join("\n"),
    criteria: moduleRoles,
  }),
}

/** The evidence panel, as a Schema, because it is exactly what the model is asked about. */
const ModuleEvidence = Schema.Struct({
  repository: Schema.optionalKey(Schema.String),
  module: Schema.Struct({
    path: Schema.String,
    declarations: Schema.Number,
    examples: Schema.Array(Schema.String),
    imports: Schema.Array(Schema.String),
    shares_a_name_with_a_dependency: Schema.NullOr(Schema.String),
    /**
     * The roles of the modules that import this one, when they have been
     * decided. This is the material `derives_from` needs: machinery whose only
     * importers are edges sits below them, and the answer is a fact about who
     * depends on it rather than a constant in a table.
     */
    imported_by: Schema.Array(Schema.String),
  }),
})

const ModuleClassification = Decision.make({
  input: ModuleEvidence,
  decisions: moduleDecisions,
})

/**
 * The interface the callers read.
 *
 * The classification says WHAT a module is; `ranks` says where that thing sits
 * in the dependency order, from `RoleRanking` in vocabulary.ts.
 */
export interface Classified {
  /** Module path to the role the model chose. Modules it could not judge are absent. */
  readonly roles: ReadonlyMap<string, string>
  /**
   * Role name to the layer it sits in, lowest first, from `roleQuestions.rank`.
   *
   * Empty when the order could not be decided, which is not the same as "every
   * role is equal": a caller with no ranks reports nothing rather than guessing.
   */
  readonly ranks: ReadonlyMap<string, number>
  readonly notes: ReadonlyArray<string>
  readonly drops: ReadonlyArray<Drop>
}

/**
 * One question per module, batched, cached, and reported.
 *
 * A module nobody could classify is a drop with a reason rather than a silence:
 * every module skipped here is a module the callers below cannot reason about.
 */
export const classifyModules = (
  workspace: Workspace,
  context: RunContext,
  ruleId: string,
): Effect.Effect<Classified, AiError.AiError, DecisionModel.DecisionModel> =>
  Effect.gen(function* () {
    const modules = modulesOf(workspace)
    const listed = [...modules.entries()]
      .sort((left, right) => left[0].localeCompare(right[0]))
      .slice(0, policy.moduleRoles.maxModules)
    if (listed.length === 0) {
      return { roles: new Map(), ranks: new Map(), notes: ["no module to classify"], drops: [] }
    }

    const names = externalNames(workspace)

    // Which file belongs to which module, so an import can be attributed to the
    // module that makes it.
    const ownerOf = new Map<string, string>()
    for (const [path, units] of listed) {
      for (const unit of units) ownerOf.set(unit.file, path)
    }

    // What each module imports from outside the repository. A module called
    // `react` whose files import only type packages is not a rendering edge, and
    // this is how the model can see that rather than infer it from the name.
    const externalByModule = new Map<string, Set<string>>()
    for (const edge of workspace.imports.edges) {
      if (edge.resolution === "resolved") continue
      if (edge.specifier.startsWith(".") || edge.specifier.startsWith("/")) continue
      if (edge.specifier.startsWith("node:")) continue
      const module = ownerOf.get(edge.importer)
      if (module === undefined) continue
      const found = externalByModule.get(module) ?? new Set<string>()
      found.add(packageNameOf(edge.specifier))
      externalByModule.set(module, found)
    }

    // Who imports each module, as paths. The classification can name a module's
    // role but not its rank; `derives_from` needs the importers, and computing
    // them here means the rank question gets them without a second graph walk.
    const importersByModule = new Map<string, Set<string>>()
    for (const edge of workspace.imports.edges) {
      if (edge.resolution === "unresolved") continue
      const from = ownerOf.get(edge.importer)
      const to = ownerOf.get(edge.to)
      if (from === undefined || to === undefined || from === to) continue
      const found = importersByModule.get(to) ?? new Set<string>()
      found.add(from)
      importersByModule.set(to, found)
    }

    const answered = yield* Effect.forEach(
      listed,
      ([path, units]) => {
        // A module whose last path segment matches something the repository
        // depends on. `null` is the useful answer: nothing here is called that.
        const last = path.split("/").at(-1) ?? path
        const collision = names.has(last) ? last : null
        const repository = context.config.evidence?.repository
        const panel = {
          module: {
            path,
            declarations: units.length,
            examples: [...new Set(units.map((unit) => unit.file))].slice(
              0,
              policy.evidence.maxListedPaths,
            ),
            imports: [...(externalByModule.get(path) ?? [])]
              .sort(Order.String)
              .slice(0, policy.evidence.maxListedPaths),
            shares_a_name_with_a_dependency: collision,
            // The module paths that import this one. The rank question uses them
            // for `derives_from`, which is the one position that is a fact about
            // the graph rather than a taste about the words.
            imported_by: [...(importersByModule.get(path) ?? [])]
              .sort((left, right) => left.localeCompare(right))
              .slice(0, policy.evidence.maxListedPaths),
          },
        }
        const evidence = repository === undefined ? panel : { ...panel, repository }
        return DecisionModel.decide(ModuleClassification, { input: evidence }).pipe(
          Effect.map((result) => Option.some(result.answers.role.label)),
          // One candidate that cannot be read is a drop for that candidate, not a
          // failed run: the other modules still deserve an answer. A model that
          // was never reached is different -- the whole rule steps aside.
          Effect.catchIf(
            (error) => !isUnreachable(error),
            () => Effect.succeed(Option.none<string>()),
          ),
        )
      },
      { concurrency: policy.decision.requestConcurrency },
    )

    const roles = new Map<string, string>()
    const drops: Array<Drop> = []
    listed.forEach(([path, units], index) => {
      const role = answered[index]
      if (role === undefined || Option.isNone(role)) {
        for (const _unit of units) {
          drops.push({
            ruleId,
            subject: path,
            stage: "unreadable",
            reason: "the module could not be classified",
          })
        }
        return
      }
      roles.set(path, role.value)
    })

    // ROUND TWO: where does each role sit? One question over the whole set,
    // because "machinery whose only importers are edges sits below an edge" is a
    // statement about the set and answering it per module throws the set away.
    const distinct = [...new Set(roles.values())].sort((left, right) => left.localeCompare(right))
    const ranks = yield* rankRoles(workspace, context, distinct)

    const unclassified = listed.filter(([path]) => !roles.has(path)).length
    return {
      roles,
      ranks,
      notes: [
        listed.length +
          " module(s) classified" +
          (unclassified === 0 ? "" : ", " + unclassified + " unreadable"),
        ...(ranks.size === 0
          ? ["the roles could not be ordered, so no direction was checked"]
          : ["roles ordered lowest first: " + orderOf(ranks)]),
        ...budgetNote({
          unitKind: "modules",
          judged: policy.moduleRoles.maxModules,
          candidates: modules.size,
          sample: [...modules.keys()].slice(policy.moduleRoles.maxModules),
        }),
      ],
      drops,
    }
  })

/**
 * The order the roles sit in, asked for once.
 *
 * A `Choice` can only name one winner, so the question names the LOWEST role in
 * this repository and the rest of the order is derived from the ranks above it:
 * the model answers which role is bottom, and the labels' own numeric order
 * does the rest. `derives_from` is the exception -- it is a statement about who
 * imports this module, and it resolves to `domain` or `edge` by looking at the
 * importers, which is the one part that is a fact.
 *
 * A run with no model key gets an empty map, and every caller treats that as
 * "no order known" rather than guessing one. A rank nobody asked for is the
 * table this replaced.
 */
const rankRoles = (
  workspace: Workspace,
  context: RunContext,
  distinct: ReadonlyArray<string>,
): Effect.Effect<ReadonlyMap<string, number>, AiError.AiError, DecisionModel.DecisionModel> =>
  Effect.gen(function* () {
    if (distinct.length === 0) return new Map<string, number>()
    const repository = context.config.evidence?.repository
    const panel = { roles: [...distinct] }
    const evidence = repository === undefined ? panel : { ...panel, repository }
    const decided = yield* DecisionModel.decide(RoleRanking, { input: evidence })
    const lowest = decided.answers.order.label
    const ranks = new Map<string, number>()
    // The answer names the bottom; everything else keeps the relative order the
    // labels encode, shifted so the named bottom is zero.
    const base = rankOfLabel[lowest]
    if (base === undefined) return ranks
    for (const role of distinct) {
      const rank = rankOfLabel[role]
      if (rank === undefined) continue
      ranks.set(role, rank - base)
    }
    return ranks
  })

/** The order, for the note. */
const orderOf = (ranks: ReadonlyMap<string, number>): string =>
  [...ranks.entries()]
    .sort((left, right) => left[1] - right[1] || left[0].localeCompare(right[0]))
    .map(([role]) => role.replace(/_/g, " "))
    .join(" below ")

/** The role of the module a file belongs to, if it has one. */
export const roleOfFile = (
  roles: ReadonlyMap<string, string>,
  workspace: Workspace,
  file: string,
): string | undefined => {
  const unit = workspace.units.find((candidate) => candidate.file === file)
  return unit === undefined ? undefined : roles.get(moduleOf(unit))
}
