import { Effect } from "effect"
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
import type { SourceFile, Workspace } from "../workspace.ts"

// meta-allow: no-pattern-classifier -- it reads RULE source for `id:` and `judged:` -- a structural scan of rule files,
// which is what the rule is for. docs/rule-coupling.md.
const RULE_ID = "joggle/rule-judgment"

/**
 * A rule that decides in code a question only a judgement can answer.
 *
 * This is the tool applied to itself. joggle's own rule is: code finds the
 * candidate, the model makes the judgement. A rule that computes a structural
 * signal and then asserts a semantic quality from it has moved the judgement back
 * into code, which is the disease this program exists to remove -- a person's
 * guess wearing a number.
 *
 * The candidate is structural: one `defineRule` call. One call is one rule, so a
 * file that defines four rules is four candidates rather than one, and the source
 * sent is that call's span rather than the whole file. The first version sent the
 * file, which meant a file with one bad rule among five got one verdict, and the
 * `judged` flag was a text scan of the whole file rather than of the rule.
 *
 * The judgement is the model's, because "is this a fact or an opinion?" is not
 * checkable by a linter either.
 *
 * `rule.judged` is part of the state on purpose. A rule that already asks the
 * model is not deciding in code, and the model should be told which it is looking
 * at rather than inferring it from an import.
 */
const ruleReview = (id: string) => ({
  decides_in_code: Decision.probability({
    instructions: [
      `Does the rule \`atoms[${id}].rule.id\` in \`atoms[${id}].rule.path\` decide in code a question that needs a judgement?`,
      "`atoms[" + id + "].rule.message` is the literal text the rule emits, and it is the finding. The rule's `description` and `help` are prose written for the report; a quality asserted there is not the finding. Judge the message and the computation behind it.",
      "A rule that states a measurement is NOT deciding in code: it says what it found and the reader decides. \"This file exports nine things over twenty lines\" is a fact, even when the description calls it shallow or the help suggests a fix.",
      "A rule DOES decide in code when either:",
      "- a NUMBER in it decides a verdict rather than bounding a search: a rule that reports a name as unsearchable because it is reached from fewer than N files, or a file as shallow because a ratio is below a threshold;",
      "- its MESSAGE asserts a quality rather than a measurement: \"these are one thing\", \"this is a grab bag\", \"this name is an address\", \"this is not worth keeping\".",
      "A number that only bounds how much work a run does -- a budget, a maximum, a token limit -- is not a judgement.",
      `\`atoms[${id}].rule.judged\` says whether the rule already asks the model. A rule that asks the model is not deciding in code, whatever its candidate filter looks like.`,
      `A rule whose \`atoms[${id}].rule.preset\` is true checks conformance to a pattern the repository DECLARES. That pattern is the contract, so checking it is a fact about the declaration rather than a judgement about the code.`,
    ].join("\n"),
    criteria: {
      false: "The rule states a fact, or it already asks the model.",
      true: "The rule decides a judgement in code.",
    },
  }),
  kind: Decision.classify({
    instructions: [
      `If \`atoms[${id}].rule.id\` decides in code, what kind of judgement is it?`,
      "Choose `no_issue` when the rule states a fact, or when it already asks the model.",
    ].join("\n"),
    criteria: {
      semantic_verdict: "It computes something structural and then asserts a semantic quality from it.",
      magic_threshold: "A number in the rule encodes a person's opinion rather than a bound on search.",
      name_meaning: "It matches names and then asserts what they mean.",
      no_issue: "It states a fact, or it already asks the model.",
    },
  }),
})

interface Candidate {
  readonly source: SourceFile
  readonly id: string
  readonly judged: boolean
  readonly preset: boolean
  readonly message: string
  readonly ruleSource: string
}

/**
 * Whether the rule file ships in a preset.
 *
 * A preset is a module that imports rules and re-exports them, so the edge from a
 * `presets/` file to this one is the declaration that the rule is opt-in.
 */
const isPreset = (workspace: Workspace, path: string): boolean =>
  workspace.imports.edges.some((edge) => edge.to === path && edge.importer.includes("/presets/"))

/**
 * The string literals in the rule's `message:` argument.
 *
 * A message is built by concatenation, so the literals are the fixed text and the
 * variables are the measurements. " is called from " and " files" carry no claim;
 * " so searching for it finds everything and nothing" does.
 */
const messageLiterals = (source: string): ReadonlyArray<string> => {
  const at = source.lastIndexOf("message:")
  if (at < 0) return []
  // Stop at `help:`, or the advice leaks in and the model reads the fix as the
  // finding -- which is exactly the mistake this field exists to prevent.
  const helpAt = source.indexOf("help:", at)
  const rest = source.slice(at, helpAt < 0 ? at + 2000 : helpAt)
  const literals: Array<string> = []
  // Single-line literals only, so the `+` and the variable names between them do
  // not become part of the text.
  for (const match of rest.matchAll(/"([^"\\\n]*)"/g)) {
    const literal = match[1]
    if (literal !== undefined && literal.trim() !== "") literals.push(literal)
  }
  return literals
}

/** One candidate per `defineRule` call: one call is one rule. */
const candidatesIn = (workspace: Workspace, scope: Scope): ReadonlyArray<Candidate> => {
  const found: Array<Candidate> = []
  for (const file of workspace.files) {
    if (scope.changed !== undefined && !scope.changed.has(file.path)) continue
    const sites = file.facts.callSites.filter((site) => site.name === "defineRule")
    if (sites.length === 0) continue
    const preset = isPreset(workspace, file.path)
    sites.forEach((site, index) => {
      // The call's span, so the source is the rule and not the file around it.
      // Sending LESS than this is worse, not better: the design comments above
      // each rule are what let the model tell a fact from a verdict, and cutting
      // to the `run` body alone lost them and raised the false-positive count.
      const source = file.text.slice(site.start, site.end)
      found.push({
        source: file,
        message: messageLiterals(source).join(" \u00b7 "),
        id:
          /id:\s*"([^"]+)"/.exec(source)?.[1] ??
          /RULE_ID = "([^"]+)"/.exec(file.text)?.[1] ??
          file.path + " (rule " + (index + 1) + ")",
        judged: /judged:\s*true/.test(source),
        preset,
        ruleSource: source.slice(0, policy.evidence.maxSourceChars * 8),
      })
    })
  }
  return found
}

export const ruleJudgment: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A rule that decides in code a question only a judgement can answer.",
  judged: true,
  onUnavailable: "propagate",
  messages: messages({
    code_decides:
      "{{id}} decides in code what only a judgement can decide: {{kind}}.",
    code_decides_help:
      "Code should find the candidate; the model should make the call. Keep the structural filter and ask a Decision for the verdict.{{review}}",
  }),
  plan: Effect.fn("joggle/rule-judgment")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(ruleJudgment, locator(workspace))
    const candidates = candidatesIn(workspace, scope)
    if (candidates.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no file calls defineRule, so there was no rule to audit"]),
      }
    }
    const budget = policy.ruleJudgment.maxRules
    const judged = candidates.slice(0, budget)
    const atoms = yield* Atoms
    const planned: Array<{ readonly candidate: Candidate; readonly plan: Plan<DecisionAnswers> }> = []
    for (const candidate of judged) {
      const id = yield* atoms.add({
        rule: {
          id: candidate.id,
          path: candidate.source.path,
          judged: candidate.judged,
          preset: candidate.preset,
          message: candidate.message,
          source: candidate.ruleSource,
        },
      })
      planned.push({
        candidate,
        plan: {
          ruleId: RULE_ID,
          subject: candidate.id,
          concerns: [candidate.source.path],
          atoms: [id],
          violations: { decides_in_code: [] },
          decisions: ruleReview(id),
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.id,
      stage: "budget" as const,
      reason: "past the budget of " + budget + " rules",
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
          subject: candidate.id,
          stage: "unreadable",
          reason: "the response did not audit this rule",
        })
        return
      }
      const decides = answer["decides_in_code"]
      const kind = answer["kind"]
      if (decides === undefined || !("probability" in decides) || kind === undefined || !("label" in kind)) {
        drops.push({
          ruleId: RULE_ID,
          subject: candidate.id,
          stage: "unreadable",
          reason: "the response did not contain a usable verdict",
        })
        return
      }
      if (declined(kind.label)) {
        drops.push({
          ruleId: RULE_ID,
          subject: candidate.id,
          stage: "declined",
          reason: "the rule states a fact or already asks the model",
        })
        return
      }
      const quality = qualityOf({
        score: decides.probability,
        margin: marginOfAnswer(kind),
        confidence: kind.confidence,
      })
      if (quality.quality === "drop") {
        drops.push({ ruleId: RULE_ID, subject: candidate.id, stage: "gated", reason: quality.reason })
        return
      }
      const review = quality.quality === "review"
      diagnostics.push(
        report({
                  about: candidate.source,
                  messageId: "code_decides",
                  data: {
                    id: candidate.id,
                    kind: kind.label.replace(/_/g, " "),
                    review: review ? " For review: " + quality.reason + "." : "",
                  },
                  helpId: "code_decides_help",
                  identity: [RULE_ID, candidate.id].join("\u0000"),
                  confidence: kind.confidence ?? 1,
                  score: decides.probability,
                  judged: true,
                  severity: review ? "info" : "warn",
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "rules",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((candidate) => candidate.id),
          }),
          drops,
        )
      },
    }
  })
}
