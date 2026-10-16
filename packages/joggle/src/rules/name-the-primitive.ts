import { Effect, Order } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms, type CandidateSample } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import { typeUnits, unitFields, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/name-the-primitive"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["one_thing"] } as const

// A group of fields that always appears together and has no name.
//
// `compose-types` finds a type that repeats a NAMED type; this finds the shape
// nobody has named yet -- the three or four fields that appear together in nine
// declarations and are re-declared each time, so every new declaration is a
// chance to get one of them slightly wrong.
//
// What is deterministic is the mining. Pair co-occurrence, then the intersection
// of the declarations that carry a pair, gives GROUPS without mining every subset
// of every declaration. What a person then decides -- is this genuinely one
// thing? -- used to be left to the reader. It is now asked.
const signatureOf = (fields: ReadonlyArray<string>): string => [...fields].sort(Order.String).join("\u0000")

export const nameThePrimitive: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A group of fields repeated across declarations with no name of its own.",
  judged: true,
  move: "expand",
  onUnavailable: "report",
  messages: messages({
    fields_unnamed:
      "{{fields}} appear together in {{count}} declaration(s) and are never named as one thing.",
    fields_unnamed_help:
      "Extract them as a named type and compose it, so the next declaration adds a field in one place instead of four. See {{file}}:{{line}}, where {{name}} repeats them.{{unverified}}",
  }),
  plan: Effect.fn("joggle/name-the-primitive")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(nameThePrimitive, locator(workspace))
    const { minFields, minOccurrences, maxFindings } = policy.nameThePrimitive
    const types = workspace.units.filter(typeUnits(policy.nameThePrimitive.minFields))
    if (types.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no type declaration has " +
              minFields +
              " or more fields, so there was nothing to mine for repeated groups",
          ]),
      }
    }

    // Every field set that already has a name, so a group that is one of them is
    // not a candidate: that is `compose-types`' finding, and it is the better one.
    const named = new Set(types.map((unit) => signatureOf(unitFields(unit))))

    const pairOccurrences = new Map<string, Array<Unit>>()
    for (const unit of types) {
      const fields = [...new Set(unitFields(unit))]
      for (let a = 0; a < fields.length; a += 1) {
        for (let b = a + 1; b < fields.length; b += 1) {
          const left = fields[a]
          const right = fields[b]
          if (left === undefined || right === undefined) continue
          const key = signatureOf([left, right])
          const existing = pairOccurrences.get(key)
          if (existing === undefined) pairOccurrences.set(key, [unit])
          else existing.push(unit)
        }
      }
    }

    const considered = [...pairOccurrences.entries()]
      .filter(([, units]) => units.length >= minOccurrences)
      .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))

    const groups: Array<{ units: ReadonlyArray<Unit>; fields: ReadonlyArray<string> }> = []
    for (const [, units] of considered) {
      const first = units[0]
      if (first === undefined) continue
      let group = new Set(unitFields(first))
      for (const unit of units) {
        const fields = new Set(unitFields(unit))
        group = new Set([...group].filter((field) => fields.has(field)))
      }
      if (group.size < minFields) continue
      if (named.has(signatureOf([...group]))) continue
      groups.push({ units, fields: [...group].sort(Order.String) })
    }
    groups.sort(
      (left, right) =>
        right.fields.length - left.fields.length ||
        right.units.length - left.units.length ||
        left.fields.join(",").localeCompare(right.fields.join(",")),
    )

    // A group already reported in full makes this one redundant: reporting
    // `{id, project, updated_at}` beside the five-field group that contains it is
    // the same finding twice.
    const kept: Array<ReadonlyArray<string>> = []
    const candidates: Array<{ units: ReadonlyArray<Unit>; fields: ReadonlyArray<string> }> = []
    for (const entry of groups) {
      const first = entry.units[0]
      if (first === undefined) continue
      if (scope.changed !== undefined && !scope.changed.has(first.file)) continue
      if (kept.some((seen) => entry.fields.every((field) => seen.includes(field)))) continue
      kept.push(entry.fields)
      candidates.push(entry)
    }

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            types.length +
              " type declaration(s); no field group repeats in " +
              minOccurrences +
              " or more declarations without already having a name",
          ]),
      }
    }

    const judged = candidates.slice(0, maxFindings)
    const overBudget: ReadonlyArray<Drop> = candidates.slice(maxFindings).map((entry) => ({
      ruleId: RULE_ID,
      subject: "field group { " + entry.fields.join(", ") + " }",
      stage: "budget" as const,
      reason: "past the budget of " + String(maxFindings) + " groups",
    }))

    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      (entry) =>
        Effect.gen(function* () {
          const first = entry.units[0]
          if (first === undefined) return undefined
          // The state is the field names and a bounded sample of the declarations
          // that carry them, not every declaration's source.
          const declarations: ReadonlyArray<CandidateSample> = entry.units.slice(0, 4).map((unit) => ({
            name: unit.name,
            file: unit.file,
            line: unit.location.line,
            source: unit.text.slice(0, policy.evidence.maxSourceChars > 200 ? 200 : policy.evidence.maxSourceChars),
          }))
          const id = yield* atoms.add({
            fields: entry.fields,
            occurrences: entry.units.length,
            declarations,
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: "field group { " + entry.fields.join(", ") + " }",
            concerns: [...new Set(entry.units.map((unit) => unit.file))],
            atoms: [id],
          violations: VIOLATIONS,
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].fields\` are ${entry.fields.length} field names that appear together in ${entry.units.length} declarations: ${entry.units.slice(0, 6).map((unit) => unit.name).join(", ")}. \`atoms[${id}].declarations\` shows a few of them.`,
                  "The fields appearing together in every one of those declarations is the signal: a set that always travels together is a shape, and each new declaration copies it from memory.",
                  "Is that set of fields ONE THING -- a primitive that deserves a name and should be composed everywhere it appears -- or do those declarations reuse the same field names for different reasons?",
                  "Answer `one_thing` when the fields always travel together as one concept, so one named type would replace all of them.",
                  "Answer `unrelated` only when the declarations genuinely use the fields for different purposes, so one type would be wrong however often they appear together.",
                  "Answer `already_named` when a declared type already names exactly this set.",
                ].join("\n"),
                criteria: {
                  one_thing: "The fields are one concept. Extract a named type and compose it everywhere.",
                  unrelated: "The declarations use the fields for genuinely different purposes. No one type would be right.",
                  already_named: "A declared type already covers exactly this field set.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { entry, first, id, plan }
        }),
      { concurrency: "unbounded" },
    )

    const present = planned.filter((value): value is NonNullable<typeof value> => value !== undefined)

    return {
      plans: present.map((value) => value.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        present.forEach((value, index) => {
          const { entry } = value
          const subject = "field group { " + entry.fields.join(", ") + " }"
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, value, undefined, "no judgement was available"))
            return
          }
          if (verdict.label !== "one_thing") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "already_named"
                  ? "a declared type already names this set"
                  : "the declarations reuse the field names for different reasons",
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
              ruleId: RULE_ID,
              subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          diagnostics.push(findingFor(report, value, verdict.confidence, undefined))
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "groups",
            judged: maxFindings,
            candidates: candidates.length,
            sample: candidates.slice(maxFindings).map((entry) => entry.fields.join(", ")),
          }),
          drops,
        )
      },
    }
  }),
}

const findingFor = (
  report: Report,
  value: {
    readonly entry: { readonly units: ReadonlyArray<Unit>; readonly fields: ReadonlyArray<string> }
    readonly first: Unit
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
): Diagnostic => {
  const { entry, first } = value
  return report({
    about: first,
    messageId: "fields_unnamed",
    data: {
      fields: entry.fields.join(", "),
      count: entry.units.length,
      file: first.file,
      line: first.location.line,
      name: first.name,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "fields_unnamed_help",
    identity: [RULE_ID, entry.fields.join("\u0000")].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
  })
}
