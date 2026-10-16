import { Effect, Order } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter, type Report } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
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
import { unitFields, type Unit, type Workspace } from "../workspace.ts"

const RULE_ID = "joggle/object-shape"

/** Which labels mean this rule is violated -- the read and the calibration share it. */
const VIOLATIONS = { verdict: ["one_concept"] } as const

// Object literals that share a shape and have no name.
//
// The entropy machine called this `object-duplicate`: "define a named type or
// interface, type-annotate all occurrences with it". It is the runtime-value half
// of what `compose-types` does for declarations.
//
// What is deterministic is the state. A repeated key set is a fact: object
// literals are collected per file, the key sets are sorted (because `{a, b}` and
// `{b, a}` are one shape), and a shape shared by two or more files is a
// candidate. Whether that shape is ONE CONCEPT that deserves a name, or two
// concepts that happen to share field names, is not a fact. That is the question,
// and it used to be answered by the key set alone.
/**
 * The rule's identity and its messages, in one place a reporter can be bound to
 * without the rule having to name itself.
 */
const SPEC = {
  id: RULE_ID,
  severity: "info",
  judged: true,
  move: "expand",
  messages: messages({
    repeated_fields:
      "{{count}} object literal(s) in {{files}} file(s) share this shape: { {{fields}} }.",
    repeated_fields_help:
      "Define a type with these fields and annotate every site with it. A shape nobody named is a shape nobody validates, and the sixth copy is written from memory: {{paths}}.{{unverified}}",
  }),
} as const

export const objectShape: PlannedRule = {
  ...SPEC,
  description: "Object literals that share a shape with no type of their own.",
  onUnavailable: "report",
  plan: Effect.fn("joggle/object-shape")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(SPEC, locator(workspace))
    const { minKeys, maxFindings, warnFromFiles } = policy.objectShape

    // A shape a declared type already names is not a shape nobody named. Every
    // interface and type alias contributes its field set, plus the fields of the
    // types it composes (`extends`, `A & B`, `type T = A`), resolved across files;
    // a `Schema.Struct` field object contributes its keys. Without this, composing
    // a type turned its own literals into findings.
    const byId = new Map<string, Unit>()
    for (const unit of workspace.units) {
      if (unit.kind !== "interface" && unit.kind !== "type") continue
      byId.set(unit.file + "#" + unit.name, unit)
    }
    const complete = new Map<string, ReadonlySet<string>>()
    const fieldsOfUnit = (unit: Unit, seen: ReadonlySet<string>): ReadonlySet<string> => {
      const id = unit.file + "#" + unit.name
      const cached = complete.get(id)
      if (cached !== undefined) return cached
      if (seen.has(id)) return new Set(unitFields(unit))
      const next = new Set(seen)
      next.add(id)
      const fields = new Set(unitFields(unit))
      for (const base of unit.composed) {
        const target = byId.get(base.resolvedTo)
        if (target === undefined) continue
        for (const field of fieldsOfUnit(target, next)) fields.add(field)
      }
      complete.set(id, fields)
      return fields
    }

    const declared: Array<ReadonlySet<string>> = []
    for (const unit of workspace.units) {
      if (unit.kind !== "interface" && unit.kind !== "type") continue
      const fields = fieldsOfUnit(unit, new Set())
      if (fields.size < minKeys) continue
      declared.push(fields)
    }
    for (const file of workspace.files) {
      for (const site of file.facts.objects) {
        if (!site.declared) continue
        declared.push(new Set(site.keys))
      }
    }
    const isDeclared = (keys: ReadonlySet<string>): boolean =>
      declared.some((type) => [...keys].every((key) => type.has(key)))

    const groups = new Map<string, Array<{ file: string; start: number }>>()
    for (const file of workspace.files) {
      // A shape nobody names is a real problem in application code and not one in
      // a test, where a fixture is supposed to be repeated.
      if (policy.testFiles.test(file.path)) continue
      for (const site of file.facts.objects) {
        const keys = [...new Set(site.keys)]
        if (keys.length < minKeys) continue
        if (isDeclared(new Set(keys))) continue
        const signature = [...keys].sort(Order.String).join("\u0000")
        const existing = groups.get(signature)
        if (existing === undefined) groups.set(signature, [{ file: file.path, start: site.start }])
        else existing.push({ file: file.path, start: site.start })
      }
    }

    const repeated = [...groups.entries()]
      .filter(([, sites]) => new Set(sites.map((site) => site.file)).size >= 2)
      .filter(([, sites]) => sites.some((site) => scope.changed === undefined || inScope(scope, site.file)))
      .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))

    if (repeated.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            "no object literal with " +
              minKeys +
              " or more keys appears in two or more files, so there was no shape to name",
          ]),
      }
    }

    const judged = repeated.slice(0, maxFindings)
    const overBudget: ReadonlyArray<Drop> = repeated.slice(maxFindings).map(([signature, sites]) => ({
      ruleId: RULE_ID,
      subject: sites.length + " literal(s) of { " + signature.split("\u0000").join("; ") + " }",
      stage: "budget" as const,
      reason: "past the budget of " + String(maxFindings) + " shapes",
    }))

    const textOf = new Map(workspace.files.map((file) => [file.path, file.text]))
    const atoms = yield* Atoms
    const planned = yield* Effect.forEach(
      judged,
      ([signature, sites]) =>
        Effect.gen(function* () {
          const keys = signature.split("\u0000")
          const files = [...new Set(sites.map((site) => site.file))]
          const first = sites[0]
          if (first === undefined) return undefined
          // The state is the shape and a bounded sample of its sites, not every
          // site's source: unrelated detail costs accuracy, and the shape is what
          // the question is about.
          const samples = sites.slice(0, 4).map((site) => {
            const text = textOf.get(site.file) ?? ""
            return { file: site.file, source: text.slice(site.start, site.start + 180) }
          })
          const id = yield* atoms.add({
            fields: keys,
            count: sites.length,
            files,
            samples,
          })
          const plan: Plan<DecisionAnswers> = {
            ruleId: RULE_ID,
            subject: "object shape { " + keys.join("; ") + " }",
            concerns: files,
            atoms: [id],
          violations: VIOLATIONS,
            decisions: {
              verdict: Decision.classify({
                instructions: [
                  `\`atoms[${id}].fields\` is a set of ${keys.length} field names. It appears as an object literal in ${sites.length} place(s) across ${files.length} file(s): ${files.slice(0, 6).join(", ")}. \`atoms[${id}].samples\` shows a few of them.`,
                  "Is that set of fields ONE CONCEPT that deserves a name -- a type every site should use -- or is the shared shape a coincidence?",
                  "Answer `one_concept` when the fields belong together as one thing and every site means the same thing by them.",
                  "Answer `coincidental` when the sites are different concepts that happen to share field names, so one type would be wrong.",
                  "A shape that is an external library's options object is `coincidental`: the fields are what a framework or a platform function expects, so the shape belongs to that library and this code is not missing a type.",
                  "Generic bookkeeping that unrelated modules carry for their own reasons (an id, a name, timestamps, a tenant) is `coincidental`, however many fields it has.",
                  "Answer `already_named` when some type in the codebase already names this exact shape.",
                ].join("\n"),
                criteria: {
                  one_concept: "The fields are one thing. A named type should replace the literal everywhere.",
                  coincidental: "Different concepts that share field names, a library\u0027s options object, or generic bookkeeping. One type would be wrong.",
                  already_named: "A declared type already covers this field set.",
                },
              }),
            },
            read: (answers) => answers,
          }
          return { keys, sites, first, id, plan }
        }),
      { concurrency: "unbounded" },
    )

    const present = planned.filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)

    return {
      plans: present.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overBudget]
        present.forEach((entry, index) => {
          const { keys } = entry
          const subject = "object shape { " + keys.join("; ") + " }"
          const answer = verdicts[index]
          const verdict = verdictOf(answer?.["verdict"], VIOLATIONS.verdict)
          if (verdict === undefined) {
            diagnostics.push(findingFor(report, entry, undefined, "no judgement was available", true))
            return
          }
          if (verdict.label !== "one_concept") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "declined",
              reason:
                verdict.label === "already_named"
                  ? "a declared type already covers this shape"
                  : "the sites are different concepts that share field names",
            })
            return
          }
          const quality = qualityOf({
            score: verdict.probability,
            margin: verdict.margin,
            confidence: verdict.confidence,
          })
          // A band is not a reason to discard an answer. A decisive
          // `one_concept` is a warning -- somebody should name this shape -- and
          // an answer the model shrugged across is a notice. Only a real no is
          // recorded and withheld.
          if (quality.quality === "drop") {
            drops.push({
              ruleId: RULE_ID,
              subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          // The spread decides the band, not the rule: a shape in two files is a
          // pair that may be coincidence, one in three or more is a pattern.
          const spread = new Set(entry.sites.map((site) => site.file)).size
          diagnostics.push(
            findingFor(
              report,
              entry,
              verdict.confidence,
              undefined,
              quality.quality === "review" || spread < warnFromFiles,
            ),
          )
        })
        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "shapes",
            judged: maxFindings,
            candidates: repeated.length,
            sample: repeated.slice(maxFindings).map(([signature]) => signature.split("\u0000").join("; ")),
          }),
          drops,
        )
      },
    }
  }),
}

/** The finding for one shape: verified, or the fact with the reason it is not. */
const findingFor = (
  report: Report,
  entry: {
    readonly keys: ReadonlyArray<string>
    readonly sites: ReadonlyArray<{ readonly file: string; readonly start: number }>
    readonly first: { readonly file: string; readonly start: number }
  },
  confidence: number | undefined,
  unverifiedReason: string | undefined,
  /**
   * The answer was not decisive, or there was no judgement at all. Either way the
   * finding is a notice: the rule's own severity would be a claim the evidence
   * does not support.
   */
  notice = true,
): Diagnostic => {
  const files = [...new Set(entry.sites.map((site) => site.file))]
  const paths =
    files.slice(0, policy.evidence.maxListedPaths).join(", ") +
    (files.length > policy.evidence.maxListedPaths
      ? " and " + (files.length - policy.evidence.maxListedPaths) + " more"
      : "")
  return report({
    about: { file: entry.first.file, start: entry.first.start },
    messageId: "repeated_fields",
    data: {
      count: entry.sites.length,
      files: files.length,
      fields: entry.keys.join("; "),
      paths,
      unverified: unverifiedReason === undefined ? "" : " Not verified: " + unverifiedReason + ".",
    },
    helpId: "repeated_fields_help",
    identity: [RULE_ID, entry.keys.join("\u0000")].join("\u0000"),
    judged: unverifiedReason === undefined,
    confidence,
    severity: notice ? "info" : "warn",
  })
}
