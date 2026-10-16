import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import {
  blocksIn,
  findBundles,
  orphanBlocks,
  TRIPARTITE,
  unexportedBlocks,
  type Bundle,
} from "../bundles.ts"
import { Atoms } from "../atoms.ts"
import { type PlannedCandidate } from "../plans.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  bundleNote,
  inScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop, Severity } from "../schema.ts"
import type { Workspace } from "../workspace.ts"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["violation"] } as const

/** Every composition-pattern rule reports through these. */
const BUNDLE_MESSAGES = messages({
  pattern_problem: "{{subject}}: {{count}} problem(s) with the composition pattern.",
  pattern_problem_help: "{{problems}}{{unverified}}",
})

// The composition pattern's PRODUCER rules: is a bundle well formed?
//
// The problems are provable from structure alone -- a call, an element name, the
// keys of an object literal, the files in a directory. What is a JUDGEMENT is
// whether a bundle that departs from the pattern is a defect or a deliberate,
// acceptable variation. These used to be decided by the rule; now they are asked.
//
// Four rules rather than one, because the units and the severities differ and
// collapsing them would hide several judgments behind one answer.

interface Spec {
  readonly id: string
  readonly severity: Severity
  readonly description: string
  readonly problems: (bundle: Bundle) => ReadonlyArray<string>
  readonly describe: (bundle: Bundle) => string
}

const ruleFor = (spec: Spec): PlannedRule => ({
  id: spec.id,
  severity: spec.severity,
  description: spec.description,
  judged: true,
  onUnavailable: "report",
  messages: BUNDLE_MESSAGES,
  plan: Effect.fn(`joggle/${spec.id}`)(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(
      { id: spec.id, severity: spec.severity, judged: true, messages: BUNDLE_MESSAGES },
      locator(workspace),
    )
    const bundles = findBundles(workspace).filter((bundle) => inScope(scope, bundle.dir))
    const candidates = bundles
      .map((bundle) => ({ bundle, problems: spec.problems(bundle) }))
      .filter((candidate) => candidate.problems.length > 0)

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () => outcome([], bundleNote({ bundles: bundles.length, broken: 0 })),
      }
    }

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(candidates, (candidate) =>
      Effect.gen(function* () {
        const { bundle, problems } = candidate
        const id = yield* atoms.add({
          bundle: bundle.name,
          dir: bundle.dir,
          index: bundle.indexFile?.path ?? null,
          problems,
        })
        const plan: Plan<DecisionAnswers> = {
          ruleId: spec.id,
          subject: spec.describe(bundle),
          concerns: [bundle.dir],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: {
            verdict: Decision.classify({
              instructions: [
                `\`atoms[${id}].bundle\` is a composition bundle at \`atoms[${id}].dir\`. It breaks the pattern in ${problems.length} way(s): ${problems.join("; ")}.`,
                "Is that departure a defect, or a deliberate variation this repository can live with?",
                "Answer `violation` when the bundle breaks the pattern and should be brought back into line.",
                "Answer `acceptable` when the departure is deliberate and fine.",
                "Answer `different_pattern` when this directory is not following the composition pattern at all.",
              ].join("\n"),
              criteria: {
                violation: "A real defect. Bring the bundle back into line.",
                acceptable: "A deliberate variation. Nothing to change.",
                different_pattern: "This is not a composition bundle.",
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
          const { bundle, problems } = value.candidate
          const subject = spec.describe(bundle)
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, spec, bundle, problems, undefined, "no judgement was available", false))
            return
          }
          if (verdict.label !== "violation") {
            drops.push({
              ruleId: spec.id,
              subject,
              stage: "declined",
              reason:
                verdict.label === "acceptable"
                  ? "a deliberate variation"
                  : "not following the composition pattern",
            })
            return
          }
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({
              ruleId: spec.id,
              subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          const review = quality.quality === "review"
          diagnostics.push(findingFor(report, spec, bundle, problems, verdict.confidence, undefined, review))
        })
        return outcome(diagnostics, bundleNote({ bundles: bundles.length, broken: diagnostics.length }), drops)
      },
    }
  }),
})

const findingFor = (
  report: Report,
  spec: Spec,
  bundle: Bundle,
  problems: ReadonlyArray<string>,
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  review = false,
): Diagnostic =>
  report({
    about: bundle.indexFile ?? { file: bundle.dir, start: 0 },
    messageId: "pattern_problem",
    data: {
      subject: spec.describe(bundle),
      count: problems.length,
      problems: problems.join("; "),
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "pattern_problem_help",
    identity: [spec.id, bundle.dir].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: review ? "info" : spec.severity,
  })

const blockFiles = (bundle: Bundle): ReadonlyArray<string> =>
  bundle.blocks.map((file) => file.path)

/** 1. The index must export the blocks under one name, by dot notation. */
export const dotNotationExport = ruleFor({
  id: "joggle/bundle-dot-notation",
  severity: "warn",
  description: "A composition bundle whose index does not export its blocks by dot notation.",
  describe: (bundle) => `${bundle.name} (${bundle.dir})`,
  problems: (bundle) => {
    if (bundle.indexFile === undefined) {
      return [`no index file, so there is no \`${bundle.name}.Block\` to import`]
    }
    if (bundle.dotExportKeys.length === 0) {
      return [
        `index exports named symbols instead of one object; the pattern wants \`export const ${bundle.name} = { Provider, ... }\``,
      ]
    }
    const missing = unexportedBlocks(bundle)
    const orphans = orphanBlocks(bundle)
    const problems: Array<string> = []
    if (missing.length > 0) problems.push(`index exports ${missing.join(", ")} but no block declares them`)
    if (orphans.length > 0) problems.push(`blocks not exported by the index: ${orphans.join(", ")}`)
    return problems
  },
})

/** 2. The provider's context value must be exactly state / actions / meta. */
export const tripartiteValue = ruleFor({
  id: "joggle/bundle-tripartite-value",
  severity: "warn",
  description: "A composition bundle whose context value is not { state, actions, meta }.",
  describe: (bundle) => `${bundle.name} (${bundle.dir})`,
  problems: (bundle) => {
    if (bundle.providerFile === undefined) {
      return ["no file renders a Provider, so the blocks have no composition root"]
    }
    const keys = bundle.providerValueKeys
    if (keys === undefined) {
      return [`${bundle.providerFile.path} passes no object with \`state\` and \`actions\` as the context value`]
    }
    const present = TRIPARTITE.filter((key) => keys.includes(key))
    const extra = keys.filter((key) => !TRIPARTITE.includes(key))
    const problems: Array<string> = []
    if (present.length < TRIPARTITE.length) {
      const missing = TRIPARTITE.filter((key) => !keys.includes(key))
      problems.push(`context value is missing ${missing.join(", ")}`)
    }
    if (extra.length > 0) problems.push(`context value carries ${extra.join(", ")}, which belongs inside state, actions or meta`)
    return problems
  },
})

/** 3. One file per block, and no orphans in either direction. */
export const oneFilePerBlock = ruleFor({
  id: "joggle/bundle-one-file-per-block",
  severity: "warn",
  description: "A composition bundle that does not keep one block per file.",
  describe: (bundle) => `${bundle.name} (${bundle.dir})`,
  problems: (bundle) => {
    const problems: Array<string> = []
    for (const file of bundle.blocks) {
      const names = blocksIn(file)
      if (names.length > 1) {
        problems.push(`${file.path} declares ${names.length} exported blocks (${names.join(", ")}); the pattern is one per file`)
      }
    }
    if (bundle.blocks.length === 0) problems.push("no block files: a bundle needs at least one")
    if (problems.length === 0 && blockFiles(bundle).length > 0 && bundle.dotExportKeys.length === 0) {
      problems.push("blocks exist but the index exports nothing")
    }
    return problems
  },
})

/** 4. The bundle's hook must read the context and refuse to work outside it. */
export const contextHook = ruleFor({
  id: "joggle/bundle-context-hook",
  severity: "warn",
  description: "A composition bundle with no hook, or a hook that does not read the context.",
  describe: (bundle) => `${bundle.name} (${bundle.dir})`,
  problems: (bundle) => {
    if (bundle.hookNames.length === 0) {
      return [`no \`use${bundle.name}\` hook, so blocks cannot read the context without importing it directly`]
    }
    const readsContext = bundle.hookFiles.some((file) =>
      file.facts.callSites.some(
        (site) => site.name === "useContext" || site.name.endsWith(".useContext"),
      ),
    )
    if (!readsContext) {
      return [`${bundle.hookNames.join(", ")} does not call \`useContext\`, so it is not the bundle's context hook`]
    }
    return []
  },
})

export const bundleRules: ReadonlyArray<PlannedRule> = [
  dotNotationExport,
  tripartiteValue,
  oneFilePerBlock,
  contextHook,
]