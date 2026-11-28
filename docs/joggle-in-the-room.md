# joggle in the room

A live stream of `joggle` findings inside a workstream, informed by three sources: the
small-model wave (`gpu-lexer`, and the five models that followed it), `jimothy`, and
_Outrageously Small Neural Networks_ ([Diamos, 2026](https://huggingface.co/gdiamos/amx-reasoning-v1-instruct/blob/main/paper.pdf)). The claim, in one sentence:
**generation runs continuously in the room and reports counts; judgement stays at landing and
judges only the delta.**

The tiny model is a separate claim with its own consumer, and it does not depend on the room half:
**landing in CI, and an on-demand "judge this delta now", can judge without a key.** It is an
availability argument — CI, a fresh clone, a machine with no `TYPESAFE_API_KEY` — never a speed
argument, because a warm fact store already answers in seconds and 1,424 of 1,431 pair judgments are
decided by code before any model is asked.

---

## 0. Why this document exists

`board/src/factory/kernel.ts` currently tells the build phase: _"Do not run the tests, lint, tsc,
jig, or joggle. Do not wait for anything."_ That prohibition was written against a 240-second cold
sweep that produced noise, and it was correct for what it faced. Two of its premises have moved:

- generation over 516 files is now **2.11s warm / 0.57 GB** (7.95s / 1.31 GB cold), measured on
  this repository on 2026-11-27;
- the judged path is where the time is: **57–648 API calls, 10–80s** for the same run.

So the question is not "should joggle be in the room" in general. It is which half belongs in the
room, and what a finding is allowed to say when it arrives.

---

## 1. What the sources buy us

Three sources, three facts, three decisions. None of them is decoration; each one settles a
question that would otherwise be argued.

| source                                                                | the fact we take                                                                                                                                                                                                                                                                                                                                             | the decision it settles                                                                                                                                                                     |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`gpu-lexer`](https://github.com/vercel-labs/gpu-lexer) (Vercel Labs) | 50,681 weights at 6 bits each, 30.28 KiB brotli, one model for every language, trained against Shiki labels — so "quality" is **agreement with the teacher**, 89.89%, not semantic truth                                                                                                                                                                     | a small model's honest metric is teacher agreement, and one shared artifact can serve a whole family of questions; the artifact can be small enough to ship                                 |
| [`jimothy`](https://github.com/AndrewPrifer/jimothy)                  | a task is one question (`choice`/`boolean`/`noul`/`score`) with fixed instructions and criteria; training fits a linear head on frozen MiniLM embeddings, fits temperature on a held-out calibration split, and publishes a **threshold recommendation with an exact binomial lower bound and a Bonferroni correction over 13 thresholds**                   | how a head is trained and how a cutoff is justified without trusting a single accuracy number; `thresholdRecommendation: null` (`insufficient_data`) is a first-class outcome               |
| _Outrageously Small Neural Networks_ (Diamos)                         | 3.65M active parameters, one CPU core, 259M tokens: in-context induction 93% vs 7% chance, positional shift 90%, but arithmetic 47% — "retrieval and comparison work, arithmetic does not". Four failures were invisible in the loss curve; the **vocabulary mask** existed because untrained output rows win the argmax exactly when the model is uncertain | a tiny judge can do _sameness, containment, does-this-panel-fill-this-pattern_; it cannot do _compute this policy_. And a head that has an untrained label must say "unjudged", never guess |

The fourth source is not a paper: `gpu-time`, `gpu-query`, `gpu-cron`, `neural-flexbox`, `tinysarf`
— five task-specific models published in one week. The lesson is not that models are small; it is
that **the winning shape is one narrow question with a fixed answer space**, which is exactly what
`docs/jev.md` already forces a question to be.

### What we take from each, in one line

- from `gpu-lexer`: ship one artifact, prove it by agreement, and make the answer space closed;
- from `jimothy`: a head is only allowed to exist if a held-out cutoff can be justified;
- from the paper: classify, do not calculate — and give uncertainty a place to go.

---

## 2. What is true today

| measure                                    |                                                                                                                                                                                                                        value | where it comes from               |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | --------------------------------- |
| rules in a run                             |                                                                                                                                                                         110 (59 deterministic plumb + 51 adjudicated joggle) | `docs/question-audit.md`          |
| questions                                  |                                                                                                                                                                                     86 — 67 judgments, 16 decisions, 3 facts | `docs/question-audit.md`          |
| judgments a workspace fact already answers |                                                                                                                                                                                                                           12 | `docs/question-audit.md`          |
| pair judgments decided by code             |                                                                                                                                                                                                               1,424 of 1,431 | remedies run, 2026-11-27          |
| findings on this repository                |                                                                                                                                                                                                                           15 | full judged run, 2026-11-27       |
| generation, warm                           |                                                                                                                                                                                                              2.11s / 0.57 GB | full check, 516 files, 2026-11-27 |
| generation, cold                           |                                                                                                                                                                                                              7.95s / 1.31 GB | same                              |
| judgement                                  |                                                                                                                                                                                                         57–648 calls, 10–80s | same                              |
| answers already on disk                    |                                                                                                                                                                                             8,171 in `.joggle/answers.jsonl` | this checkout                     |
| **a room pass is available today**         | `joggle check --offline --format json` on this repo: **526 files, 6.8s, 1.32 GB, 16 findings — all 16 deterministic, 0 judged**, 288 requests / 686 replays / 287 unavailable, and **27,366 candidates dropped on `budget`** | measured 2026-11-28, whole tree   |

The last row is the whole room half already working: an offline pass produced 16 findings with
no key and no judgement, every one of them deterministic, and every one of them a fine thing to
report as a count. It also names the problem that outranks all the others: **27,366 budget drops** is
not a clean run, and a room report that omitted that number would be the "quiet rule" lie
`AGENTS.md` warns about — a quiet run is only clean if it looked.

### The number is a bug, not a measurement

Writing this document found a defect, and it changes what the first milestone is.

Three runs of the same command disagree in a way that no reading of "budget" explains:

| run                      | findings | decision                                      | drops                                                                     |
| ------------------------ | -------: | --------------------------------------------- | ------------------------------------------------------------------------- |
| this checkout, full tree |       16 | 288 requests / 686 replayed / 287 unavailable | 28,495 — `budget` 27,366                                                  |
| same, **cutlist only**   |        2 | —                                             | 0                                                                         |
| trunk, by a peer         |        8 | 556 requests / 556 unavailable                | 7,404 — `budget` 6,646, `unreadable` 678, `no_evidence` 61, `declined` 19 |

The mechanism, read off `src/check.ts`:

1. the budget is charged **before anything is sent**, on an estimate — `ceil(chars / 4)` per chunk,
   walked over _every_ chunk (`allPlans`), including the plans that would have replayed from the
   ledger for free. A warm ledger can be blocked from questions it already knows the answer to.
2. the label is then manufactured: a drop whose subject is in `overBudgetSubjects` is **relabelled**
   `stage: "budget"`, so one over-budget chunk becomes a drop per subject in it — 6,646 "budget"
   drops against a note that says 895 plans were over budget. That is drops-per-subject inflation,
   not 6,646 unjudged questions.
3. `--offline` is orthogonal: an unreachable answer is `UnknownError` → `isUnreachable` → a note,
   never a drop. Both paths run, and both are reported under one word.

The consequence for this plan is direct: **delta measurement is meaningless until this is fixed**,
because the preflight truncates the denominator and would make any delta look small for the wrong
reason. Fixing it is M0a; separating the vocabulary is M0b.

Two numbers describe the whole plan. **1,424/1,431 decided by code** says the speed comes mostly
from not asking. **12 code-answerable judgments** says a tenth of what remains is not the model's
job either.

---

## 3. The split

The distinction is not fast versus slow. It is **whether there is a diff to hang a finding on, and
whether acting on it is in scope**.

|                                   | room                        | landing                                      |
| --------------------------------- | --------------------------- | -------------------------------------------- |
| generation (facts, deterministic) | continuous, warm            | full                                         |
| judgement                         | none                        | the **delta only**, replayed from the ledger |
| a finding is                      | a count and a path          | a verdict with evidence                      |
| the artifact                      | a projection, non-committed | the committed `.joggle/` ledger              |

A verdict delivered mid-exploration invites the agent to stop and fix — the opposite of the policy
that currently keeps the factory moving and cleans up at landing. A count does not: it is
evaluated at the next tool-call boundary and can be ignored.

---

## 4. The room half

### 4.1 Cursor and projection

- The cursor lives in `room.json`: `{ checkpoint sha, file hashes, index generation, at }`.
- The projection lives in the fact store: one row per `(cursor, site, rule, first_seen)`, plus
  `fingerprint`, `evidence`, and `judged: false` with a **reason** — over-budget, unavailable,
  unreadable, or no-evidence. "No `confidence` field" is not the flag: `no_evidence` is not
  blindness, and `unavailable` is not exhaustion.
- The authoritative finding is the joggle artifact committed at landing. The room **never** writes
  a findings store of its own; it writes what it saw, keyed to a cursor, and lets the next
  generation pass confirm or drop it.

Two truths is the failure mode this section exists to avoid.

### 4.2 The admission rule

| rule                                                                                                                         | why                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| scope: files touched since the cursor, plus their direct dependents                                                          | a finding about a file the agent is not editing is a landing finding                            |
| delta: not already in the ledger or baseline for that `(site, rule)`                                                         | replay is the point of the ledger                                                               |
| certainty: only diagnostics that are deterministic (`judged: false`, reason absent) or judged above the rule's own threshold | a quiet rule is only clean if it looked; "judgement unavailable" must never render as a finding |
| dedupe: one per rule per file per fingerprint until content or index generation changes                                      | the same finding twice is noise, not emphasis                                                   |
| timing: after the edit settles, at a tool-call boundary                                                                      | never mid-write                                                                                 |
| budget: at most 3 per report, ordered by severity × rarity                                                                   | an agent can act on three things; ten is a lecture                                              |
| payload: the count and the paths                                                                                             | the agent can ask for detail; it cannot unsee a verdict                                         |

### 4.3 What a report looks like

```
joggle  since 4f1c2a9  2 new in files you touched
  src/drawer.ts    1  (duplicate-meaning, high)
  src/panel.tsx    1  (page-needs-composition, medium)
  ledger 79% answered · not judged: 4 ceiling · 3 token budget · 2 offline
  prose-voice judged 120 of 1,733 documented sentences
```

Three lines of accounting, and the two numbers that matter are not the finding count.

**Coverage** is the second number. The same commit, same command, measured on two machines: a warm
ledger reported **28 findings**, a cold one reported **8**. Nothing about the code differed; 1,478
questions were answered from the ledger on one and asked, unanswered, on the other. So a finding
count is a statement about _coverage_ as much as about the code, and a report that prints "2 new"
without it invites the reader to read silence as clean.

**A ceiling is a ratio, not a pile of drops.** A rule's candidate unit is whatever the rule judges --
a declaration, a file, a _documented sentence_. `prose-voice` caps at 120 sentences and emitted 1,613
drops for the sentences it did not judge: correct per candidate, and an order of magnitude wrong as a
denominator, because one rule at 2% active then dominates a run's unjudged count. The line says which
unit it is counting and what fraction the rule actually judged; the drops stay in the census for the
census's use, not for the reader's.

**The denominator is mostly one policy number.** Measured on this repository: candidates =
4,656 asked + 16,794 ceiling + 181 no-evidence = **21,631**, of which **1,580 were judged (7%)** —
and 16,161 of those ceiling candidates are `prose-voice`'s 120-sentence cap. So before M3 can read a
delta, the denominator has to be either raised (a bigger cap) or excluded per rule; a 7% figure
where 96% is one constant is a measurement of the constant.

And it is not even a constant: the cap judges the **first 120 sentences of each kind in file order**,
so 7% is a measurement of the opening sentences of every document, not an estimate of the tree.
That is a defensible policy -- a riddle lives in the opening -- and raising 120 to 400 buys four
times more of the same slice at four times the cost. So the ratio now names its selection
(`judged 120 of 3,935 documented sentences (first 120 of each kind, in file order)`), and a cap
change has to be an experiment with a receipt -- candidates, calls, input tokens, wall time and
new findings per 1,000 judged, reverted if the marginal rate halves -- not a policy edit.

Two corrections the numbers forced, both now in the code: an **unreachable answer leaves no drop**
(1,007 drops against 3,080 plans without an answer on a keyless run), so `unjudged` is the engine's
own `asked - answered` and the drops are only the reason breakdown; and `no_evidence` candidates can
outnumber the plans (`containment`: 150 asked, 181 dropped), so a formula of `plans + drops`
double-counts and the stage map needs to say which stages count as candidates of their own.

**Three silences, not two.** `unjudged` is the engine trying and failing to read an answer
(unreadable, the run's token ceiling). `unlooked` is a rule's own cap, which a reader can raise.
`judgedSilent` is the engine looking and having nothing to act on -- a declined judgement
(no issue, not applicable) or a candidate with no evidence to send. The third is a _result_, not a
gap: on one run 1,498 candidates were declined and 16,790 were capped, and adding them into one
number says the tool is blind when it is mostly busy. Only `unjudged` blocks a baseline; `unlooked`
is printed loudly beside it and quoted in the accepting commit, which is informed acceptance rather
than silent acceptance -- the same shape as `joggle.config.json`'s reasoned ignores.

Two lines of paths, one line of accounting. The last line is the honest one: it says how much of
the delta nobody has judged yet **and why**, which is the difference between a quiet run and a
blind one. "2 new" is a statement about diagnostics; it is never a statement about the code.

---

## 5. The model half

### 5.1 What a local judge would actually be

The unit is the **question as the wire sees it**: `(type, instructions, criteria, state paths)`,
hashed into a registry of heads. A local provider answers only questions it has a head for; every
other question is a **miss**, reported with a reason, never answered by a guess.

This is not a per-rule classifier bolted onto joggle. It is a second `DecisionModel` provider that
satisfies the same contract, so `docs/jev.md`'s eight rules and two shapes apply unchanged.

### 5.2 The gate a head must pass

A head ships only when all five hold.

1. **Enough states, and enough of each label.** At least K distinct states in the teacher corpus,
   deduplicated by the per-question cache key (never by batch), **plus a minimum per-label support and
   states drawn from more than one repository** — the paper's vocabulary-mask lesson is that an
   untrained label wins the argmax exactly when the model is uncertain, and the same holds for a label
   seen only in one project's idiom. The head also fails **loudly** when the question it was trained
   on no longer matches (gate 5): the remedy family went six families to seven in one session and
   every clause string was rewritten, orphaning heads silently.
2. **The question is not code-answerable** in `docs/question-audit.md`. This is a moving audit, not
   a one-time verdict: it is re-checked whenever a rule gains the fact that would answer it.
3. **Agreement with the teacher's decision, at the teacher's own self-consistency bar.** The
   drafted version of this gate was circular: the teacher _is_ the remote, so "agreement with the
   teacher ≥ the remote's" is 100% by construction. The measurable bar is the teacher's
   self-consistency on the same deduped split — **0.986** in this repository (0.987 before dedupe) —
   and a head also has to hold **coverage parity**: it may not earn agreement by abstaining more often
   than the teacher, per rule and across evidence lengths.
4. **A justified cutoff, on the deduped split.** `jimothy`'s acceptance subset, its exact one-sided
   binomial lower bound, with the Bonferroni correction applied over **every head actually shipped** —
   not over the 13 grid points. The bound assumes independent trials, and this corpus is **57% exact
   duplicates** (1,474 of 2,597 withheld in one night's run), so a bound computed on the raw split is
   optimistic by construction — the same way the first calibration number in this repository collapsed
   12.1 points under dedupe. `insufficient_data` is a valid, shippable-in-the-negative answer.
5. **A pinned question definition.** The head records the hash of (type, instructions, criteria,
   state paths, extraction version) and the encoder window it was trained against; a definition edit
   orphans the head loudly instead of silently. Evidence longer than the window is a gate failure,
   not a truncation.

A head that fails any of the five is not shipped, and the miss it leaves behind is the product
signal.

### 5.3 The miss queue is the product

Every consumer reports the questions it asked and could not answer locally — CI, an on-demand judge,
and a room if one opts in. Aggregated, that list is **which heads to train next**, ordered by how
often real repositories ask. It rides the existing receipt/telemetry channel as data — no new surface.

### 5.4 Two things this is not

- **Not the ranking path.** `src/ask.ts` asks N `Noul`s per candidate and sorts them. Per-question
  heads produce the same space in principle; sorting inconsistently calibrated probabilities is a
  bug that looks like a ranking. Ranking stays on the remote.
- **Not a replacement for rung 3.** Twelve judgments are code-answerable today. Distilling them
  first would train heads on a corpus that rung 3 deletes.

---

## 6. Where each piece lives

| piece                                  | home                                                   | why                                                                  |
| -------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| generation, cursor, projection, report | `@autotelic/joggle` + `@autotelic/room`                | room is the durable place per scope, fact store already per checkout |
| provider interface for a local judge   | a package, not the orb                                 | write the interface now; it is the expensive thing to move later     |
| artifact (weights, heads, calibration) | shop-side build of the orb image, cached into the room | a head changes what joggle **is**, so it is a product decision       |
| miss aggregation, per-head quality     | shop/telemetry                                         | board decides _when to run and land work_, not _what the tools are_  |
| the verdict                            | landing                                                | it is the only place with a diff, a receipt and a replay             |

One implementation is not a protocol. The orb carries artifact and a thin client; promotion to an
orb primitive waits for a second consumer.

---

## 7. Milestones, with kill criteria

Two tracks, two decision points, and neither waits on the other.

### The room half

| #   | milestone                                                                                                                                                                                                                                             | passes when                                                                                                                                                                                                                                                                                                  | killed when                                                                     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| M0a | **the budget bug**: preflight only the plans that will actually go to the wire (filter cache hits before the loop), stop relabelling `unreadable` drops as `budget` (the `overBudgetSubjects` remap), and report the preflight separately             | a warm ledger is never blocked from questions it could replay; the drop count is drops, not drops × subjects; and a fixture whose **cache hits alone exceed the ceiling while its misses fit comfortably** is blocked today and answered after                                                               | the preflight still charges for cache hits, or the fixture cannot be built      |
| M0b | split the stage vocabulary: `ceiling` / `token` / `unavailable` / `unreadable` / `no_evidence`, keep `budget` decodable as an alias, and update `UNJUDGED_STAGES` **in `jig-cli/src/engines.ts` too**                                                 | every unjudged total equals the sum over stages for a run carrying all of them (asserted by a test); yesterday's stored run still totals                                                                                                                                                                     | a surface silently reports zero unjudged                                        |
| M1  | `joggle check --changed --offline --format json` as the room's generation pass                                                                                                                                                                        | warm run under 3s here, diagnostics carrying the honest `judged: false` + reason                                                                                                                                                                                                                             | warm run over 3s, or the flag conflates no-evidence with blindness              |
| M0c | a rule's candidate ceiling is reported as a ratio with its unit named (`judged 120 of 1,733 documented sentences`), and its candidates are excluded from M3's denominator per rule                                                                    | one rule's cap can no longer dominate the unjudged count, and the report names the unit                                                                                                                                                                                                                      | a ceiling candidate is still counted as if it were a judged-clean one           |
| M2  | cursor + projection + report at a tool-call boundary                                                                                                                                                                                                  | a room run reports count, paths and not-judged-by-reason, deduped, capped at 3                                                                                                                                                                                                                               | more than 3 actionable findings per window, or dedupe needs a commit per report |
| M3  | **delta measurement**: one stored run plus `--changed` from the room cursor's checkpoint, with a warm store and identical scope; the census already gives requests / replayed / judged / unavailable, so new-after-replay is `judged` over `requests` | typical build window: diagnostics new, candidates changed, `unjudged` by reason, `unlooked` (caps) **excluded from the denominator**, and `judgedSilent` reported separately per rule — a rule with 1,400 declines is busy, a rule with 6,500 ceiling drops is capped, and the two look identical in a total | the delta is single digits per window — then the room half is all there is      |

Landed: M0a and M0b in `30e3bf02`, M0c in the commit that adds this line. M3's baseline starts
at M0c.

The order is `M0a → M0b → M0c → M1`, and M0b before M1's report line on purpose: that line names a reason
per unjudged candidate, which cannot ship while one word means two facts. (The alternative — M1
count-only, M0b adding the reason later — costs a second report format for no benefit.)

M3 is the room half's decision point, and **its baseline starts after M0a lands**. M0a changes which
candidates are asked, so it moves the denominator of every later measurement: land it alone, re-run
warm on trunk, and record "candidates budget-skipped by the preflight, before/after" as the change's
receipt. Any window measured across that boundary is meaningless.

One precondition on M3: check that the **misses fit the ceiling at all, on a warm and covered
ledger**. The same commit and command, on a **cold** ledger, has 556 requests, 556 unavailable, and
906 plans that did not fit a 1,000,000 ceiling — the misses genuinely exceed it. So the condition is
"warm and covered", not absolute; a report that fails it says "ceiling: 906 plans unasked" with the
cause named, never a fraction. The delta itself prints "candidates changed: N, all asked; of those
new: M", because a fraction invites the reader to believe the remainder was judged.

Two ledger facts must stay distinct, because they lead to different work: a question that has **never
been judged in this repository** is a training-queue item, and a question whose answer exists but was
not reached is a coverage defect. Both fail the same line, and the line says which.

### The model half

The consumer is not the room. It is **CI (no key) and an on-demand judge** — the claim is smaller,
cheaper, and testable without M1–M3.

| #   | milestone                                                                                                | passes when                                                                                                        | killed when                                   |
| --- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- |
| N1  | the provider interface: a `DecisionModel` that answers from a registry of heads and misses with a reason | a test double **misses** deterministically and the reason reaches the report                                       | the interface needs joggle internals to work  |
| N2  | one head, on the most-asked question that survives rung 3, trained from the existing ledger's corpus     | it passes all five gates in §5.2, with the deduped bound                                                           | no question clears gate 1 or 3                |
| N3  | keyless judging in CI: the same run, no key, head answers, misses named                                  | the run's findings on holdout agree at the teacher's self-consistency bar and coverage is not bought by abstention | agreement is bought by suppressing hard cases |
| N4  | artifact through the shop's orb image (weights, heads, calibration, teacher provenance)                  | a fresh checkout judges key-free; the artifact's provenance names its teacher                                      | provenance cannot name a teacher version      |

### M0a and M0b, exactly

`DropStage` (`src/schema.ts`) is a closed set: `declined`, `gated`, `unreadable`, `no_evidence`,
`budget`. Two limits report as `budget` — a rule's own candidate ceiling (`src/rule.ts`,
`budgetNote`) and the run's token budget (`src/check.ts`, the remap) — and the remap also inflates
them. The change: preflight only wire-bound plans; relabel nothing; add `ceiling` and `token` to the
union with `budget` decoded but no longer written; grow `UNJUDGED_STAGES` in joggle **and** in
`packages/jig-cli/src/engines.ts`, where the same set is hardcoded and feeds every jig and agent
surface — missing it turns the count into zero, which is a quieter lie than today's.

Nothing downstream breaks: `.jig-baseline.json` identities are rule + file + symbols tuples with no
stage; the lint baseline carries a census with no stage; receipts carry the census note as prose.
The one requirement is the same-commit update above, plus a test asserting the unjudged total equals
the sum over stages.

---

## 8. What would make this wrong

1. **The build window is too small.** If a typical window changes a file or two, generation plus
   projection is more machinery than the findings are worth, and the honest answer is a landing
   gate that runs faster.
2. **The findings are not actionable without their evidence.** Then the count is useless and the
   report has to carry message and help, which turns it into a lecture and re-creates the
   prohibition in `kernel.ts`.
3. **The heads are a lookup table.** Five positives and a confidence score will agree with the
   teacher exactly where the teacher was memorising. The gate in §5.2 exists for this, and if most
   questions fail it, the model half dies and the room half still stands.
4. **The teacher moves.** `jev-latest` is an alias, not an artifact. A head trained against it has a
   floating label: a vendor update moves every target at once and you cannot tell whether the head
   broke or the teacher did. So a head records `teacherModelId`, a frozen corpus snapshot hash, and
   its answer set; a teacher change is a **retraining event with a regression gate**, and a small
   canary set of head-vs-teacher disagreements goes to a human. Without that, "agreement 0.91" is a
   statement about last Tuesday. This is the weakest line in the document.
5. **The question definitions keep moving.** A head is keyed on prose — criteria you are editing. The
   remedy family went six families to seven in one session and every clause string was rewritten; a
   head keyed on that definition was orphaned mid-session, silently. The model half is only worth
   building once the definitions have stopped moving, or the orphaning is loud.
6. **The denominator is wrong.** M0a exists because a room reporting "2 new in files you touched"
   while thousands of candidates were skipped is the firehose inverted into a lie of omission — the
   precise failure `AGENTS.md` names ("a quiet rule is only clean if it looked"). If the fix cannot
   make the denominator honest, the report should not be written at all.

---

## 9. Open questions

- Does the room report belong on the next tool-call boundary, or on the agent's own turn boundary?
- Does the delta measurement (M3) run per room, or once per repo and be shared by all rooms in it?
- Is the projection allowed to outlive its cursor, or is it discarded on resume from a snapshot?
- Who owns the artifact's provenance: joggle's version, or the shop's image build?
- Does the token preflight belong in `check.ts` at all, or in the plan builder where the cache hits
  are already known?
