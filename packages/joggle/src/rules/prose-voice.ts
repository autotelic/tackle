import { Effect } from "effect"
import { Decision } from "effect/ai"
import { Atoms } from "../atoms.ts"
import { policy } from "../policy.ts"
import { verdictsOf, type Plan } from "../plans.ts"
import { hasWords, readsAsProse, sentencesOfDoc, type Sentence } from "../prose.ts"
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
import type { Diagnostic, Drop, SourceLocation } from "../schema.ts"
import { lineStarts, type SourceFile, type Unit, type Workspace } from "../workspace.ts"
import { lineAt } from "../cascade.ts"

// meta-allow: no-pattern-classifier -- the test asks whether a literal ends in a
// sentence terminator. It selects candidates by their punctuation and decides
// nothing about what they say; the verdict is the model's.
const RULE_ID = "joggle/prose-voice"

/**
 * The labels that mean this rule is violated.
 *
 * `no_issue` is not one of them. It is the answer for a sentence that states a
 * fact, and `verdictOf` reads it as a probability near zero.
 */
const VIOLATIONS = {
  tell: [
    "riddle",
    "verdict",
    "antithesis",
    "anthropomorphism",
    "synonym_rotation",
    "overgeneralisation",
    "false_certainty",
    "restatement",
  ],
} as const

/**
 * One sentence, with the neighbours a reader would have.
 *
 * The candidate is a sentence. A doc block can hold the defect in one of six
 * sentences, and a document holds thousands.
 */
interface Candidate {
  readonly source: "jsdoc" | "markdown" | "string"
  /** The call the literal is written in, when it is an argument to one. */
  readonly surface: string
  readonly file: string
  readonly location: SourceLocation
  readonly subject: string
  readonly sentence: string
  readonly before: string
  readonly after: string
  readonly name: string | undefined
}

/**
 * The question, with a definition per label.
 *
 * Each definition is a test the judge applies to the sentence. A single question
 * ("is this well written") would be scored against the judge's own writing
 * habits, which are the habits this rule reports.
 */
const voiceReview = (id: string, hasNeighbour: boolean) => {
  const base = {
    riddle: "The mechanism is replaced by its purpose or a metaphor.",
    verdict: "Deleting it loses no fact: it asserts the material matters.",
    antithesis: "The sentence corrects a belief the reader was never shown to have.",
    anthropomorphism: "A program is the subject of a mental verb.",
    synonym_rotation: "Two words in the sentence name one thing.",
    overgeneralisation: "The claim is wider than the case, and a counterexample exists.",
    false_certainty: "A claim asserted without doubt that nobody measured.",
    no_issue: "The sentence states a fact or a constraint a reader can use.",
  }
  const withRestatement = {
    ...base,
    restatement: "It states a fact the previous sentence already states.",
  }
  const instructions = [
      "Pick the defect that makes `atoms[" + id + "].sentence` cost a reader more than it gives, or choose `no_issue`.",
      "The sentence was written by an agent for a reader who does not know the code.",
      "Judge `atoms[" + id + "].sentence` only. `before` and `after` are the sentences around it, for context: a defect in them is not a defect in this one, and a quoted example is not authored prose.",
      "`atoms[" + id + "].source` says where it is read: `jsdoc` is a comment above a declaration, `markdown` is a document, `string` is program output, a test name or a prompt.",
      "`atoms[" + id + "].surface` is the call the string is written in, when the parser recorded one. A flag description or a command description is a label read in a terminal: report it only when it hides the mechanism.",
      "- `riddle`: the mechanism is replaced by its purpose or by a metaphor, so a reader cannot say what the code does. For a string clamp: \"A printed type cut to the length a finding's help can carry\". A sentence that names the operation and its object is not a riddle, even when it uses the project's own vocabulary: \"Run everything and print the census.\"",
      "- `verdict`: delete the sentence and the reader loses no fact. It asserts that the material matters, is obvious or is correct: \"That is the whole point.\" \"The notes are not decoration.\" \"is this abstraction earning its keep.\" A sentence that states a bound, a default, a measurement or a consequence is not a verdict, even when it judges something.",
      "- `antithesis`: the sentence corrects a belief the reader was never shown to hold. \"This is not a cache. It is a memo.\"",
      "- `anthropomorphism`: a program is the subject of a mental verb. \"the rule knows\", \"the report wants\", \"the model refuses\".",
      "- `synonym_rotation`: two words in the sentence name one thing because the writer avoided repeating a word. \"the artefact ... the doc ... the block\".",
      "- `overgeneralisation`: the claim is wider than the case it describes, and a counterexample exists in this repository. \"a linter reads syntax\".",
      "- `false_certainty`: a claim asserted without doubt that nobody measured. \"no list makes a heuristic correct\".",
      ...(hasNeighbour
        ? [
            "- `restatement`: the sentence states a fact the previous sentence already states, in other words. A description that adds a rule, a default or a resolution the name does not carry is not a restatement.",
          ]
        : ["There is no preceding sentence in this block, so `restatement` is not offered."]),
      "- `no_issue`: the sentence states a fact, a constraint, a parameter or a consequence. Choose this for a label, a criterion or a tagline that names what it classifies, and for a short sentence that is informal but honest. Choose it rather than a label you cannot point at words for.",
  ].join("\n")
  return hasNeighbour
    ? Decision.classify({ instructions, criteria: withRestatement })
    : Decision.classify({ instructions, criteria: base })
}

/** Whether a sentence is long enough to judge and short enough to bound. */
const usable = (sentence: Sentence): boolean =>
  sentence.text.length >= policy.proseVoice.minChars &&
  sentence.text.length <= policy.proseVoice.maxChars &&
  !sentence.text.endsWith(":") &&
  hasWords(sentence.text)

/** The neighbours of one sentence, when they are in the same block. */
const neighboursOf = (sentences: ReadonlyArray<Sentence>, index: number) => {
  const current = sentences[index]
  if (current === undefined) return { before: "", after: "" }
  const same = (other: Sentence | undefined): other is Sentence =>
    other !== undefined && other.paragraph === current.paragraph
  const previous = sentences[index - 1]
  const next = sentences[index + 1]
  return {
    before: same(previous) ? previous.text : "",
    after: same(next) ? next.text : "",
  }
}

const docCandidates = (units: ReadonlyArray<Unit>): ReadonlyArray<Candidate> => {
  const candidates: Array<Candidate> = []
  for (const unit of units) {
    if (unit.doc === undefined) continue
    const sentences = sentencesOfDoc(unit.doc)
    sentences.forEach((sentence, index) => {
      if (!usable(sentence)) return
      const { before, after } = neighboursOf(sentences, index)
      candidates.push({
        source: "jsdoc",
        surface: "",
        file: unit.file,
        location: unit.location,
        subject: unit.name + " (" + unit.file + ")",
        sentence: sentence.text,
        before,
        after,
        name: unit.name,
      })
    })
  }
  return candidates
}

const proseCandidates = (workspace: Workspace): ReadonlyArray<Candidate> => {
  const candidates: Array<Candidate> = []
  for (const file of workspace.prose) {
    file.sentences.forEach((sentence, index) => {
      if (!usable(sentence)) return
      const { before, after } = neighboursOf(file.sentences, index)
      candidates.push({
        source: "markdown",
        surface: "",
        file: file.path,
        location: { file: file.path, line: sentence.line, column: 1 },
        subject: file.path + ":" + String(sentence.line),
        sentence: sentence.text,
        before,
        after,
        name: undefined,
      })
    })
  }
  return candidates
}

const lineOf = (text: string, offset: number): number => lineAt(lineStarts(text), offset)

/**
 * The innermost call a literal is an argument to.
 *
 * The parser recorded which call each literal is an argument to, so this is a
 * lookup rather than a reading of the string. `Flag.withDescription` marks a
 * one-line label; `messages` marks a finding's text.
 *
 * @param file - the file the literal is in.
 * @param offset - where the literal starts.
 * @returns the dotted callee name, or an empty string when the literal is not an argument.
 */
const surfaceOf = (
  file: SourceFile,
  offset: number,
): { readonly name: string; readonly start: number } => {
  let best: { readonly name: string; readonly start: number; readonly span: number } | undefined
  for (const site of file.facts.callSites) {
    if (offset < site.start || offset > site.end) continue
    const span = site.end - site.start
    if (best === undefined || span < best.span) {
      best = { name: site.name, start: site.start, span }
    }
  }
  return best === undefined ? { name: "", start: offset } : { name: best.name, start: best.start }
}

const stringCandidates = (files: ReadonlyArray<SourceFile>): ReadonlyArray<Candidate> => {
  const candidates: Array<Candidate> = []
  for (const file of files) {
    for (const literal of file.facts.literals) {
      if (!readsAsProse(literal.value)) continue
      const surface = surfaceOf(file, literal.start)
      // A criteria label is one of a question's options, not prose a person
      // reads. The instructions and the message beside it are still judged.
      if (file.text.slice(surface.start, literal.start).lastIndexOf("criteria:") !== -1) continue
      const line = lineOf(file.text, literal.start)
      candidates.push({
        source: "string",
        surface: surface.name,
        file: file.path,
        location: { file: file.path, line, column: 1 },
        subject: file.path + ":" + String(line),
        sentence: literal.value,
        before: "",
        after: "",
        name: undefined,
      })
    }
  }
  return candidates
}

/** A stable order, so two runs judge the same sentences. */
const ordered = (candidates: ReadonlyArray<Candidate>): ReadonlyArray<Candidate> =>
  [...candidates].sort(
    (left, right) =>
      left.file.localeCompare(right.file) ||
      left.location.line - right.location.line ||
      left.sentence.localeCompare(right.sentence),
  )

export const proseVoice: PlannedRule = {
  id: RULE_ID,
  severity: "warn",
  description: "A comment, message or document whose wording obscures what it describes.",
  judged: true,
  onUnavailable: "propagate",
  messages: messages({
    tell: '{{where}} reads as {{kind}}: "{{sentence}}"',
    tell_help: "{{repair}}",
    help_riddle:
      "State the behaviour: the operation, what it takes, and the bound it applies. For a clamp: \"returns the type, cut to 40 characters with an ellipsis\".",
    help_verdict: "Delete the sentence. No fact in the block changes.",
    help_antithesis:
      "Delete the clause about what it is not, unless the code would otherwise be misread.",
    help_anthropomorphism:
      "Write the value and where it comes from: \"the answer's label is X\", not \"the model knows X\".",
    help_synonym_rotation: "Use one word for the thing in every sentence of the block.",
    help_overgeneralisation: "Limit the claim to the case, or name the exception.",
    help_false_certainty: "State what was measured, or delete the claim.",
    help_restatement: "Delete the sentence, or replace it with the fact it repeats.",
  }),
  plan: Effect.fn("joggle/prose-voice")(function* (workspace: Workspace, scope: Scope) {
    const report = reporter(proseVoice, locator(workspace))
    const inScope = (file: string): boolean =>
      scope.changed === undefined || scope.changed.has(file)
    const groups = [
      {
        unitKind: "documented sentences",
        budget: policy.proseVoice.maxDocSentences,
        candidates: ordered(docCandidates(workspace.units.filter((unit) => inScope(unit.file)))),
      },
      {
        unitKind: "Markdown sentences",
        budget: policy.proseVoice.maxProseSentences,
        candidates: ordered(
          proseCandidates(workspace).filter((candidate) => inScope(candidate.file)),
        ),
      },
      {
        unitKind: "string literals",
        budget: policy.proseVoice.maxStringSentences,
        candidates: ordered(
          stringCandidates(workspace.files).filter((candidate) => inScope(candidate.file)),
        ),
      },
    ]
    const judged = groups.flatMap((group) => group.candidates.slice(0, group.budget))
    if (judged.length === 0) {
      return {
        plans: [],
        read: () => outcome([], ["no sentence long enough to judge was in scope"]),
      }
    }

    const atoms = yield* Atoms
    const planned: Array<{ readonly candidate: Candidate; readonly plan: Plan<DecisionAnswers> }> = []
    for (const candidate of judged) {
      const id = yield* atoms.add({
        source: candidate.source,
        surface: candidate.surface.slice(0, 80),
        file: candidate.file,
        sentence: candidate.sentence.slice(0, policy.proseVoice.maxChars),
        before: candidate.before.slice(0, policy.evidence.maxDocChars),
        after: candidate.after.slice(0, policy.evidence.maxDocChars),
        name: candidate.name ?? "",
      })
      planned.push({
        candidate,
        plan: {
          ruleId: RULE_ID,
          subject: candidate.subject,
          concerns: [candidate.file],
          atoms: [id],
          violations: VIOLATIONS,
          decisions: { tell: voiceReview(id, candidate.before !== "") },
          read: (answers) => answers,
        },
      })
    }

    const overflow: ReadonlyArray<Drop> = groups.flatMap((group) =>
      group.candidates.slice(group.budget).map((candidate) => ({
        ruleId: RULE_ID,
        subject: candidate.subject,
        stage: "budget" as const,
        reason: "past the budget of " + String(group.budget) + " " + group.unitKind,
      })),
    )

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
              subject: candidate.subject,
              stage: "unreadable",
              reason: "the response did not judge this sentence",
            })
            return
          }
          const verdict = verdictOf(answer["tell"], VIOLATIONS.tell)
          if (verdict === undefined) {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.subject,
              stage: "unreadable",
              reason: "the response did not contain a usable verdict",
            })
            return
          }
          if (verdict.label === "no_issue" || declined(verdict.label)) {
            drops.push({
              ruleId: RULE_ID,
              subject: candidate.subject,
              stage: "declined",
              reason: "the sentence states a fact",
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
              subject: candidate.subject,
              stage: "gated",
              reason: quality.reason,
            })
            return
          }
          diagnostics.push(
            report({
              about: candidate.location,
              messageId: "tell",
              data: {
                where: candidate.subject,
                kind: (verdict.label ?? "unreadable").replace(/_/g, " "),
                sentence: candidate.sentence,
              },
              helpId: "help_" + String(verdict.label),
              identity: [RULE_ID, candidate.file, String(candidate.location.line), candidate.sentence].join("\u0000"),
              confidence: verdict.confidence ?? 1,
              score: verdict.probability,
              judged: true,
              severity: quality.quality === "review" ? "info" : "warn",
            }),
          )
        })

        return outcome(
          diagnostics,
          groups.flatMap((group) =>
            budgetNote({
              unitKind: group.unitKind,
              judged: Math.min(group.candidates.length, group.budget),
              candidates: group.candidates.length,
              sample: group.candidates
                .slice(group.budget, group.budget + 5)
                .map((candidate) => candidate.subject),
            }),
          ),
          drops,
        )
      },
    }
  }),
}
