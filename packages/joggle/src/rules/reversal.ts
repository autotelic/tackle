import { Effect, Result, Schema } from "effect"
import { Decision, DecisionModel } from "effect/ai"
import { containmentPairs, exactGroups, fieldGroups } from "../candidates.ts"
import { policy } from "../policy.ts"
import { locator, messages, reporter } from "../reporting.ts"
import { budgetNote, outcome, qualityOf, type Rule, type Scope } from "../rule.ts"
import { stagedInput, type StageOutcome } from "../stages.ts"
import { verdictOf } from "../verdict.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import { type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/reversal"

// One site, one move.
//
// The three moves are a SEQUENCE, and they used to be three scanners with three
// candidate generators: a copy was reported by the duplicate rules, a repeated
// part by compose-types, an unnamed field set by name-the-primitive. Each was
// right on its own and the same declaration could appear in all three, with no
// way to read which move the code actually needs first.
//
// This rule walks a site through the stages and stops at the first that answers:
//
//   1. contract  the declaration is a copy of one that exists. A fact; no model.
//   2. combine   its fields are a named part plus more. A fact: the containment
//                is decidable from the two field sets.
//   3. expand    a group of fields repeats and no declaration names it. Asked,
//                because whether they are one idea is the question.
//
// The earlier stage's outcome is in the next stage's state, so a site that
// stopped at combine and a site that fell through to expand never share a cached
// answer.

const ExpandPanel = Schema.Struct({
  fields: Schema.Array(Schema.String),
  occurrences: Schema.Number,
  declarations: Schema.Array(Schema.String),
  fieldTypes: Schema.Array(
    Schema.Struct({ field: Schema.String, types: Schema.Array(Schema.String) }),
  ),
})

const expandDefinition = Decision.make({
  input: stagedInput(ExpandPanel),
  decisions: {
    expand: Decision.classify({
      instructions: [
        "`panel.fields` appear together in `panel.occurrences` declarations and no declared type names them.",
        "`panel.fieldTypes` is each field's resolved type across those declarations.",
        "`earlier` is what the earlier stages said: no copy to contract, and no named part to combine.",
        "Is that set of fields ONE THING -- a primitive that deserves a name and should be composed everywhere it appears -- or do those declarations reuse the names for different reasons?",
        "Answer `one_thing` when the fields always travel together as one concept.",
        "Answer `unrelated` when the declarations genuinely use them for different purposes.",
        "Answer `already_named` when a declared type already names exactly this set.",
      ].join("\n"),
      criteria: {
        one_thing: "The fields are one concept. Extract a named type and compose it everywhere.",
        unrelated: "Different purposes. No one type would be right.",
        already_named: "A declared type already covers exactly this field set.",
      },
    }),
  },
})

/** A declaration's identity for "the same site". */
const siteKey = (unit: Unit): string =>
  unit.file + "\u0000" + unit.name + "\u0000" + String(unit.start)

/** The names of a group, in a stable order, capped for a message. */
const namesOf = (units: ReadonlyArray<Unit>): ReadonlyArray<string> =>
  [...new Set(units.map((unit) => unit.name))].sort((left, right) => left.localeCompare(right))

export const reversal: Rule = {
  id: RULE_ID,
  severity: "info",
  description: "One site, one move: contract a copy, combine a named part, or expand the vocabulary.",
  judged: true,
  move: "contract",
  // Stage 3's question, declared for calibration: a plain rule has no plans,
  // so the instrument reads its violating label from here.
  violations: { expand: ["one_thing"] },
  messages: messages({
    stops_at_contract: "{{names}} are one declaration written {{count}} times: {{at}}.",
    stops_at_contract_help:
      "This is the contract stage: a primitive already exists. Keep one declaration, import it everywhere, and delete the copies. Nothing else has to change.",
    stops_at_combine: "`{{whole}}` repeats every field of `{{part}}` and adds {{count}}: {{added}}.",
    stops_at_combine_help:
      "This is the combine stage: the parts exist and the combination was never written. Declare `{{whole}}` as `{{part}} & { {{added}} }` so the shared part stays canonical ({{partAt}}){{tail}}.",
    stops_at_expand: "{{fields}} appear together in {{occurrences}} declarations and have no name.",
    stops_at_expand_help:
      "This is the expand stage: neither a copy nor a named part. The vocabulary has to grow -- extract these fields as a named type and compose it everywhere they appear ({{first}}){{tail}}.",
  }),
  run: Effect.fn("joggle/reversal")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(reversal, locator(workspace))
    const diagnostics: Array<Diagnostic> = []
    const drops: Array<Drop> = []
    const consumed = new Set<string>()
    let unjudged = 0

    // Stage 1 -- contract. A fact, so this stage never asks and never waits.
    const copies = exactGroups({
      units: workspace.units,
      kinds: ["shape"],
      minTokens: policy.reversal.minTokens,
      distinctFiles: true,
      separateTests: true,
      scope,
    })
    for (const group of copies) {
      const names = namesOf(group.members)
      const first = [...group.members].sort((left, right) => left.file.localeCompare(right.file))[0]
      diagnostics.push(
        report({
          about: first ?? { file: "", start: 0 },
          messageId: "stops_at_contract",
          data: {
            names: names.slice(0, 4).join(", "),
            count: group.members.length,
            // Where each copy is. A name alone is not a site: two files can hold
            // the same pair of names and a reader needs the paths to act.
            at: group.members
              .filter((unit) => names.slice(0, 4).includes(unit.name))
              .slice(0, 4)
              .map((unit) => unit.name + " at " + unit.file + ":" + String(unit.location.line))
              .join("; "),
          },
          helpId: "stops_at_contract_help",
          identity: [
            RULE_ID,
            "contract",
            ...group.members.map((unit) => unit.file + "#" + unit.name).sort((left, right) => left.localeCompare(right)),
          ].join("\u0000"),
          judged: false,
          severity: "warn",
          move: "contract",
          stoppedAt: "contract",
        }),
      )
      for (const unit of group.members) consumed.add(siteKey(unit))
    }

    // Stage 2 -- combine. The containment is a FACT: the whole's own field set is
    // a proper superset of a named part's. Whether the two are genuinely one
    // composition is the reader's call; the finding names the part and what was
    // added, and the only judgement left in this cascade is stage 3's.
    const combineOutcomes = new Map<string, StageOutcome>()
    const contained = containmentPairs({
      units: workspace.units,
      kinds: ["interface", "type"],
      minFields: policy.composeTypes.minFields,
      maxTypes: policy.composeTypes.maxTypes,
      scope,
    }).filter((pair) => !consumed.has(siteKey(pair.whole)))
    const combineBudget = Math.min(contained.length, policy.reversal.maxSites)
    for (const pair of contained.slice(0, combineBudget)) {
      combineOutcomes.set(siteKey(pair.whole), { stage: "combine", outcome: "contained" })
      diagnostics.push(
        report({
          about: pair.whole,
          messageId: "stops_at_combine",
          data: {
            whole: pair.whole.name,
            part: pair.part.name,
            count: pair.added.length,
            added: pair.added.join(", "),
            partAt: pair.part.file + ":" + String(pair.part.location.line),
            tail: "",
          },
          helpId: "stops_at_combine_help",
          identity: [RULE_ID, "combine", pair.whole.file, pair.whole.name, pair.part.name].join("\u0000"),
          judged: false,
          severity: "info",
          move: "combine",
          stoppedAt: "combine",
        }),
      )
      consumed.add(siteKey(pair.whole))
    }

    // Stage 3 -- expand. Asked, and its state carries what the earlier stages
    // said about the site.
    const groups = fieldGroups({
      units: workspace.units.filter(
        (unit) => unit.kind === "interface" || unit.kind === "type",
      ),
      minFields: policy.nameThePrimitive.minFields,
      minOccurrences: policy.nameThePrimitive.minOccurrences,
      scope,
    }).filter((entry) => entry.units.some((unit) => !consumed.has(siteKey(unit))))
    const expandBudget = Math.min(groups.length, policy.reversal.maxSites)
    for (const entry of groups.slice(0, expandBudget)) {
      const first = entry.units.find((unit) => !consumed.has(siteKey(unit))) ?? entry.units[0]
      if (first === undefined) continue
      const earlier: ReadonlyArray<StageOutcome> = [
        { stage: "contract", outcome: "none" },
        combineOutcomes.get(siteKey(first)) ?? { stage: "combine", outcome: "not_applicable" },
      ]
      const decided = yield* Effect.result(
        DecisionModel.decide(expandDefinition, {
          input: {
            stage: "expand",
            earlier,
            panel: {
              fields: entry.fields,
              occurrences: entry.units.length,
              declarations: entry.units.slice(0, 6).map((unit) => unit.name),
              fieldTypes: entry.fields.map((field) => ({
                field,
                types: [
                  ...new Set(
                    entry.units
                      .map((unit) => {
                        const member = unit.typeFacts?.members.find((item) => item.name === field)
                        return member === undefined ? unit.fieldTypes.get(field) : member.type
                      })
                      .filter((type): type is string => type !== undefined),
                  ),
                ].slice(0, 4),
              })),
            },
          },
        }),
      )
      if (Result.isFailure(decided)) {
        unjudged += 1
        continue
      }
      const verdict = verdictOf(decided.success.answers["expand"], ["one_thing"])
      if (verdict === undefined || verdict.label !== "one_thing") {
        drops.push({
          ruleId: RULE_ID,
          subject: "field group { " + entry.fields.join(", ") + " }",
          stage: "declined",
          reason:
            verdict === undefined
              ? "the answer could not be read"
              : verdict.label === "already_named"
                ? "a declared type already names this set"
                : "the declarations use the fields for different purposes",
        })
        continue
      }
      const quality = qualityOf({
        score: verdict.probability,
        margin: verdict.margin,
        confidence: verdict.confidence,
      })
      if (quality.quality === "drop") {
        drops.push({
          ruleId: RULE_ID,
          subject: "field group { " + entry.fields.join(", ") + " }",
          stage: "gated",
          reason: quality.reason,
        })
        continue
      }
      diagnostics.push(
        report({
          about: first,
          messageId: "stops_at_expand",
          data: {
            fields: entry.fields.join(", "),
            occurrences: entry.units.length,
            first: first.file + ":" + String(first.location.line),
            tail: "",
          },
          helpId: "stops_at_expand_help",
          identity: [RULE_ID, "expand", entry.fields.join("\u0000")].join("\u0000"),
          confidence: verdict.confidence,
          severity: quality.quality === "review" ? "info" : "warn",
          move: "expand",
          stoppedAt: "expand",
        }),
      )
    }

    const notes = [
      ...budgetNote({
        unitKind: "sites",
        judged: policy.reversal.maxSites,
        candidates: contained.length + groups.length,
        sample: contained
          .slice(combineBudget)
          .map((pair) => pair.whole.name)
          .concat(groups.slice(expandBudget).map((entry) => entry.fields.join(", ")))
          .slice(0, 3),
      }),
      ...(unjudged === 0
        ? []
        : [unjudged + " staged question(s) could not be read; only the facts were reported"]),
    ]
    return outcome(diagnostics, notes, drops)
  }),
}
