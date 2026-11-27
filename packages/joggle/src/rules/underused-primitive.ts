import { Effect, Result, Schema, SchemaParser } from "effect"
import { Decision } from "effect/ai"
import { existsSync, readFileSync } from "node:fs"
import { decodeSurface, isRecord, type SurfaceExport, type SurfacePackage } from "@autotelic/protocol"
import { Atoms } from "../atoms.ts"
import { evidenceKinds, type EvidenceKind } from "../evidence.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Reporter } from "../reporting.ts"
import {
  budgetNote,
  inScope,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import { projectRootOf, surfaceFileOf } from "../surface.ts"
import type { Unit, Workspace } from "../workspace.ts"
import { verdictOf } from "../verdict.ts"

const RULE_ID = "joggle/underused-primitive"

/** Three declarations are a capability; two are a coincidence. */
const MIN_EVIDENCE_UNITS = 3

/** The judgement sees a capability with examples, not 122 lines of it. */
const MAX_SAMPLE_UNITS = 8

/**
 * Files whose numbers are the suite's own, not a re-implementation.
 *
 * A `testTimeout: 30_000` in a vitest config and a fixture's clock arithmetic are
 * the harness being configured, not the product hand-rolling a duration. The unit's
 * own `test` flag covers test directories and `*.test.ts`; a config file is neither.
 */
const CONFIG_FILE = /(?:^|\/)[^/]*\.config\.[cm]?[jt]sx?$/u

const isEvidenceFile = (unit: Unit): boolean => !unit.test && !CONFIG_FILE.test(unit.file)

/** One export the judgement is shown, and the plan that asks about it. */
interface Attempt {
  readonly exported: SurfaceExport
  readonly package: SurfacePackage
  readonly plan: Plan<DecisionAnswers>
  readonly disposition: Decision.Classify<string>
}

/** One export the surface offers for a kind's evidence. */
interface Offer {
  readonly surfacePackage: SurfacePackage
  readonly exported: SurfaceExport
}

interface Candidate {
  readonly kind: EvidenceKind
  readonly units: ReadonlyArray<Unit>
  readonly offers: ReadonlyArray<Offer>
}

/**
 * The sites a judgement is shown: one per normalized shape, up to the sample bound.
 *
 * A pool that repeats the same `now - started` twenty times is one example with a
 * count beside it, not twenty examples. The count stays the true total.
 */
export const representativeUnits = (units: ReadonlyArray<Unit>): ReadonlyArray<Unit> => {
  const byShape = new Map<string, Unit>()
  for (const unit of units) {
    if (!byShape.has(unit.shape)) byShape.set(unit.shape, unit)
  }
  return [...byShape.values()].slice(0, MAX_SAMPLE_UNITS)
}

const wordsOf = (name: string): ReadonlyArray<string> =>
  name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "")

const wordSet = (name: string): ReadonlySet<string> => new Set(wordsOf(name))

const exportedInFamily = (surfaceExport: SurfaceExport, family: string): boolean =>
  wordSet(surfaceExport.name).has(family.toLowerCase())

const importPathOf = (surfacePackage: SurfacePackage, surfaceExport: SurfaceExport): string =>
  surfaceExport.module === "root"
    ? surfacePackage.name
    : surfacePackage.name + "/" + surfaceExport.module

/**
 * The exports of one family, best first.
 *
 * A name that shares a word with the declarations doing the arithmetic is the one a
 * person would have found themselves; when no name does, the family head is the
 * honest first try rather than the first export alphabetically. The rest follow so a
 * declined head can fall through to the next export instead of losing the family.
 */
const orderedExports = (
  exports: ReadonlyArray<SurfaceExport>,
  family: string,
  units: ReadonlyArray<Unit>,
): ReadonlyArray<SurfaceExport> => {
  const unitWords = new Set(units.flatMap((unit) => [...wordSet(unit.name)]))
  const shared = (surfaceExport: SurfaceExport): number =>
    wordsOf(surfaceExport.name).filter((word) => unitWords.has(word)).length
  const ranked = [...exports].sort(
    (left, right) =>
      shared(right) - shared(left) ||
      Number(right.name === family) - Number(left.name === family) ||
      left.name.localeCompare(right.name),
  )
  return ranked
}

/** Parse JSON without throwing it past the caller; a malformed surface is an empty one. */
const parseSurfaceText = SchemaParser.decodeResult(Schema.fromJsonString(Schema.Unknown))

/** The surface file, or undefined when it is absent, unreadable or malformed. */
const readSurface = ({
  root,
  surfacePath,
}: {
  readonly root: string
  readonly surfacePath: string
}): ReturnType<typeof decodeSurface> | undefined => {
  const file = surfaceFileOf({ root, surfacePath })
  if (!existsSync(file)) return undefined
  const parsed = Result.getOrUndefined(parseSurfaceText(readFileSync(file, "utf8")))
  return isRecord(parsed) ? decodeSurface(parsed) : undefined
}

const sampleOf = (unit: Unit) => ({
  name: unit.name,
  file: unit.file,
  line: unit.location.line,
  source: unit.text.slice(0, policy.evidence.maxSourceChars),
})

const adviceFor = ({
  disposition,
  path,
  name,
}: {
  readonly disposition: string | undefined
  readonly path: string
  readonly name: string
}): string => {
  switch (disposition) {
    case "use_export":
      return "Replace the hand-rolled arithmetic with `" + name + "` from `" + path + "`."
    case "use_our_wrapper":
      return "Route the arithmetic through the existing wrapper that `" + name + "` backs."
    case "home_it":
      return "`" + name + "` lives in `" + path + "`; import it from there. Do not create a wrapper module."
    default:
      return "The export does not do this; leave the declaration alone."
  }
}

const findingFor = (input: {
  readonly report: Reporter
  readonly candidate: Candidate
  readonly attempt: Attempt
  readonly unverifiedReason: string | undefined
  readonly confidence: number | undefined
  readonly score: number | undefined
  readonly disposition: string | undefined
}): Diagnostic => {
  const { candidate, attempt } = input
  const first = candidate.units[0]
  const location = first?.location ?? {
    file: "package.json",
    line: 1,
    column: 1,
  }
  const path = importPathOf(attempt.package, attempt.exported)
  const disposition = input.disposition
  return input.report({
    about: first ?? location,
    messageId: "underused_primitive",
    data: {
      family: candidate.kind.description,
      kind: candidate.kind.kind,
      count: candidate.units.length,
      exportName: attempt.exported.name,
      importPath: path,
      signature: attempt.exported.signature,
      advice: adviceFor({ disposition, path, name: attempt.exported.name }),
    },
    helpId: "underused_primitive_help",
    identity: [RULE_ID, candidate.kind.kind, attempt.exported.name].join("\u0000"),
    judged: input.unverifiedReason === undefined,
    confidence: input.confidence,
    score: input.score,
    move: "contract",
  })
}

const dispositionReview = (): Decision.Classify<string> =>
  Decision.classify({
    instructions: [
      "What should happen to the declarations in `atoms[0].declarations`?",
      "`atoms[0].export` is the export from the dependency; `atoms[0].declarations` are the hand-rolled sites.",
      "Choose `use_export` when the dependency's export is the replacement.",
      "Choose `use_our_wrapper` when the repository already has a wrapper the export backs, and the sites should go through that wrapper.",
      "Choose `home_it` when the export is the right home but the declarations should be imported where they are, not wrapped. Name that module; never create one.",
      "Choose `different` when the export does not do this at all.",
    ].join("\n"),
    criteria: {
      use_export: "Replace the arithmetic with the dependency's export.",
      use_our_wrapper: "Route through the wrapper this repository already has.",
      home_it: "Import the export from its existing module. Do not create a wrapper.",
      different: "The export does not do this. Leave the declarations alone.",
    },
  })

/** One plan per export attempt: the same question, asked about the next named export. */
const planFor = (input: {
  readonly candidate: Candidate
  readonly surfacePackage: SurfacePackage
  readonly exported: SurfaceExport
  readonly id: string
  readonly position: number
}): Attempt => {
  const { candidate, surfacePackage, exported, id, position } = input
  const disposition = dispositionReview()
  const plan: Plan<DecisionAnswers> = {
    ruleId: RULE_ID,
    subject: candidate.kind.description + " (" + surfacePackage.name + ")",
    concerns: [...new Set(candidate.units.map((unit) => unit.file))],
    atoms: [id],
    violations: { disposition: ["use_export", "use_our_wrapper", "home_it"] },
    decisions: {
      does: Decision.probability({
        instructions: [
          `Does \`atoms[${id}].exports[${position}]\` already do what the declarations in \`atoms[${id}].declarations\` do?`,
          "Read the export's signature and doc, then the sample declarations. The declarations were selected for an absence: none of them imports this family.",
          "Answer yes when a call to the export would replace the arithmetic without changing what the caller means. Answer no when the export is a different capability that happens to share a word.",
        ].join("\n"),
        criteria: {
          false: "The export is a different capability. The declarations are doing something it does not do.",
          true: "The export already supplies this capability. The declarations are a hand-rolled copy.",
        },
      }),
      disposition,
    },
    read: (answers) => answers,
  }
  return { exported, package: surfacePackage, plan, disposition }
}

export const underusedPrimitive: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A hand-rolled capability an installed dependency already exports.",
  judged: true,
  move: "contract",
  onUnavailable: "report",
  messages: messages({
    underused_primitive:
      "{{count}} declaration(s) do {{family}} by hand ({{kind}}) and {{exportName}} from {{importPath}} is imported nowhere: import { {{exportName}} } from \"{{importPath}}\" ({{signature}}).",
    underused_primitive_help: "{{advice}}",
  }),
  plan: Effect.fn("joggle/underused-primitive")(function* (
    workspace: Workspace,
    scope: Scope,
    context,
  ) {
    const report = reporter(underusedPrimitive, locator(workspace))
    const surface = readSurface({
      root: projectRootOf(workspace.root),
      surfacePath: context.config.surfacePath ?? ".joggle/surface.json",
    })
    if (surface === undefined || surface.packages.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no dependency surface: run `joggle surface build`"]),
      }
    }

    const importedNames = new Set(workspace.imports.edges.flatMap((edge) => [...edge.names]))
    const candidates: Array<Candidate> = []
    const tooSmall: Array<Drop> = []
    for (const kind of evidenceKinds) {
      const units = workspace.units.filter(
        (unit) => inScope(scope, unit.file) && isEvidenceFile(unit) && kind.matches(unit),
      )
      if (units.length < MIN_EVIDENCE_UNITS) {
        tooSmall.push({
          ruleId: RULE_ID,
          subject: `${kind.kind} (${kind.description})`,
          stage: "gated",
          reason: `only ${units.length} declaration(s); ${MIN_EVIDENCE_UNITS} are a capability, fewer are a coincidence`,
        })
        continue
      }
      const offers: Array<{ surfacePackage: SurfacePackage; exported: SurfaceExport }> = []
      for (const family of kind.families) {
        const inFamily = surface.packages.flatMap((surfacePackage) =>
          surfacePackage.exports
            .filter((surfaceExport) => exportedInFamily(surfaceExport, family))
            .map((surfaceExport) => ({ surfacePackage, exported: surfaceExport })),
        )
        if (inFamily.length === 0) continue
        // The absence: no name in this family is imported anywhere in the workspace.
        if (inFamily.some((offer) => importedNames.has(offer.exported.name))) continue
        const ordered = orderedExports(
          inFamily.map((offer) => offer.exported),
          family,
          units,
        )
        for (const surfaceExport of ordered) {
          const offer = inFamily.find((entry) => entry.exported === surfaceExport)
          if (offer !== undefined) offers.push(offer)
        }
      }
      if (offers.length === 0) continue
      candidates.push({ kind, units, offers: offers.slice(0, 3) })
    }

    candidates.sort(
      (left, right) =>
        right.units.length - left.units.length || left.kind.kind.localeCompare(right.kind.kind),
    )
    const budget = 3
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.kind.description,
      stage: "budget" as const,
      reason: "past the budget of " + budget + " kinds",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            kind: candidate.kind.kind,
            family: candidate.kind.description,
            count: candidate.units.length,
            exports: candidate.offers.map((offer) => ({
              name: offer.exported.name,
              module: offer.exported.module,
              kind: offer.exported.kind,
              signature: offer.exported.signature,
              doc: offer.exported.doc ?? null,
              package: offer.surfacePackage.name,
              version: offer.surfacePackage.version,
            })),
            declarations: representativeUnits(candidate.units).map(sampleOf),
          })
          return {
            candidate,
            attempts: candidate.offers.map((offer, position) =>
              planFor({
                candidate,
                surfacePackage: offer.surfacePackage,
                exported: offer.exported,
                id,
                position,
              }),
            ),
          }
        }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.flatMap((entry) => entry.attempts.map((attempt) => attempt.plan)),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget, ...tooSmall]
        let cursor = 0
        for (const entry of planned) {
          const { candidate } = entry
          const reviewed = entry.attempts.map((attempt) => {
            const answer = verdicts[cursor]
            cursor += 1
            const does = verdictOf(answer?.["does"], [])
            const dispositionAnswer = verdictOf(answer?.["disposition"], [
              "use_export",
              "use_our_wrapper",
              "home_it",
            ])
            const disposition =
              dispositionAnswer?.label !== undefined &&
              Object.keys(attempt.disposition.criteria).includes(dispositionAnswer.label)
                ? dispositionAnswer.label
                : undefined
            const quality =
              does === undefined || disposition === undefined
                ? undefined
                : qualityOf({
                    score: does.probability,
                    margin: does.margin,
                    confidence: dispositionAnswer?.confidence,
                  })
            return { attempt, does, dispositionAnswer, disposition, quality }
          })
          const accepted = reviewed.find(
            (review) =>
              review.does !== undefined &&
              review.disposition !== undefined &&
              review.disposition !== "different" &&
              review.quality !== undefined &&
              review.quality.quality !== "drop",
          )
          if (accepted !== undefined) {
            diagnostics.push(
              findingFor({
                report,
                candidate,
                attempt: accepted.attempt,
                unverifiedReason:
                  accepted.quality?.quality === "act" ? undefined : accepted.quality?.reason,
                confidence: accepted.dispositionAnswer?.confidence,
                score: accepted.does?.probability,
                disposition: accepted.disposition,
              }),
            )
            continue
          }
          const unavailable = reviewed.every((review) => review.does === undefined)
          if (unavailable) {
            diagnostics.push(
              findingFor({
                report,
                candidate,
                attempt: entry.attempts[0]!,
                unverifiedReason: "no judgement was available",
                confidence: undefined,
                score: undefined,
                disposition: undefined,
              }),
            )
            continue
          }
          drops.push({
            ruleId: RULE_ID,
            subject: candidate.kind.description,
            stage: "declined",
            reason:
              "no export does what the declarations do: " +
              reviewed
                .map((review) => review.attempt.exported.name + " " + (review.disposition ?? "unjudged"))
                .join(", "),
          })
        }
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "kinds",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((candidate) => candidate.kind.kind),
          }),
          drops,
        )
      },
    }
  }),
}
