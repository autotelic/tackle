import { Effect } from "effect"
import { Decision } from "effect/unstable/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { locator, messages, reporter } from "../reporting.ts"
import { verdictOf } from "../verdict.ts"
import {
  budgetNote,
  declined,
  outcome,
  qualityOf,
  type DecisionAnswers,
  type PlannedRule,
  type Scope,
} from "../rule.ts"
import type { Diagnostic, Drop } from "../schema.ts"
import type { SourceFile, Workspace } from "../workspace.ts"

// meta-allow: no-pattern-classifier -- `termsOf` tokenises prose -- a capitalised word, a sentence end -- which is
// unavoidable text parsing of a doc block, not a classification of the code. docs/rule-coupling.md.
const RULE_ID = "joggle/language-drift"

/**
 * A domain word the prose uses and the code does not.
 *
 * The CANDIDATE is structural: a capitalized word the doc blocks repeat and no
 * declaration, path or import uses. That is a fact, and a cheap one.
 *
 * The JUDGEMENT is whether the word names a domain concept the code calls
 * something else. A stopword list cannot answer it -- the first version reported
 * "whether", "what" and "every", and no list makes a heuristic correct. So the
 * model picks the concept, or says none, and code reports what it picked.
 *
 * The words are the Choice's options, one per candidate, so the answer names
 * which one is a concept rather than only that one exists.
 */

const wordsOf = (name: string): ReadonlyArray<string> =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 0)

/** The capitalized words that are not at the start of a sentence. */
const termsOf = (doc: string): ReadonlyArray<string> => {
  const words = doc.split(/\s+/)
  const terms: Array<string> = []
  for (let index = 0; index < words.length; index += 1) {
    const raw = words[index] ?? ""
    const clean = /^[^A-Za-z0-9]*([A-Z][A-Za-z0-9]{3,})/.exec(raw)?.[1]
    if (clean === undefined) continue
    const previous = words[index - 1] ?? ""
    if (index === 0 || previous === "" || /[.:;!?]$/.test(previous)) continue
    // Split a camel-cased word the same way a declaration name is split, so
    // prose that writes `SortedByDate` is compared as `sorted`/`by`/`date` and
    // not as one lowercase blob that no name can ever contain.
    // No stop-list: whether a word is a domain concept is the QUESTION, and a
    // hand-maintained list of tech words was deciding it (docs/rule-coupling.md).
    for (const part of wordsOf(clean)) terms.push(part)
  }
  return terms
}

interface Candidate {
  readonly source: SourceFile
  readonly words: ReadonlyArray<string>
  readonly docs: ReadonlyArray<string>
}

/** The one question about a file, pointing at its atom by id. */
const languageReview = (id: string, words: ReadonlyArray<string>) => {
  const criteria: Record<string, string> = {
    none: "None of these is a concept the code names differently.",
  }
  for (const word of words) criteria[word] = "The prose says \"" + word + "\" and no name uses it."
  return {
    concept: Decision.classify({
      instructions: [
        `The doc blocks of \`atoms[${id}].file.path\` repeat the words in \`atoms[${id}].file.words\`, and no declaration, path or import uses any of them.`,
        "Which one, if any, names a concept this code calls something else?",
        "Choose a word when the prose is naming a thing -- an entity, a process, a rule -- and the code names that thing differently.",
        "Choose `none` when the words are ordinary English, the technology stack, or something the code does not model at all.",
      ].join("\n"),
      criteria,
    }),
  }
}

const candidatesIn = (workspace: Workspace, scope: Scope): ReadonlyArray<Candidate> => {
  const identifiers = new Set<string>()
  for (const unit of workspace.units) {
    for (const word of wordsOf(unit.name)) identifiers.add(word)
    for (const segment of unit.file.split("/")) for (const word of wordsOf(segment)) identifiers.add(word)
  }
  for (const file of workspace.files) {
    for (const imported of file.importStatements) {
      for (const name of imported.names) for (const word of wordsOf(name)) identifiers.add(word)
    }
  }

  const found: Array<Candidate> = []
  for (const file of workspace.files) {
    if (scope.changed !== undefined && !scope.changed.has(file.path)) continue
    const counts = new Map<string, number>()
    const docs: Array<string> = []
    for (const unit of file.units) {
      if (unit.doc === undefined) continue
      docs.push(unit.doc.slice(0, policy.evidence.maxDocChars))
      for (const term of termsOf(unit.doc)) {
        if (identifiers.has(term)) continue
        counts.set(term, (counts.get(term) ?? 0) + 1)
      }
    }
    const words = [...counts.entries()]
      .filter(([, count]) => count >= policy.languageDrift.minMentions)
      .map(([word]) => word)
      .sort((left, right) => left.localeCompare(right))
    if (words.length > 0) found.push({ source: file, words, docs })
  }
  return found
}

export const languageDrift: PlannedRule = {
  id: RULE_ID,
  severity: "info",
  description: "A domain word the prose uses and the code never names.",
  judged: true,
  move: "expand",
  onUnavailable: "propagate",
  messages: messages({
    prose_word_not_named:
      'The prose says "{{word}}", and no declaration, path or import uses the word.',
    prose_word_not_named_help:
      "Either the code is named for something else, or the prose describes a concept the code has not named. The first is drift; the second is a missing name.",
  }),
  plan: Effect.fn("joggle/language-drift")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(languageDrift, locator(workspace))
    const candidates = candidatesIn(workspace, scope)
    if (candidates.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["every domain word in the prose is also a word in a name"]),
      }
    }
    const budget = policy.languageDrift.maxFiles
    const judged = candidates.slice(0, budget)
    const atoms = yield* Atoms
    const planned: Array<{ readonly candidate: Candidate; readonly plan: Plan<DecisionAnswers> }> = []
    for (const candidate of judged) {
      const id = yield* atoms.add({
        file: {
          path: candidate.source.path,
          words: candidate.words,
          docs: candidate.docs.join("\n\n"),
        },
      })
      planned.push({
        candidate,
        plan: {
          ruleId: RULE_ID,
          subject: candidate.source.path,
          concerns: [candidate.source.path],
          atoms: [id],
          violations: { concept: candidate.words },
          decisions: languageReview(id, candidate.words),
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = candidates.slice(budget).map((candidate) => ({
      ruleId: RULE_ID,
      subject: candidate.source.path,
      stage: "budget" as const,
      reason: "past the budget of " + budget + " files with prose words",
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
        drops.push({ ruleId: RULE_ID, subject: candidate.source.path, stage: "unreadable", reason: "the response did not judge this file" })
        return
      }
      const concept = answer["concept"]
      const verdict = verdictOf(concept, candidate.words)
      if (verdict === undefined) {
        drops.push({ ruleId: RULE_ID, subject: candidate.source.path, stage: "unreadable", reason: "the response did not contain a verdict" })
        return
      }
      if (verdict.label === "none" || declined(verdict.label)) {
        drops.push({ ruleId: RULE_ID, subject: candidate.source.path, stage: "declined", reason: "none of the words names a concept" })
        return
      }
      const quality = qualityOf({
        score: verdict.probability,
        margin: verdict.margin,
        confidence: verdict.confidence,
      })
      // This rule asks a model to guess whether an English word in a comment is
      // a domain concept, and it is the noisiest one it has. A confident answer
      // is a finding; an unsure one is the model saying it cannot tell, and a
      // file-level notice at confidence 0.56 is noise. So only `act` is
      // reported -- unlike the duplicate rules, where an unsure answer still
      // points at two declarations a reader can compare.
      if (quality.quality === "drop") {
        drops.push({ ruleId: RULE_ID, subject: candidate.source.path, stage: "gated", reason: quality.reason })
        return
      }
      const review = quality.quality === "review"
      diagnostics.push(
        report({
                  about: candidate.source,
                  messageId: "prose_word_not_named",
                  data: { word: verdict.label ?? "" },
                  helpId: "prose_word_not_named_help",
                  identity: [RULE_ID, verdict.label].join("\u0000"),
                  confidence: verdict.confidence ?? 1,
                  score: verdict.probability,
                  judged: true,
                  severity: review ? "info" : "warn",
                }),
      )
        })

        return outcome(
          diagnostics,
          budgetNote({
            unitKind: "files with prose words",
            judged: budget,
            candidates: candidates.length,
            sample: candidates.slice(budget).map((candidate) => candidate.source.path),
          }),
          drops,
        )
      },
    }
  })
}

