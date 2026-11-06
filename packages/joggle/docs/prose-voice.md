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

The prose carries no information the tag does not. It restates the tag as an image,
and the one noun a reader needs is missing: a length limit. "cut to the length a
finding's help can carry" describes the limit's *purpose* and never names the
limit. A reader who does not already know the code cannot reconstruct the
behaviour from the sentence. A reader who does know it learns nothing.

Four moves produce that sentence. They recur across the corpus:

1. **A noun phrase where a sentence belongs.** There is no subject and no finite
   verb. The participle ("cut") carries the definition, so the reader supplies the
   sentence it belongs to.
2. **The mechanism is replaced by its justification.** "cut to the length X can
   carry" states why the value is short. It leaves out that the value is truncated,
   at what size, and with what marker.
3. **A metaphor stands where a parameter exists.** "carry" means a character
   budget, and the budget is a number in `policy`.
4. **A claim about significance replaces the fact.** The same register closes
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
over some token count. The filter is a fact about the file. The verdict is the
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
3. **A fourth engine**: correct in principle, and it has to re-implement paragraph
   extraction and the report format.

Option 1 keeps a partial analysis from looking complete, which is the repository's
stated stance.

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
   `bad`/`fine`, drawn from section 9's list. The same sixty sentences serve as the
   fixture and as the calibration reference. Without them the rule measures its
   author's opinion.
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

## 10. What was built

One judged rule, `joggle/prose-voice`, with three candidate sources and one
question. It is in `src/rules/prose-voice.ts`, and the deterministic half is what
this section can state exactly.

**Candidates**, all sentences:

| source | where it comes from | why it is a candidate |
| --- | --- | --- |
| `jsdoc` | `unit.doc`, from the comment above a declaration, exported or not | a maintainer reads it while editing the file |
| `markdown` | `Workspace.prose`, from discovery, or handed over by a caller | a document read on its own |
| `string` | `file.facts.literals`, filtered by `readsAsProse` | a message, a flag description, a test name or a prompt read in a terminal |

**`readsAsProse`** is one text test over the literal itself rather than over the
call that produced it: five words, a sentence terminator, no concatenated edge, an
opening letter, and more letters than marks. One test therefore covers a diagnostic, a flag
description, a prompt instruction and a test name, and it drops an identifier, a
path, a selector and a fragment.

Two prunes are facts rather than policy:

- **No neighbour, no `restatement`.** A string literal has no preceding sentence,
  so the criterion is not offered, and the instructions say so.
- **A criteria label is not prose.** It is one of a question's options, and the
  question is a field rather than a sentence. It is skipped by locating `criteria:`
  between the enclosing call and the literal.

The atom carries the sentence, its neighbours, the surface name and the
declaration name, and no path: two identical sentences in two files are one
question. A path in the atom made the verdict depend on how the file was named, so
a per-file run and a repository run disagreed about the same sentence.

**The question** (`Decision.classify`, one per candidate, nine labels):

`riddle`, `verdict`, `antithesis`, `anthropomorphism`, `synonym_rotation`,
`overgeneralisation`, `false_certainty`, `restatement`, `no_issue`.

Each label is a definition with a test, and the two that carried the most noise
were rewritten as tests rather than descriptions:

- `verdict` was "grades the material instead of stating a fact", which caught every
  honest judgement about a bound. The test is now **whether deleting the sentence
  loses a fact**.
- `restatement` was "repeats its neighbour or the declaration's name", which caught
  every terse first line. It is now **states a fact the previous sentence already
  states**, and it is only asked when there is a previous sentence.

**Output** is `info` for a review-band answer and `warn` for an act-band one, with
the label and the sentence in the message and the repair in the help. The
severity stays below `error` until a labelled set says the labels are right.

## 11. What the runs found

The loop was: judge, read the findings, find the class of false positive, fix the
fact or the question, judge again. Every number below is a real run over
`packages/joggle/src` (97 files) with `dev_personal`.

| run | change | findings |
| --- | --- | --- |
| 1 | first question, `messages({...})` candidates only | 36 |
| 2 | fragment and terminator filters on literals | 34 |
| 3 | `verdict` and `restatement` redefined | 28 |
| 4 | enclosing call recorded on the atom | 31 |
| 5 | `verdict` as a delete-test | 30 |
| 6 | `restatement` pruned without a neighbour | 21 |
| 7 | criteria labels and banners skipped | 18 |
| 8 | `riddle` gains the jargon counterexample | 16 |
| 9 | the judge is told the neighbours are context | 13 |

Roughly nine of the last thirteen are findings worth acting on. Two defects in
the index itself surfaced the same way, and both are fixed:

- **`check` dropped the Markdown that discovery had found.** `checkRepository` passed
  `discovery.files` to `loadWorkspace`, and a caller that passes `discovered`
  bypasses the walk that carries `prose`. `WorkspaceInputs.proseFiles` now takes
  both lists and the read happens in one place. The first whole-repository run
  reported zero Markdown sentences, which is how it was found.
- **Every blockquote line was its own block.** A `>` marker on each line made the
  splitter flush per line, so a quoted paragraph arrived as sentence fragments:
  "deeper-version question for each before dispatching it." The confirmed
ones, with the label the judge chose. Exemplars sit in an indented block throughout
this document: a quote is evidence, and a rule that reads prose cannot tell an
authored sentence from one a document is discussing.

    atoms.ts:16                  verdict           "Content-addressed rather than positional, and that is the whole point."   0.99
    architecture.ts:18           verdict           "Most of what people call architecture is a judgement"                    0.87
    ask.ts:134                   verdict           "Narrowing the paths remains the best answer"                             0.88
    doc-matches-code.ts:95       false certainty   "The doc is the one artefact no checker reads, so it is the one that drifts."  0.86
    main.ts:862                  riddle            "deterministic where it can prove, System One where it has to judge"      0.81
    main.ts:811                  verdict           "a store that only grows is not a cache"                                  0.74
    append-only-honoured.ts:37   riddle            "A query-builder call that rewrites a structure recording the past."      0.59

Run 9 was the largest single change, and it came from the rule failing on its own
record. The atom carries `before` and `after` so a judge can see the neighbours a
reader has, and the instructions never said the neighbours are not the target. In
a document whose subject is bad prose, every neighbour is a specimen: a plainly
factual sentence stayed flagged at 0.78 while its two neighbours were examples of
the defect. One instruction line removed seven of the record's seventeen findings
and four of `src`'s sixteen. The lesson generalises: a panel that shows a model
context must say which field is the subject.

The false positives that remain are one class: **a terse operational string that
states a fact and reads as an opinion**. `answer-store.ts:28` "256 files is enough
granularity." is the clearest. It is a real finding by the delete-test (deleting it
loses the rationale for the number) and the judge called it `verdict`. A labelled
set is what settles that, not another rewrite of the prompt.

Cost: 243,831 input tokens for 320 judged sentences, across 5 API calls. The
instructions are sent once per request, so the per-sentence cost falls as the
batch grows.

In that run, 1,131 of 1,251 documented sentences and 432 of 632 literals were past
the cap, and the report says so:

    note: joggle/prose-voice — 1131 of 1251 documented sentences were not judged (budget 120).

A full-repository pass at these budgets measures a sixth of the corpus. The scoped
run (`--since`, `--pr`) is the one that fits a budget, and it is the one a gate
would use.

## 11a. The closed half is a linter

Three of the eight labels name a phrase, and a phrase is decidable without a model.
They are `plumb` rules now, at `error` in the root, joggle and plumb configs:

    no-prose-verdict       "that is the whole point", "is not decoration", "earns its keep"
    no-antithesis-clause   "X is not A. It is B.", "not A, but B"
    no-anthropomorphic-program  "the rule knows", "the report wants", "the model refuses"

They read comment and string-literal prose through one shared layer
(`plumb/src/shared/prose-sites.ts`): comment markers stripped and lines joined, so
a phrase wrapped across a line still matches, and a literal with no space skipped,
because it is a token. Spec files are exempt, and the three rule sources carry a
documented override, because a definition has to quote what it defines.

They found 52 places in this repository, all fixed, and they cannot see Markdown:
that is what joggle is for.

## 11b. The corpus, at full budget

Raising the three budgets for one pass answers the question the default run cannot:
how much of this repository reads in the register. The answer, with
`packages/joggle/docs/reference/**` ignored:

| measure | count |
| --- | --- |
| findings | 685 |
| warnings (act band) | 179 |
| notices (review band) | 506 |
| in Markdown | 381 |
| in TypeScript (JSDoc and string literals) | 304 |

By label: `verdict` 338, `riddle` 214, `anthropomorphism` 98, `false_certainty` 16,
`antithesis` 9, `restatement` 8, `overgeneralisation` 2, `synonym_rotation` 0.

The files with the most findings are the ones a reader meets first:
`FOREMAN.md` 54, `tools/foreman/journal.md` 33,
`packages/cutlist/docs/artifact.md` 28, `docs/compression.md` 20,
`src/rules/cluster-verdict.ts` 16, `JOGGLE.md` 16, this document 15.

A pass with the plumb rules and five Markdown files (FOREMAN.md, the foreman
journal, cutlist's `artifact.md` and `compression.md`, and JOGGLE.md) fixed about
90 of them. Re-judging the corpus afterwards reports 630, and the same corpus
re-judged twice moves by ten percent: the count is a sample, not a measurement.
The labelled set is what turns it into one.

Three things follow from the distribution.

- **`verdict` absorbs the other labels.** This repository contains far more
  antithesis than the 9 the judge labelled as such: "X is not A. It is B." appears
  21 times in a grep, and most of those came back as `verdict`. The labels are not
  exclusive, and a judge prefers the one that describes the effect.
- **`synonym_rotation` never fires.** Either it does not occur here or the
  definition needs a sharper test. It stays in the question until a labelled set
  says which.
- **`docs/reference/` had to be ignored.** The first pass reported 343 findings in
  pasted external texts, 193 of them in one book. The ignore is recorded in
  `joggle.config.json` with its reason, the way every other ignore in this
  repository is.

## 12. Commit messages and pull request bodies

These are read by people and are not files in the tree, so discovery cannot find
them. A commit message has no extension at all. `joggle prose` judges them and
nothing else: no walk, no parser, one rule, and a non-zero exit on a warning.

    joggle prose .git/COMMIT_EDITMSG

Or, for a pull request body:

    gh pr view 128 --json body -q .body > /tmp/pr-body.md
    joggle prose /tmp/pr-body.md --format json

`check --prose <path>` puts the same documents in the index beside a repository
run, which is what a change that edits both a doc and a message wants.

The flag exists because the alternative is a second code path. A prose input
reaches `Workspace.prose` through `WorkspaceInputs.prose`, judged by the same rule
with the same gate and reported in the same shape. A run given only prose no
longer trips the "no source files" guard, which existed to stop an empty run
looking clean.

Against a real commit message:

    COMMIT_EDITMSG
      1:1  warning  1.00  COMMIT_EDITMSG:1 reads as verdict: "joggle: the funnel is not decoration"
      6:1  warning  0.90  COMMIT_EDITMSG:6 reads as verdict: "It is the difference between a partial analysis that looks complete and one that says so."
      6:1  warning  0.88  COMMIT_EDITMSG:6 reads as verdict: "This is not a formatting change."

The subject line, the antithesis and the closing flourish are all reported. The
sentence between them, which states what changed, is declined.

A `commit-msg` hook makes that every commit:

    #!/bin/sh
    # .git/hooks/commit-msg
    command -v joggle >/dev/null 2>&1 || exit 0
    exec joggle prose "$1"

Without the guard, every commit fails for a contributor who has not installed the
CLI. `jig init --hooks` writes the `pre-commit` hook with the
same guard; writing this one there is the next step, not a separate tool.

## 12a. Markdown, measured

Discovery finds 6,319 Markdown sentences in this repository. At the current
budget the rule judges 120 of them, and the report states the rest:

    note: joggle/prose-voice — 6199 of 6319 Markdown sentences were not judged (budget 120).

Run on `FOREMAN.md` alone (`joggle prose FOREMAN.md`), 31 of its 120 judged
sentences are reported, and they are the register this rule exists for:

    FOREMAN.md:198  verdict           "It is the point of the whole machine."
    FOREMAN.md:131  verdict           "House style is not negotiable."
    FOREMAN.md:29   verdict           "Everything else is in service of that."
    FOREMAN.md:205  riddle            "Ratcheting down is paying it off."
    FOREMAN.md:119  riddle            "A source change without a rebuild is a lie."
    FOREMAN.md:49   riddle            "You hold the four tools while they cut this repository,
                                        and you hold this repository while it cuts them."
    FOREMAN.md:3    antithesis        "The goal beyond the goal is not "fix the findings.""
    FOREMAN.md:177  riddle            "Do not summarize yet — the summary is where the lie enters."
    FOREMAN.md:126  riddle            "Your own harness credentials are the same law."

A command description ("Run everything and print the census.") is the kind of
sentence this still reports and should not. It is the same false-positive class as
section 11: a terse operational string that states a fact.

## 12b. The record, judged by its own rule

`joggle prose docs/prose-voice.md` reported 26 sentences in the first draft of
this document and reports 10 now. Most of the ten are quoted evidence or an option
description; three are sentences this document wrote about the register in the
register ("The judge writes this register.").

Two conventions make the difference for any document that discusses bad prose:

- **Fence or indent the exemplars.** A quote in a bullet is a candidate, and the
  rule cannot tell an authored sentence from one a document is discussing. Every
  exemplar here sits in an indented block.
- **Fix the tics the rule names, not the label.** A finding on a sentence about
  prose voice is worth reading twice, because the subject matter primes both the
  writer and the judge.

## 13. What is still wrong

- **No labelled set.** Sixty sentences the author of this rule labels `bad`/`fine`
  is the fixture and the calibration reference. Without it the precision figure
  above is one person reading a list.
- **The budget is a fifth of the corpus at best.** 120 of 1,251 documented
  sentences, 120 of 6,319 Markdown sentences. Scoping is the answer for a gate, and
  the run cache makes a scoped run cheap; a full pass needs a larger budget than
  the default.
- **`docFor` reads a section banner as a declaration's doc.** A
  `/* ---- Pruning ---- */` above an interface is that interface's doc block. The
  rule filters the banner out by its text, but the fact is wrong for every rule
  that reads `unit.doc`.
- **A criteria map is found by scanning for `criteria:`.** A rule that builds its
  criteria in a local first, as this one does, is missed.
- **The closed tells are not a plumb rule yet.** "the whole point", "is not A. It
  is B." and the anthropomorphic subject are decidable without a model, and
  `docs/writing-rules.md` says a decidable predicate belongs in a linter. Until
  then they cost a judgement each.
- **`jig` does not run `--prose`.** `jig init --hooks` writes the `pre-commit`
  hook. A `commit-msg` hook and a PR-body gate need `jig` to pass `--prose` to the
  joggle engine, which `argsFor` does not do yet; the `visual-pr` skill calls
  `joggle check --prose` directly until then.
