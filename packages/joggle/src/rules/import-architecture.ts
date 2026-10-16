import { Effect, Order } from "effect"
import { Decision } from "effect/unstable/ai"
import {
  cyclesIn,
  directionViolations,
  layerOf,
  layersFrom,
  purityViolations,
} from "../architecture.ts"
import { Atoms } from "../atoms.ts"
import { type PlannedCandidate } from "../plans.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Span } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  inGraphScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type RunContext,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { ImportEdge } from "../imports.ts"
import type { SourceFile, Workspace } from "../workspace.ts"

const LAYER_RULE = "joggle/layer-direction"
const CYCLE_RULE = "joggle/import-cycle"
const PURITY_RULE = "joggle/layer-purity"

/** Every architecture rule reports through these. */
const ARCHITECTURE_MESSAGES = messages({
  upward_import:
    "{{from}} imports {{to}}, which sits in {{toLayer}} -- a layer above {{fromLayer}}.",
  upward_import_help:
    "joggle.config.json declares the layers bottom-up, so {{fromLayer}} may not depend on {{toLayer}}. Move the shared piece down, or invert the dependency by passing it in.",
  import_cycle: "Import cycle: {{files}}.",
  import_cycle_help:
    "Break the loop by moving the shared piece below both modules, or by passing the dependency in.",
  forbidden_import: "{{from}} imports {{specifier}}, which the {{layer}} layer forbids.",
  forbidden_import_help:
    "The {{layer}} layer declares {{pattern}} forbidden in joggle.config.json, so nothing inside it may reach for {{specifier}}. Take what this needs as an argument, or move the file out of the layer.",
})

/**
 * Where an import statement sits, as an offset the engine turns into a location.
 *
 * The import graph carries specifiers but not positions, and a finding with no
 * position is a finding a reader has to go looking for.
 */
const spanOf = (files: ReadonlyMap<string, SourceFile>, edge: ImportEdge): Span => {
  const file = files.get(edge.importer)
  if (file === undefined) return { file: edge.importer, start: 0 }
  for (const quote of ['"', "'"]) {
    const index = file.text.indexOf(quote + edge.specifier + quote)
    if (index !== -1) return { file: edge.importer, start: index }
  }
  return { file: edge.importer, start: 0 }
}

const filesByPath = (workspace: Workspace): ReadonlyMap<string, SourceFile> =>
  new Map(workspace.files.map((file) => [file.path, file]))

/**
 * Read one verdict against its violating label.
 *
 * The band, not the rule: a decisive answer is a finding, a non-decisive one is
 * recorded (`flagged: ...`), and any other label is a decline with its reason.
 */
const readVerdict = (
  answer: DecisionAnswers[string] | undefined,
  violating: string,
  declineReason: (label: string) => string,
): { readonly action: "report"; readonly review: boolean } | { readonly action: "drop"; readonly stage: "declined" | "gated"; readonly reason: string } => {
  const verdict = verdictOf(answer, [violating])
  if (verdict === undefined) {
    return { action: "report", review: false }
  }
  if (verdict.label !== violating) {
    return { action: "drop", stage: "declined", reason: declineReason(verdict.label ?? "unreadable") }
  }
  const quality = qualityOf({
    score: verdict.probability,
    margin: verdict.margin,
    confidence: verdict.confidence,
  })
  if (quality.quality === "drop") {
    return {
      action: "drop",
      stage: "gated",
      reason: quality.reason,
    }
  }
  return { action: "report", review: quality.quality === "review" }
}

/**
 * Dependencies point one way.
 *
 * The upward edge is decidable from the import graph. Whether the layer
 * assignment is what is wrong, or the import is a genuine mistake, is the
 * question.
 */
export const layerDirection: PlannedRule = {
  id: LAYER_RULE,
  severity: "warn",
  description: "A module imports from a layer that sits above it.",
  judged: true,
  onUnavailable: "report",
  messages: ARCHITECTURE_MESSAGES,
  plan: Effect.fn("joggle/layer-direction")(function* (
    workspace: Workspace,
    scope: Scope,
    context: RunContext,
  ) {
    const layers = layersFrom(context.config)
    if (layers.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no layers are declared in the config, so there is no direction to check -- not the same as finding none",
          ]),
      }
    }

    const all = directionViolations(workspace.imports, layers)
    const violations =
      scope.changed === undefined ? all : all.filter((violation) => inGraphScope(scope, violation.from))
    const report = reporter(layerDirection, locator(workspace))
    const files = filesByPath(workspace)
    const edgeAt = new Map(workspace.imports.edges.map((edge) => [edge.importer + "\u0000" + edge.to, edge]))

    const candidates = violations.flatMap((violation) => {
      const edge = edgeAt.get(violation.from + "\u0000" + violation.to)
      return edge === undefined ? [] : [{ violation, edge }]
    })

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(candidates, (candidate) =>
      Effect.gen(function* () {
        const { violation, edge } = candidate
        const id = yield* atoms.add({
          from: violation.from,
          to: violation.to,
          fromLayer: violation.fromLayer,
          toLayer: violation.toLayer,
          specifier: edge.specifier,
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: LAYER_RULE,
          subject: violation.from + " -> " + violation.to,
          concerns: [violation.from],
          atoms: [id],
          violations: { verdict: ["upward"] },
          decisions: {
            verdict: Decision.classify({
              instructions: [
                "`atoms[" + id + "].from` (" + violation.fromLayer + ") imports `atoms[" + id + "].to` (" + violation.toLayer + "), and the config declares " + violation.toLayer + " above " + violation.fromLayer + ", so this edge points upward.",
                "Is that an upward dependency to break, or is the layer assignment itself what is wrong?",
                "Answer `upward` when the dependency genuinely points the wrong way, so the shared piece should move down or be passed in.",
                "Answer `misclassified` when the importing or imported file is in the wrong layer, so the config should change.",
                "Answer `exception` when the upward edge is deliberate and acceptable.",
              ].join("\n"),
              criteria: {
                upward: "A real upward dependency. Move the shared piece down, or invert it.",
                misclassified: "The layer assignment is wrong, not the import.",
                exception: "A deliberate, acceptable exception.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { candidate, id, plan } satisfies PlannedCandidate<typeof candidate>
      }),
      { concurrency: "unbounded" },
    )

    const unranked = workspace.files.filter((file) => layerOf(layers, file.path) === undefined).length
    const ranked = workspace.files.length - unranked

    return {
      plans: planned.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        planned.forEach((value, index) => {
          const { violation, edge } = value.candidate
          const outcomeOf = readVerdict(verdicts[index]?.["verdict"], "upward", (label) =>
            label === "misclassified" ? "the layer assignment is what is wrong" : "a deliberate exception",
          )
          if (outcomeOf.action === "drop") {
            drops.push({
              ruleId: LAYER_RULE,
              subject: violation.from + " -> " + violation.to,
              stage: outcomeOf.stage,
              reason: outcomeOf.reason,
            })
            return
          }
          const verdict = verdicts[index]?.["verdict"]
          const confidence = verdict !== undefined && "confidence" in verdict ? verdict.confidence : undefined
          diagnostics.push(
          report({
            about: spanOf(files, edge),
            messageId: "upward_import",
            data: {
              from: violation.from,
              to: violation.to,
              toLayer: violation.toLayer,
              fromLayer: violation.fromLayer,
            },
            helpId: "upward_import_help",
            identity: [LAYER_RULE, violation.from, violation.to].join("\u0000"),
            judged: true,
            confidence,
            severity: outcomeOf.review ? "info" : "warn",
          }),
        )
        })
        return outcome(diagnostics, [
          `${violations.length} upward import(s) among ${ranked} ranked file(s) in ${layers.length} declared layer(s); ${unranked} file(s) in no layer` +
            (all.length > violations.length ? `; ${all.length - violations.length} outside the scope of this run` : ""),
        ], drops)
      },
    }
  }),
}

/**
 * A module imports, directly or indirectly, from itself.
 *
 * The cycle is decidable. Whether it is a real mutual dependency to break, or a
 * false positive (a barrel, an erased type edge), is the question.
 */
export const importCycle: PlannedRule = {
  id: CYCLE_RULE,
  severity: "warn",
  description: "A module imports, directly or indirectly, from itself.",
  judged: true,
  onUnavailable: "report",
  messages: ARCHITECTURE_MESSAGES,
  plan: Effect.fn("joggle/import-cycle")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(importCycle, locator(workspace))
    const cycles = cyclesIn(workspace.imports)
    const runtime = cycles.filter((cycle) => cycle.runtime)
    const named = cycles.filter((cycle) => !cycle.runtime)

    const inCycleScope = (files: ReadonlyArray<string>): boolean =>
      scope.changed === undefined || files.some((file) => inGraphScope(scope, file))
    const anchorOf = (files: ReadonlyArray<string>): string =>
      scope.changed === undefined
        ? files[0] ?? ""
        : files.find((file) => inGraphScope(scope, file)) ?? files[0] ?? ""

    const scopedRuntime = runtime.filter((cycle) => inCycleScope(cycle.loop))
    const scopedNamed = named.filter((cycle) => inCycleScope(cycle.loop))
    const erasedEntirely = scopedNamed.filter((cycle) => cycle.typeOnly).length
    const partlyErased = scopedNamed.length - erasedEntirely
    const outside = runtime.length - scopedRuntime.length

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(scopedRuntime, (cycle) =>
      Effect.gen(function* () {
        const first = anchorOf(cycle.loop)
        const members = new Set(cycle.loop)
        // The edges that make the loop, so the question can tell a real mutual
        // dependency from a barrel or a re-export instead of reading file names.
        const edges = workspace.imports.edges
          .filter((edge) => members.has(edge.importer) && members.has(edge.to))
          .map((edge) => ({ from: edge.importer, to: edge.to, specifier: edge.specifier }))
        const id = yield* atoms.add({ files: cycle.loop, runtime: cycle.runtime, typeOnly: cycle.typeOnly, edges })
        const plan: Plan<DecisionAnswers> = {
          ruleId: CYCLE_RULE,
          subject: cycle.loop.join(" -> "),
          concerns: [...cycle.loop],
          atoms: [id],
          violations: { verdict: ["cycle"] },
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].files\` is an import cycle: ${[...cycle.loop, first].join(" -> ")}.`,
                `\`atoms[${id}].edges\` is the import statements that close the loop, with the specifier each one uses.`,
                "Is that a real mutual dependency to break, or a false positive?",
                "Answer `cycle` when two or more of the modules genuinely need each other, so the loop should be broken.",
                "Answer `false_positive` when the loop is an artefact -- a barrel or index re-export, a specifier that resolves to a type only, or an edge that is erased at build time.",
              ].join("\n"),
              criteria: {
                cycle: "A real loop. Move the shared piece below both, or pass it in.",
                false_positive: "Not a real mutual dependency. Nothing to break.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { cycle, first, id, plan }
      }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        planned.forEach((value, index) => {
          const { cycle, first } = value
          const subject = cycle.loop.join(" -> ")
          const outcomeOf = readVerdict(verdicts[index]?.["verdict"], "cycle", () =>
            "the cycle cannot cause a load-order problem",
          )
          if (outcomeOf.action === "drop") {
            drops.push({ ruleId: CYCLE_RULE, subject, stage: outcomeOf.stage, reason: outcomeOf.reason })
            return
          }
          const verdict = verdicts[index]?.["verdict"]
          const confidence = verdict !== undefined && "confidence" in verdict ? verdict.confidence : undefined
          diagnostics.push(
          report({
            about: { file: first, start: 0 },
            messageId: "import_cycle",
            data: { files: [...cycle.loop, first].join(" -> ") },
            helpId: "import_cycle_help",
            identity: [CYCLE_RULE, ...[...cycle.loop].sort(Order.String)].join("\u0000"),
            judged: true,
            confidence,
            severity: outcomeOf.review ? "info" : "warn",
          }),
        )
        })
        return outcome(
          diagnostics,
          [
            `${scopedRuntime.length} runtime cycle(s), ${erasedEntirely} type-only, ${partlyErased} partly erased, in ${workspace.imports.edges.length} import edge(s)` +
              (outside > 0 ? `; ${outside} cycle(s) outside the scope of this run` : ""),
            ...scopedNamed.map((cycle) =>
              cycle.typeOnly
                ? `type-only cycle, erased entirely at build time: ${cycle.loop.join(" -> ")}`
                : `cycle with an erased edge, so broken before it loads: ${cycle.loop.join(" -> ")}`,
            ),
          ],
          drops,
        )
      },
    }
  }),
}

/** A module imports something its layer forbids. */
export const layerPurity: PlannedRule = {
  id: PURITY_RULE,
  severity: "warn",
  description: "A module imports something its layer forbids.",
  judged: true,
  onUnavailable: "report",
  messages: ARCHITECTURE_MESSAGES,
  plan: Effect.fn("joggle/layer-purity")(function* (
    workspace: Workspace,
    scope: Scope,
    context: RunContext,
  ) {
    const layers = layersFrom(context.config)
    const constrained = layers.filter((layer) => layer.forbid.length > 0)
    if (constrained.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no layer declares a forbidden import, so there was nothing to check -- not the same as finding none",
          ]),
      }
    }

    const all = purityViolations(workspace.imports, layers)
    const violations =
      scope.changed === undefined ? all : all.filter((violation) => inGraphScope(scope, violation.importer))
    const report = reporter(layerPurity, locator(workspace))
    const files = filesByPath(workspace)
    const edgeAt = new Map(workspace.imports.edges.map((edge) => [edge.importer + "\u0000" + edge.specifier, edge]))

    const candidates = violations.flatMap((violation) => {
      const edge = edgeAt.get(violation.importer + "\u0000" + violation.specifier)
      return edge === undefined ? [] : [{ violation, edge }]
    })

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(candidates, (candidate) =>
      Effect.gen(function* () {
        const { violation } = candidate
        const id = yield* atoms.add({
          from: violation.importer,
          specifier: violation.specifier,
          layer: violation.layer,
          pattern: violation.pattern,
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: PURITY_RULE,
          subject: violation.importer + " -> " + violation.specifier,
          concerns: [violation.importer],
          atoms: [id],
          violations: { verdict: ["forbidden"] },
          decisions: {
            verdict: Decision.classify({
              instructions: [
                "The " + violation.layer + " layer declares `atoms[" + id + "].pattern` forbidden, and `atoms[" + id + "].from` imports `atoms[" + id + "].specifier`, which matches it.",
                "Is that a forbidden dependency, or a pattern that matched the wrong thing?",
                "Answer `forbidden` when the import genuinely reaches for what the layer forbids.",
                "Answer `false_match` when the pattern matched something the layer does not actually forbid.",
              ].join("\n"),
              criteria: {
                forbidden: "A real forbidden dependency. Take it as an argument, or move the file out of the layer.",
                false_match: "The pattern matched the wrong thing.",
              },
            }),
          },
          read: (answers) => answers,
        }
        return { candidate, id, plan } satisfies PlannedCandidate<typeof candidate>
      }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = []
        planned.forEach((value, index) => {
          const { violation, edge } = value.candidate
          const subject = violation.importer + " -> " + violation.specifier
          const outcomeOf = readVerdict(verdicts[index]?.["verdict"], "forbidden", () =>
            "the pattern matched something the layer does not forbid",
          )
          if (outcomeOf.action === "drop") {
            drops.push({ ruleId: PURITY_RULE, subject, stage: outcomeOf.stage, reason: outcomeOf.reason })
            return
          }
          const verdict = verdicts[index]?.["verdict"]
          const confidence = verdict !== undefined && "confidence" in verdict ? verdict.confidence : undefined
          diagnostics.push(
          report({
            about: spanOf(files, edge),
            messageId: "forbidden_import",
            data: {
              from: violation.importer,
              specifier: violation.specifier,
              layer: violation.layer,
              pattern: violation.pattern,
            },
            helpId: "forbidden_import_help",
            identity: [PURITY_RULE, violation.importer, violation.specifier].join("\u0000"),
            judged: true,
            confidence,
            severity: outcomeOf.review ? "info" : "warn",
          }),
        )
        })
        return outcome(
          diagnostics,
          [
            violations.length +
              " forbidden import(s) across " +
              constrained.length +
              " constrained layer(s)" +
              (all.length > violations.length
                ? "; " + String(all.length - violations.length) + " outside the scope of this run"
                : ""),
          ],
          drops,
        )
      },
    }
  }),
}

export const importArchitectureRules: ReadonlyArray<PlannedRule> = [
  layerDirection,
  layerPurity,
  importCycle,
]
