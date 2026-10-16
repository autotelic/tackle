/**
 * The surface a rule author writes against.
 *
 * A linter is a registry, and a registry is only half a plugin system. The other
 * half is this file: one entry point exporting everything a rule needs, so an
 * opinion of your own is a module that imports `@autotelic/joggle/plugin` rather than three
 * relative paths into a package's internals.
 *
 * That distinction is not cosmetic. `../../../src/rule.ts` is a path a rule
 * author has to guess and a maintainer is free to move; `@autotelic/joggle/plugin` is a
 * promise. Everything re-exported here is supported, and anything not here is
 * not -- which is also how a rule author knows what they are allowed to rely on.
 *
 * The split follows what a rule actually does:
 *
 *   write one          defineRule, finding, outcome, the Rule interface
 *   read the code      Workspace, Unit, ImportGraph, SourceFile, Cluster
 *   ask a question     Decision, DecisionModel, the answer readers
 *   decide in code     qualityOf, marginOfAnswer, declined, the gate vocabulary
 *   know the shape     policy, the layer and composition helpers
 *
 * A deterministic rule needs only the first two, and that is deliberate: most
 * opinions are free, and the API should make the free path the easy one.
 */

/* Writing a rule. */
export * from "./rule.ts"

/* Reporting: the message registry, and naming a subject instead of a location. */
export * from "./reporting.ts"

/* The fence: the authorship rules a rule module must keep. */
export * from "./meta.ts"

/* The shapes a rule produces and reads. */
export * from "./schema.ts"

/* The code under analysis. */
export * from "./workspace.ts"
export * from "./imports.ts"
export * from "./cluster.ts"
export * from "./similarity.ts"

/*
 * Asking.
 *
 * A judged rule declares an Effect Decision and calls DecisionModel.decide. The
 * two namespaces, and `Schema` for the input panel, are what that takes, so they
 * are part of the promise rather than an import a rule author has to find.
 */
export { Decision, DecisionModel } from "effect/unstable/ai"

/*
 * The shared facts, and the engine that answers questions about them.
 *
 * A judged rule builds a `Plan` from the run's atoms and the engine answers every
 * plan in one request, from cache where it can. A rule that batches its own
 * candidates by hand is a rule that has taken over a job the engine now does.
 */
export * from "./atoms.ts"
export * from "./plans.ts"

/* The one reduction from an answer to P(violated), and the verdict it yields. */
export * from "./verdict.ts"

/* Deciding, and the vocabulary decisions are made in. */
export * from "./policy.ts"
export * from "./vocabulary.ts"

/* Architecture: layers, direction, purity, and where something may reach. */
export * from "./architecture.ts"

/* The shared harness for rules whose unit is a set of declarations. */
export * from "./rules/cluster-verdict.ts"

/* The registry, so a preset can compose other presets. */
export * from "./plugins.ts"
export * from "./rules/index.ts"

/*
 * `Effect` itself, because a rule's `run` returns one. Leaving it out would make
 * the surface unusable for the one thing every rule must do.
 */
export { Effect, Schema } from "effect"
