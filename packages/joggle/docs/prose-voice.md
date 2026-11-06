# Prose voice

Status: exploration. No rule is written yet.

The question: can joggle report a JSDoc block or a Markdown paragraph whose writing
costs a reader more than the fact it carries. This file records what the register
is, how much of it the repository contains, which parts a machine can decide, and
what a rule would have to know.

## 1. The specimen

`packages/joggle/src/reporting.ts:205`

    /** A printed type cut to the length a finding's help can carry. */

The function it documents, `shortType`, clamps a type string to
`policy.oneConceptOneType.maxTypeChars` and appends `"..."`. The doc block already
says that in the tag two lines down: "the value, or its prefix and an ellipsis when
it is too long."

So the prose does not add information. It restates the tag as an image, and it
withholds the one noun the reader needs: a length limit. "cut to the length a
finding's help can carry" describes the limit's *purpose* and never names the
limit. A reader who does not already know the code cannot reconstruct the
behaviour from the sentence. A reader who does know it learns nothing.

Four moves produce that sentence. They recur across the corpus:

1. **A noun phrase where a sentence belongs.** No subject, no finite verb. The
   participle ("cut") carries the whole definition, so the reader has to supply
   the sentence it belongs to.
2. **The mechanism replaced by its justification.** "cut to the length X can
   carry" states why the value is short. It does not state that the value is
   truncated, at what size, or with what marker.
3. **A metaphor where a parameter exists.** "carry" stands for a character
   budget. The budget is a number in `policy`.
4. **A claim about significance in place of the fact.** The same register closes
   paragraphs with verdicts: "That is the whole point." / "The notes are not
   decoration." / "That is the tool working."

That last move is the one that makes the register feel like a narrator talking
rather than a document telling: the writer grades the material instead of
reporting it.

## 2. What to call it

The useful name for the defect is **definition by riddle**: the sentence points at
a mechanism and refuses to state it. The associated tone is the **verdict
register**: a closing clause that asserts importance.

Both are forms of the same trade. A metaphor and a verdict are cheap to write and
expensive to read, because the reader has to convert them back into the fact
before they can use it. That conversion is the cost the rule would measure.

## 3. Census

`docs/reference/` holds a pasted book, so it is excluded from every count below.

| measure | count | command |
| --- | --- | --- |
| Markdown in the repo | 63 files, 17,458 lines | `rg --files -g '*.md' -g '!docs/reference'` |
| JSDoc blocks in `packages/joggle/src` | 971 in 85 files | `rg -c '^\\s*/\\*\\*'` |
| em dashes in `packages/joggle/src` | 8 | `rg -o -e '—' packages/joggle/src` |
| em dashes in Markdown | 984 | `rg -o -g '*.md' -e '—'` |
| "rather than" anywhere | 521 | |
| "X is not A. It is B." shape | 21 | |
| verdict closers ("whole point", "which is the point") | 15 | |
| "the model/report/tool says, knows, wants, refuses" | 27 | |
| "earns its place", "no accident", "not decoration" | 5 | |
| "the right instrument", "the honest X", "the one artefact" | 19 | |

Two findings matter for design.

- **The em dash lives in Markdown, not in JSDoc.** 984 against 8. JSDoc is
  written with `--`. A punctuation rule would only ever fire on docs.
- **The tells are dense but the killers are not greppable.** 521 "rather than"
  hits and 1,045 absolute words ("never", "always", "exactly") are mostly
  legitimate. The sentence in section 1 contains none of the greppable markers.
  The defect is compositional, so a lexical list cannot be the whole instrument.

## 4. The eight defects, made checkable

Each row needs a test a judge can answer yes or no to, and a repair the author can
act on. "Improve the prose" is not a test.

| defect | the test | mechanical signature | specimen | repair |
| --- | --- | --- | --- | --- |
| definition by riddle | Can a reader who does not know this code state what it does, from this sentence alone? | first line is a noun phrase with no finite verb | `reporting.ts:205` | state the mechanism: "A type string clamped to `maxTypeChars`, with `...` when truncated." |
| verdict register | Does this sentence add a fact, or grade the facts already given? | "the whole point", "not decoration", "earns its place", "That is the tool working" | `rule.ts:30`, `rule.ts:354` | delete it. Nothing in the block changes. |
| contrastive framing | Is the sentence built to correct a belief the reader has not been shown to hold? | "is not A. It is B.", "not X, but Y" | `atoms.ts:8` | state B. A says nothing unless the reader was already wrong. |
| overgeneralisation | Is the claim true of every case it covers, and can you name the counterexample? | "no list makes a heuristic correct", "a linter reads syntax" | `language-drift.ts:43` | narrow to the case at hand: "no stop-list separated 'whether' from 'BandId'." |
| anthropomorphising | Does the sentence make a program the subject of a mental verb? | the report says, the rule knows, the tool wants, the model refuses | `hoist-to-domain.ts:291` | name the artefact and the act: "the answer's label is X." |
| absence of doubt | Would the author hedge this if a colleague asked? | never, always, exactly, precisely, "the right instrument" | `doc-matches-code.ts:40` | say what was measured: "the answer was right in nine of ten cases." |
| synonym rotation | Do two words in this block name one thing? | not greppable | `doc-matches-code.ts` calls one object "the doc", "the artefact", "the prose", "the block", and its reader "the checker" and "a linter" | pick one word and repeat it. Repetition is not a defect. |
| massive blind spots | Does the claim survive the counterexample the author knows about? | structural, needs the paragraph | `doc-matches-code.ts`: "The type checker reads the type, not the prose, and a linter reads syntax" -- plumb's own type-aware rules read types, which the author ships | name the exception, or narrow the claim. |

Blind spots and synonym rotation are the two that no regex reaches, and they are
where the register does the most damage: a reader cannot see the missing step, and
does not notice that a word changed meaning halfway down the block.

## 5. Which instrument

Three candidates, and the choice is a boundary question the repository already has
an answer for: plumb decides single-file syntax, joggle decides meaning, and a
deterministic predicate belongs in neither joggle rule nor a prose rulebook.

| candidate | what it decides | fits | problem |
| --- | --- | --- | --- |
| a plumb (oxlint) rule | a closed list of tells: "the whole point", "is not A. It is B.", the anthropomorphic subject | single-file, deterministic, no model, cheap, can be `error` | oxlint sees TypeScript only. Markdown gets nothing, and 984 of the 1,043 em dashes are in Markdown. |
| a joggle judged rule | riddle, overgeneralisation, blind spots, synonym rotation | the categories a predicate provably cannot decide | cost: 971 JSDoc blocks plus 17k Markdown lines is far past any per-run budget, so the candidate filter and the severity both matter |
| a new Markdown engine under jig | any of the above, on Markdown | jig already has three engines | a fourth instrument to maintain, and it would duplicate the vocabulary joggle owns |

The split I would propose, and it is testable: **plumb owns the closed tells, joggle
owns the open categories.** `no-pattern-classifier` in `src/meta.ts` already
forbids a joggle rule from deciding with a regex, and its reason applies exactly:
if a regex decides it, the model should not be asked, because the answer is a
property of the spelling and not of the meaning. The reverse also holds, and it is
the argument against a tell-only rule: section 1's sentence has no tell in it.

A joggle rule therefore needs one more thing before it can be written: a
deterministic **candidate generator that is not a classifier**. The defensible
filters are structural. Sentences in a JSDoc prose paragraph (not a tag). Sentences
in a Markdown paragraph (not a list, not code). Exported declarations only. Blocks
over some token count. That is a fact about the file, and the verdict stays the
model's.

## 6. Markdown has no owner today

`looksLikeSource` admits `.ts`, `.js`, `.astro`. A Markdown file is walked,
counted in `skippedExtensions`, and dropped. `jig_engines` confirms the gap: cutlist,
plumb, joggle, and no Markdown engine.

A rule cannot fix this by reading the file itself. `PlannedRule.plan` returns
`Effect<Planned, AiError, Atoms | DecisionModel>`, and `Rule.run` has the same
environment. `FileSystem` is not in it, on purpose, so a rule cannot read what the
index did not index. Markdown has to arrive through `Workspace`.

Three ways, in order of cost:

1. **`Workspace.prose`**: discovery keeps Markdown paths, `loadWorkspace` stores
   `{ path, text, paragraphs }`. One new field, no new engine, and the existing
   `skippedExtensions` note stops under-reporting what the run ignored.
2. **A config-declared input list**: `joggle.config.json` gains `prose: ["docs/**"]`,
   and discovery resolves it separately. More knobs, and it makes prose
   opt-in, which means the tool is off by default.
3. **A fourth engine**: correct in principle, and it re-implements paragraph
   extraction and the report format.

Option 1 is the one that matches the repository's stance that a partial analysis
must not look complete.

## 7. Rule shape

A draft, not a decision.

- **Candidate**: one sentence. A file is far too coarse (a 6,600-word doc is one
  candidate) and a declaration is too coarse too (its block may hold six
  sentences, one of them bad).
- **Atom**: the sentence, the sentence before and after it, the declaration name
  or the Markdown heading, and the path. Bounded by construction.
- **Identity**: path, line, and a hash of the sentence, so a rewrite retires the
  finding and a moved file does not.
- **Two decisions per candidate**:
  - `riddle`: Noul. "Can a reader who has not read this file state what this
    declaration does, from this sentence alone?" The answer is falsifiable by
    trying it, which is what makes it a question rather than a taste.
  - `tell`: classify. `antithesis`, `verdict`, `anthropomorphism`,
    `synonym_rotation`, `overgeneralisation`, `false_certainty`,
    `restatement`, `no_issue`.
- **Severity**: `info` while calibration is unknown, `warn` for a tell with a
  named label, `error` only for the closed list plumb would own. The corpus has
  971 JSDoc blocks and 17,458 Markdown lines, so a first run at `warn` would
  bury every other rule's findings.
- **Scope**: `scope.changed` for the ratchet, full-corpus runs on demand.

The verdict label drives the message: "says what it is named for, not what it
does" is actionable. "has a bad tone" is not.

## 8. The calibration hazard

The judge writes this register. Every model asked to grade this prose is being
asked to grade its own defaults, and the likely failure is not a miss but
flattery: the riddle sentence reads as confident and compact, so a judge that
rewards "clarity" without defining it will pass it.

Three defences, and the first one is the only one that is not guesswork:

1. **Ground truth from the person who hates it.** Sixty sentences, labelled
   `bad`/`fine`, drawn from section 9's list. This is the fixture test and the
   calibration reference at once. A rule with no such reference is measuring its
   own opinion.
2. **Questions that are answerable rather than aesthetic.** "State the mechanism
   from the sentence" has a wrong answer. "Is this well written" does not.
3. **Committed answers.** Judged rules replay recorded verdicts in CI. The
   labels in the diff are the review.

## 9. The obvious corpus

The JSDoc this rule would report on is the repository's own, starting with the
files that carry the most of it:

- `packages/joggle/src/rule.ts` (the register is dense here: lines 16, 30, 79, 180,
  354, 437)
- `packages/joggle/src/reporting.ts:205`, `atoms.ts:8`, `structural-collapse.ts:46`
- `packages/joggle/src/rules/doc-matches-code.ts:40`
- Markdown: `FOREMAN.md`, `tools/foreman/journal.md`,
  `packages/joggle/docs/superpowers/plans/*`, `MIGRATION.md`

## 10. Open decisions

1. One rule or two: a JSDoc rule and a prose rule, or one rule with two candidate
   sources. They share a vocabulary and differ in what a reader needs.
2. Plumb for the closed list, joggle for the open categories, or joggle only.
3. Is Markdown in scope for the first cut, given it needs `Workspace.prose`?
4. `error` from the start on the closed list, or `warn` everywhere until the
   corpus is clean.
