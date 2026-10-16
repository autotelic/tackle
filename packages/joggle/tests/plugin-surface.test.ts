import { expect, test } from "vitest"
import { Effect } from "effect"
import { NodeServices } from "@effect/platform-node"
import * as plugin from "../src/plugin.ts"
import { answeringModel, diagnosticsOf, plannedDiagnosticsOf } from "../src/testing.ts"
import { loadWorkspace } from "../src/workspace.ts"
import { choice } from "./support.ts"

/**
 * The published surface, pinned.
 *
 * A rule author depends on these names. Removing or renaming one is a breaking
 * change for every opinion anyone has written, and it is the kind of break that
 * happens by accident during a refactor -- so the list is asserted rather than
 * remembered.
 */
const SURFACE = [
  // writing a rule
  "defineRule",
  "finding",
  "outcome",
  "budgetNote",
  // reading answers, and deciding in code
  "marginOfAnswer",
  "qualityOf",
  "declined",
  "decline",
  "declineNames",
  // the code under analysis
  "loadWorkspace",
  "clusterOf",
  "components",
  // shape helpers
  "policy",
  "layersFrom",
  "layerOf",
  "canImport",
  "sharedLayerFor",
  "assessClusters",
  "collapseQuestionnaire",
  "answerPlans",
  "Atoms",
  // asking, which a judged rule cannot do without
  "Decision",
  "DecisionModel",
  "Schema",
  // and the thing every rule's run returns
  "Effect",
] as const

test("the authoring surface exports what a rule needs", () => {
  const missing = SURFACE.filter((name) => (plugin as Record<string, unknown>)[name] === undefined)
  expect(missing).toEqual([])
})

test("a rule can be written against the surface and run by the tester", async () => {
  // A structural rule needs no model and no answers, which is the point: the API
  // makes the free path the easy one, for a built-in or for a rule a repository
  // writes itself.
  const trivial = plugin.defineRule({
    id: "test/trivial",
    severity: "info",
    description: "A rule with nothing to say.",
    judged: false,
    run: () => Effect.succeed(plugin.outcome([], [])),
  })
  const diagnostics = await Effect.runPromise(
    Effect.gen(function* () {
      const workspace = yield* loadWorkspace("tests/fixtures/layers", ["."])
      return yield* diagnosticsOf(trivial, workspace)
    }).pipe(Effect.provide(NodeServices.layer)),
  )
  expect(Array.isArray(diagnostics)).toBe(true)
})

test("the tester can answer for a judged rule", async () => {
  const judge = answeringModel({ answer: choice("x", 0.9) })
  const answer = await Effect.runPromise(
    Effect.gen(function* () {
      const model = yield* plugin.DecisionModel.DecisionModel
      const definition = plugin.Decision.make({
        input: plugin.Schema.Struct({}),
        decisions: {
          answer: plugin.Decision.classify({ instructions: "?", criteria: { x: "yes", y: "no" } }),
        },
      })
      const result = yield* model.decide(definition, { input: {} })
      return result.answers.answer.label
    }).pipe(Effect.provide(judge)),
  )
  expect(answer).toBe("x")
})

test("a judged rule can be written against the surface and run by the tester", async () => {
  // Everything below is the published surface and nothing else: `defineRule`,
  // `Decision`, `Atoms`, `Plan`, `verdictOf`, `finding`, `outcome`. An opinion of
  // your own is a module like this one, added to `plugins` in the config.
  const rule: plugin.PlannedRule = {
    id: "test/generic-name",
    severity: "info",
    description: "An opinion a repository could write for itself.",
    judged: true,
    onUnavailable: "report",
    plan: plugin.Effect.fn("test/generic-name")(function* (workspace, scope) {
      const atoms = yield* plugin.Atoms
      const planned: Array<plugin.Plan<plugin.DecisionAnswers>> = []
      for (const unit of workspace.units) {
        if (scope.changed !== undefined && !plugin.inScope(scope, unit.file)) continue
        const id = yield* atoms.add({ name: unit.name, file: unit.file })
        planned.push({
          ruleId: "test/generic-name",
          subject: unit.name,
          concerns: [unit.file],
          atoms: [id],
          // The same declaration the read uses, so calibration can reduce it too.
          violations: { verdict: ["generic"] },
          decisions: {
            verdict: plugin.Decision.classify({
              instructions: "Is `atoms[" + id + "].name` a generic single word?",
              criteria: { generic: "One word with no owner.", specific: "A named thing." },
            }),
          },
          read: (answers) => answers,
        })
      }
      return {
        plans: planned,
        read: (answers) => {
          const verdicts = plugin.verdictsOf<plugin.DecisionAnswers>(answers)
          const diagnostics: Array<plugin.Diagnostic> = []
          planned.forEach((entry, index) => {
            const verdict = plugin.verdictOf(verdicts[index]?.["verdict"], ["generic"])
            if (verdict === undefined || verdict.label !== "generic") return
            diagnostics.push(
              plugin.finding({
                ruleId: "test/generic-name",
                severity: "info",
                message: entry.subject + " is a generic name.",
                location: { file: entry.concerns[0] ?? "", line: 1, column: 1 },
                identity: ["test/generic-name", entry.subject].join("\u0000"),
                judged: true,
              }),
            )
          })
          return plugin.outcome(diagnostics)
        },
      }
    }),
  }

  const result = await Effect.runPromise(
    Effect.gen(function* () {
      const workspace = yield* loadWorkspace("tests/fixtures/layers", ["."])
      return yield* plannedDiagnosticsOf(rule, workspace)
    }).pipe(
      Effect.provide(answeringModel({ verdict: choice("generic", 0.9) })),
      Effect.provide(NodeServices.layer),
    ),
  )
  expect(result.diagnostics.length).toBeGreaterThan(0)
  expect(result.diagnostics[0]?.message).toContain("is a generic name")
})
