import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { Effect } from "effect"
import { Decision } from "effect/ai"
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
import type { Unit, Workspace } from "../workspace.ts"
import { verdictOf } from "../verdict.ts"

const RULE_ID = "joggle/underused-primitive"

const DISPOSITIONS = ["use_export", "use_our_wrapper", "home_it", "different"] as const

type Disposition = (typeof DISPOSITIONS)[number]

interface Candidate {
  readonly kind: EvidenceKind
  readonly family: string
  readonly units: ReadonlyArray<Unit>
  readonly package: SurfacePackage
  readonly exported: SurfaceExport
}

const wordsOf = (name: string): ReadonlyArray<string> =>
  name
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .split(/[^A-Za-z0-9]+/u)
    .map((word) => word.toLowerCase())
    .filter((word) => word !== "")

const wordSet = (name: string): ReadonlySet<string> => new Set(wordsOf(name))

const exportedInFamily = (
  surfaceExport: SurfaceExport,
  family: string,
): boolean => wordSet(surfaceExport.name).has(family.toLowerCase())

const importPathOf = (surfacePackage: SurfacePackage, surfaceExport: SurfaceExport): string =>
  surfaceExport.module === "root"
    ? surfacePackage.name
    : surfacePackage.name + "/" + surfaceExport.module

/**
 * The export a reader should be pointed at.
 *
 * A name that shares a word with the declarations doing the arithmetic is the one a
 * person would have found themselves; when no name does, the family head is the
 * honest fallback rather than the first export alphabetically.
 */
const preferredExport = (
  exports: ReadonlyArray<SurfaceExport>,
  family: string,
  units: ReadonlyArray<Unit>,
): SurfaceExport | undefined => {
  const unitWords = new Set(units.flatMap((unit) => [...wordSet(unit.name)]))
  let best: SurfaceExport | undefined
  let bestShared = 0
  for (const surfaceExport of exports) {
    const shared = wordsOf(surfaceExport.name).filter((word) => unitWords.has(word)).length
    if (shared > bestShared) {
      best = surfaceExport
      bestShared = shared
    }
  }
  if (best !== undefined) return best
  const head = exports.find((surfaceExport) => surfaceExport.name === family)
  return head ?? exports[0]
}

/** The surface file, or undefined when it is absent or malformed. */
const readSurface = (
  root: string,
  surfacePath: string,
): ReturnType<typeof decodeSurface> | undefined => {
  const file = resolve(root, surfacePath)
  if (!existsSync(file)) return undefined
  try {
    const value: unknown = JSON.parse(readFileSync(file, "utf8"))
    return isRecord(value) ? decodeSurface(value) : undefined
  } catch {
    return undefined
  }
}

const sampleOf = (unit: Unit): Record<string, string | number> => ({
  name: unit.name,
  file: unit.file,
  line: unit.location.line,
  source: unit.text.slice(0, policy.evidence.maxSourceChars),
})

const adviceFor = (disposition: Disposition, path: string, name: string): string => {
  switch (disposition) {
    case "use_export":
      return "Replace the hand-rolled arithmetic with `" + name + "` from `" + path + "`."
    case "use_our_wrapper":
      return "Route the arithmetic through the existing wrapper that `" + name + "` backs."
    case "home_it":
      return "`" + name + "` lives in `" + path + "`; import it from there. Do not create a wrapper module."
    case "different":
      return "The export does not do this; leave the declaration alone."
  }
}

const findingFor = (input: {
  readonly report: Reporter
  readonly candidate: Candidate
  readonly unverifiedReason: string | undefined
  readonly confidence: number | undefined
  readonly score: number | undefined
  readonly disposition: Disposition | undefined
}): Diagnostic => {
  const { candidate } = input
  const first = candidate.units[0]
  const location = first?.location ?? {
    file: "package.json",
    line: 1,
    column: 1,
  }
  const path = importPathOf(candidate.package, candidate.exported)
  const disposition = input.disposition ?? "home_it"
  return input.report({
    about: first ?? location,
    messageId: "underused_primitive",
    data: {
      family: candidate.family,
      kind: candidate.kind.kind,
      count: candidate.units.length,
      exportName: candidate.exported.name,
      importPath: path,
      signature: candidate.exported.signature,
      advice: adviceFor(disposition, path, candidate.exported.name),
    },
    helpId: "underused_primitive_help",
    identity: [RULE_ID, candidate.kind.kind, candidate.family].join("\u0000"),
    judged: input.unverifiedReason === undefined,
    confidence: input.confidence,
    score: input.score,
    move: "contract",
  })
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
      "{{count}} declaration(s) do {{kind}} arithmetic and {{family}} from {{importPath}} is imported nowhere: import { {{exportName}} } from \"{{importPath}}\" ({{signature}}).",
    underused_primitive_help: "{{advice}}",
  }),
  plan: Effect.fn("joggle/underused-primitive")(function* (
    workspace: Workspace,
    scope: Scope,
    context,
  ) {
    const report = reporter(underusedPrimitive, locator(workspace))
    const surface = readSurface(workspace.root, context.config.surfacePath ?? ".joggle/surface.json")
    if (surface === undefined || surface.packages.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no dependency surface: run `joggle surface build`"]),
      }
    }

    const importedNames = new Set(workspace.imports.edges.flatMap((edge) => [...edge.names]))
    const candidates: Array<Candidate> = []
    for (const kind of evidenceKinds) {
      const units = workspace.units.filter(
        (unit) => inScope(scope, unit.file) && kind.matches(unit),
      )
      if (units.length === 0) continue
      for (const family of kind.families) {
        const offers: Array<{ surfacePackage: SurfacePackage; surfaceExport: SurfaceExport }> = []
        for (const surfacePackage of surface.packages) {
          for (const surfaceExport of surfacePackage.exports) {
            if (exportedInFamily(surfaceExport, family)) {
              offers.push({ surfacePackage, surfaceExport })
            }
          }
        }
        if (offers.length === 0) continue
        // The absence: no name in this family is imported anywhere in the workspace.
        if (offers.some((offer) => importedNames.has(offer.surfaceExport.name))) continue
        const preferred = preferredExport(
          offers.map((offer) => offer.surfaceExport),
          family,
          units,
        )
        if (preferred === undefined) continue
        const chosen = offers.find((offer) => offer.surfaceExport === preferred)
        if (chosen === undefined) continue
        candidates.push({
          kind,
          family,
          units,
          package: chosen.surfacePackage,
          exported: chosen.surfaceExport,
        })
      }
    }

    candidates.sort(
      (left, right) =>
        right.units.length - left.units.length || left.family.localeCompare(right.family),
    )
    const budget = 3
    const judged = candidates.slice(0, budget)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.family,
      stage: "budget" as const,
      reason: "past the budget of " + budget + " families",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (candidate) =>
        Effect.gen(function* () {
          const id = yield* atoms.add({
            kind: candidate.kind.kind,
            family: candidate.family,
            count: candidate.units.length,
            export: {
              name: candidate.exported.name,
              module: candidate.exported.module,
              kind: candidate.exported.kind,
              signature: candidate.exported.signature,
              doc: candidate.exported.doc ?? null,
              package: candidate.package.name,
              version: candidate.package.version,
            },
            declarations: candidate.units.slice(0, 8).map(sampleOf),
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: candidate.family + " (" + candidate.package.name + ")",
            concerns: [...new Set(candidate.units.map((unit) => unit.file))],
            atoms: [id],
            violations: { disposition: ["use_export", "use_our_wrapper", "home_it"] },
            decisions: {
              does: Decision.probability({
                instructions: [
                  `Does \`atoms[${id}].export\` already do what the declarations in \`atoms[${id}].declarations\` do?`,
                  "Read the export's signature and doc, then the sample declarations. The declarations were selected for an absence: none of them imports this family.",
                  "Answer yes when a call to the export would replace the arithmetic without changing what the caller means. Answer no when the export is a different capability that happens to share a word.",
                ].join("\n"),
                criteria: {
                  false: "The export is a different capability. The declarations are doing something it does not do.",
                  true: "The export already supplies this capability. The declarations are a hand-rolled copy.",
                },
              }),
              disposition: Decision.classify({
                instructions: [
                  `What should happen to the declarations in \`atoms[${id}].declarations\`?`,
                  `\`atoms[${id}].export\` is the export from \`${candidate.package.name}\`; \`atoms[${id}].declarations\` are the hand-rolled sites.`,
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
              }),
            },
            read: (answers) => answers,
          }
          return { candidate, plan }
        }),
      { concurrency: "unbounded" },
    )

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        planned.forEach((entry, index) => {
          const { candidate } = entry
          const answer = verdicts[index]
          const does = verdictOf(answer?.["does"], [])
          const dispositionAnswer = verdictOf(answer?.["disposition"], [
            "use_export",
            "use_our_wrapper",
            "home_it",
          ])
          const disposition =
            dispositionAnswer?.label !== undefined &&
            (DISPOSITIONS as ReadonlyArray<string>).includes(dispositionAnswer.label)
              ? (dispositionAnswer.label as Disposition)
              : undefined
          if (does === undefined || disposition === undefined) {
            diagnostics.push(
              findingFor({
                report,
                candidate,
                unverifiedReason: "no judgement was available",
                confidence: undefined,
                score: undefined,
                disposition: undefined,
              }),
            )
            return
          }
          if (disposition === "different") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.family,
              stage: "declined",
              reason: "the export does not do what the declarations do",
            })
            return
          }
          const quality = qualityOf({
            score: does.probability,
            margin: does.margin,
            confidence: dispositionAnswer?.confidence,
          })
          if (quality.quality === "drop") {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.family,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          diagnostics.push(
            findingFor({
              report,
              candidate,
              unverifiedReason: quality.quality === "act" ? undefined : quality.reason,
              confidence: dispositionAnswer?.confidence,
              score: does.probability,
              disposition,
            }),
          )
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "families",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((candidate) => candidate.family),
          }),
          drops,
        )
      },
    }
  }),
}
