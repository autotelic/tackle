import { Effect, Order } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import {
  budgetNote,
  declined,
  marginOfAnswer,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { Workspace } from "../workspace.ts"

const RULE_ID = "joggle/name-as-address"

// A name too common to be an address.
//
// The reference material this rule comes from opens with the measurement that
// motivates it: an agent finds code by searching for a name, so `grep create`
// returning 1,585 hits is not a style problem, it is a retrieval problem.
//
// The CANDIDATE is structural and free: an exported single-word name, called from
// at least `minFiles` files, where the call RESOLVES to this declaration. The
// resolution matters -- thirty call sites named `parse` reaching three different
// functions are not sixty hits on any one of them -- and the single word matters,
// because `fetchPayrollProjections` used in thirty files is a good address used
// often.
//
// The JUDGEMENT is whether THIS word at THAT count fails as an address. The count
// is a fact; the verdict is not. `range` reached from thirty files is a bad
// address, while a one-word domain term reached from the same number may be the
// right one. The first version answered with the threshold and asserted the
// verdict in the message -- "searching for it finds everything and nothing" --
// which moved a judgement into code. The model answers now, and code reports what
// it picked.
//
/**
 * True when a name is one lowercase word: no camel case, no separators, no digits.
 *
 * The SHAPE of a name, not its meaning, so `no-pattern-classifier` does not
 * apply -- and written as the property it is rather than a pattern.
 */
const isSingleWord = (name: string): boolean =>
  name.length > 0 && name.split("").every((character) => character >= "a" && character <= "z")

/** The two questions about one name, pointing at its atom by id. */
const nameReview = (id: string) => ({
  fails_as_address: Decision.probability({
    instructions: [
      `Is \`atoms[${id}].name.identifier\`, declared at \`atoms[${id}].name.declared\`, a bad retrieval address?`,
      `It is a single-word export, and \`atoms[${id}].name.files\` files call it. \`atoms[${id}].name.callers\` is a sample of them.`,
      "An agent finds code by searching for a name, so a name that matches everything finds nothing.",
      "Answer true when the word is generic enough that a search cannot narrow to this declaration: `range`, `create`, `handle`, `parse`, `data`.",
      "Answer false when the single word is a term specific to this codebase, or when the declaration is easy to reach from the callers anyway.",
    ].join("\n"),
    criteria: {
      false: "The name still finds this declaration.",
      true: "The name finds everything and nothing.",
    },
  }),
  address: Decision.classify({
    instructions: `If \`atoms[${id}].name.identifier\` is a bad address, what kind of word is it? Choose \`no_issue\` when the name still finds the declaration.`,
    criteria: {
      generic_verb: "A generic verb: create, get, handle, parse, build.",
      generic_noun: "A generic noun: data, config, value, state, item.",
      overloaded_domain: "A domain word used for more than one thing.",
      no_issue: "The name still finds the declaration.",
    },
  }),
})

export const nameAsAddress: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A generic single-word export called from too many files to be searchable.",
  judged: true,
  move: "expand",
  onUnavailable: "propagate",
  messages: messages({
    common_name:
      "`{{name}}` is called from {{count}} files, and it is a {{kind}} rather than an address.",
    common_name_help:
      "A name is how this declaration is found: it is the address, not a summary. Rename it to say what it is for -- `{{name}}` gives a reader and an agent nothing to narrow by, while a name of two or three specific words makes every future search cheaper.{{review}}",
  }),
  plan: Effect.fn("joggle/name-as-address")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(nameAsAddress, locator(workspace))
    const { minFiles, maxFiles, maxCallers } = policy.nameAsAddress
    const exported = workspace.units.filter((unit) => unit.exported)

    // Which files call each declaration, by resolved identity.
    const calledFrom = new Map<string, Set<string>>()
    for (const unit of workspace.units) {
      for (const callee of unit.calls) {
        const files = calledFrom.get(callee) ?? new Set<string>()
        files.add(unit.file)
        calledFrom.set(callee, files)
      }
    }

    const candidates = exported
      .filter((unit) => isSingleWord(unit.name))
      .filter((unit) => scope.changed === undefined || scope.changed.has(unit.file))
      .map((unit) => ({
        unit,
        callers: [...(calledFrom.get(unit.file + "#" + unit.name) ?? new Set<string>())].sort(Order.String),
      }))
      .filter((entry) => entry.callers.length >= minFiles)
      .sort((left, right) => right.callers.length - left.callers.length)

    if (candidates.length === 0) {
      return {
        plans: [],
        read: () =>
          outcome([], [
            exported.length +
              " exported declaration(s), none of them a single-word name called from " +
              minFiles +
              " or more files",
          ]),
      }
    }

    const judged = candidates.slice(0, maxFiles)
    const atoms = yield* Atoms
    const planned: Array<{
      readonly candidate: (typeof judged)[number]
      readonly plan: Plan<DecisionAnswers>
    }> = []
    for (const candidate of judged) {
      const id = yield* atoms.add({
        name: {
          identifier: candidate.unit.name,
          declared: candidate.unit.file,
          files: candidate.callers.length,
          callers: candidate.callers.slice(0, maxCallers),
        },
      })
      planned.push({
        candidate,
        plan: {
          ruleId: RULE_ID,
          subject: candidate.unit.file + "#" + candidate.unit.name,
          concerns: [candidate.unit.file],
          atoms: [id],
          violations: { fails_as_address: [] },
          decisions: nameReview(id),
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = candidates.slice(maxFiles).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.unit.file + "#" + candidate.unit.name,
      stage: "budget" as const,
      reason: "past the budget of " + maxFiles + " common names",
    }))

    return {
      plans: planned.map((entry) => entry.plan),
      read: (answers) => {
        const verdicts = verdictsOf<DecisionAnswers>(answers)
        const diagnostics: Array<Diagnostic> = []
        const drops: Array<Drop> = [...overflow]
        planned.forEach((entry, index) => {
          const candidate = entry.candidate
          const answer = verdicts[index]
          if (answer === undefined) {
        drops.push({
          ruleId: RULE_ID,
          subject: candidate.unit.file + "#" + candidate.unit.name,
          stage: "unreadable",
          reason: "the response did not judge this name",
        })
        return
      }
      const fails = answer["fails_as_address"]
      const address = answer["address"]
      if (fails === undefined || !("probability" in fails) || address === undefined || !("label" in address)) {
        drops.push({
          ruleId: RULE_ID,
          subject: candidate.unit.file + "#" + candidate.unit.name,
          stage: "unreadable",
          reason: "the response did not contain a usable verdict",
        })
        return
      }
      if (declined(address.label)) {
        drops.push({
          ruleId: RULE_ID,
          subject: candidate.unit.file + "#" + candidate.unit.name,
          stage: "declined",
          reason: "the name still finds this declaration",
        })
        return
      }
      const quality = qualityOf({
        score: fails.probability,
        margin: marginOfAnswer(address),
        confidence: address.confidence,
      })
      if (quality.quality === "drop") {
        drops.push({
          ruleId: RULE_ID,
          subject: candidate.unit.file + "#" + candidate.unit.name,
          stage: "gated",
          reason: quality.reason,
        })
        return
      }
      const review = quality.quality === "review"
      diagnostics.push(
        report({
                  about: candidate.unit,
                  messageId: "common_name",
                  data: {
                    name: candidate.unit.name,
                    count: candidate.callers.length,
                    kind: (address.label ?? "").replace(/_/g, " "),
                    review: review ? " For review: " + quality.reason + "." : "",
                  },
                  helpId: "common_name_help",
                  identity: [RULE_ID, candidate.unit.file, candidate.unit.name].join("\u0000"),
                  confidence: address.confidence ?? 1,
                  score: fails.probability,
                  judged: true,
                  severity: review ? "info" : "warn",
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "common names",
            judged: maxFiles,
            candidates: candidates.length,
            sample: candidates.slice(maxFiles).map((c) => c.unit.name),
          }),
          drops,
        )
      },
    }
  })
}

