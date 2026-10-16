# TypeSafe

How joggle uses TypeSafe, measured against the vendor's own guidance rather than
against habit. Sources are the published docs (`docs.typesafe.ai`) and Effect's
`Decision.ts` / `DecisionModel.ts` at commit
`87912c014132648694015a5636177b2ba2bdeb2a`. Where joggle differs, the reason is
written down.

## What joggle gets right

- **Typed questions, code in control.** Every judged rule declares a
  `Decision.Definition` with named decisions and reads typed answers; no prose is
  parsed. `DecisionModel` validates labels, distributions and confidence before a
  rule sees them (`DecisionModel.ts`, `validateAnswer`).
- **The right primitives.** Yes/no is a Noul (`Decision.probability`), a choice
  among named options is a Choice (`Decision.classify`). The probability is read,
  not only the label.
- **One snap judgment per question.** A cluster asks `redundant`, `role`,
  `relationship`, `verdict`, `consequence` and `canonical` separately, and the
  code combines them. That is the docs' "split a complex judgment into several
  questions" rule.
- **Speculative fan-out within a candidate.** `canonical` is asked even when the
  verdict may be `no_issue`. The docs call this the right default ("asking a
  question you might not need is close to free").
- **Confidence-gated routing.** `qualityOf` in `src/rule.ts` maps a Noul floor, a
  Choice margin and a confidence floor onto act / review / drop -- the docs' three
  ranges, with the thresholds in `src/policy.ts` and nowhere else.
- **State as a panel.** The evidence is a named object (`declarations`, `files`,
  `common_directory`, `identical`, `overlap`), which is the docs' "material you
  would present to a panel of experts".
- **The cache is on the wire.** `src/decision.ts` wraps the `TypeSafeClient`, so a
  replayed answer still runs through `DecisionModel`'s validation. The key is the
  encoded state plus the questions plus `policy.decisionVersion`.

## The resolved type, and the state it improves

`--types` adds a `resolved` object to each declaration in the panel:

```ts
resolved: { display, symbol, flags, arguments, members, origin }
```

The docs are explicit that a question should name the part of the state it is
about, with a backticked path (`primitives.md`, "Reference specific fields").
Adding the field without pointing at it would leave the model reading `source`
and ignoring `resolved`, so the collapse questions now say:

> The compiler resolved each declaration's type; it is on
> `declarations[n].resolved.display`. Two identical resolved types are one type
> written twice; two different ones are two types that only read alike.

That sentence is added only when a member actually carries type facts, so a run
without `--types` sends the questions it always did and keeps its cached verdicts.

## One call per candidate is deliberate

`assessClusters` makes one `DecisionModel.decide` call per cluster. That is not
the speculative fan-out the docs measure at 11.5x cheaper and 9.6x faster
(`primitives.md`, "Ask multiple questions together"), and the difference is worth
stating rather than copying a pattern by name:

- Fan-out amortises **one** state across many questions.
- Each candidate here has its **own** state, so batching candidates would send the
  same total bytes and save only round trips.
- The cache key is the state and the questions, so a call carrying several
  clusters would lose every cluster's verdict when one changed. Per-candidate
  calls keep a verdict keyed to its own evidence.

`src/ask.ts` is where fan-out belongs, and it is used there: one state, one
decision per candidate, one request.

## All three primitives are now in use

- **Noul** (`Decision.probability`) for a clean yes/no: `redundant`,
  `worth_fixing`, `fails_as_address`, `one_concept`.
- **Choice** (`Decision.classify`) for a set with no order: `role`,
  `relationship`, `verdict`, `canonical`.
- **Score** (`Decision.rate`) for a spectrum: `consequence` is now four ordered
  levels -- `no_difference`, `slightly_clearer`, `meaningfully_better`,
  `removes_a_hazard`. It was a Noul, and the docs are explicit that "would a
  reader be better off" is a degree rather than a yes/no: a Noul of 0.55 and 0.95
  both mean yes, and the report sorts on this answer, so the degree was the thing
  being thrown away. The Score answers with a probability-weighted position on its
  levels, which the rule normalises onto `[0, 1]` -- the range a Noul would have
  given, with the degrees kept.

Changing the question bumped `policy.decisionVersion`, which invalidates every
cached verdict for the collapse rule at once. That is the documented cost of
changing a question, and it is why the version is one value in one file.

## Shared atoms (implemented)

The judged rules no longer build a private state object. `src/atoms.ts` is one
content-addressed store for the run: the id of a fact is the hash of its value, so
the same declaration is the same atom in every rule and every run, and a changed
declaration is a different atom. Two rules cannot disagree about a declaration's
resolved type, because there is one atom for it.

`src/plans.ts` is the engine. A judged rule produces a `Plan` -- the atoms its
decisions reference, the decisions, and how to read the answers. `answerPlans`
then:

1. **Merges every plan's atoms into one state**, `{ atoms: { id: value } }`, so a
   declaration two rules both judge is sent once. The decisions reference the
   atoms by id, which is the docs' "reference specific fields" rule with a
   content-addressed path; a plan-local state could not be merged without
   rewriting every instruction.
2. **Answers every plan in one request**, with the decision names disambiguated by
   the plan that asked them.
3. **Sends only what is not already answered.** Each answer is cached by (the
   decision + the state it read + the model + `decisionVersion`), in
   `.joggle/answers/`. That is the piece that makes batching safe: adding a
   question, or changing a declaration another question does not name, leaves
   every other answer's key unchanged. A cached answer is re-validated through
   `DecisionModel` before it is used, so the cache is not a path around the checks.

   The same cache wraps the `DecisionModel` itself (`memoize` in
   `src/plans.ts`), so a rule that is not on the plan engine replays too. That is
   what makes the answer cache the sole replay path: the wire cache is keyed on a
   whole request, changes when any question in the request changes, and reached
   11.5 megabytes on shakti-v2, so it lives in the machine cache and is never
   committed.

## Cross-rule batching (implemented)

A judged rule that wants its questions batched is now a `PlannedRule`, not a
`Rule`. It has one method, `plan`, which does the deterministic work and returns
the questions plus a reader; it never calls the model.

The engine in `src/check.ts` runs in two phases:

1. **Plan.** Every planned rule's `plan` runs, and the engine collects every plan.
   One atom store serves the whole run.
2. **Answer and read.** `answerPlans` answers every rule's questions in ONE
   request, built from the union of the atoms they named and filtered to the
   questions the per-question cache does not already hold. Each rule's reader then
   turns its own slice of the answers into findings.

`duplicate-implementation`, `duplicate-meaning` and `naming-drift` are planned
rules; on the corpus fixture their questions travel in one request instead of
three. `tests/engine.test.ts` asserts exactly that.

A rule that is deterministic, or judged but not batched, stays a `Rule` and runs
as it always did. The engine runs both kinds in one pass. Converting another rule
is a rule-local change: build atoms, return `Planned`, and the batching is free.

## Self-consistency, because a Noul had no margin

`verdictOf` gave a Choice a margin from its own distribution and gave a Noul
nothing: `{ probability, margin: 1, confidence: undefined }`, so a Noul was gated
by the probability floor alone. The docs' [self-consistency
cookbook](/cookbooks/consistency_noul_cookbook) is the fix, and the jaggedness
note says System One is built to be stable across repeats, so the repeats are
cheap information rather than a coin toss.

`policy.decision.consistency.repeats` (3) is now asked, in the SAME request:
`answerPlansRaw` adds `name@i~0..k` for a Noul and leaves a Choice alone, because
a Choice's distribution already carries the signal and repeating it would spend a
call to learn nothing. `memoize` does the same, because a rule that answers its
own questions directly (`DecisionModel.decide`) never reaches the plan engine, and
the reduction cannot live in one of the two paths. `reduceRepeats` reduces the asks to the mean and the share
that sided with the majority, and `verdictOf` maps the agreement onto the margin
by its distance from a coin flip -- every ask agreed is 1, an even split is 0. So
a probability the model reaches by different routes is gated exactly as a Choice
the model shrugged across.

The reduced answer is what is cached, so a replay carries the agreement rather
than re-asking. That is why `decisionVersion` was bumped: a cached single-ask
answer is a different quantity from a mean over asks, and the cheap path would
otherwise mix the two.

Two consequences worth stating. A request now carries `repeats` times as many
Noul questions, so the question COUNT grows while the state does not; the
split-and-retry already isolates a request the provider rejects. And a Choice is
still asked once, so the extra cost falls only on the primitives that had no
second signal.

## Smaller gaps

- **`ask.ts` shows `resolved` without naming it.** The query is the user's, so
  the instructions cannot point at a field in advance. The field is in the state;
  a follow-up could add a fixed sentence naming it.
- **`instructions` are strings.** The docs allow JSON structure in
  `instructions` to separate the question from the data it refers to
  (`primitives/advanced.md`). joggle joins strings and relies on backticked paths
  inside them, which is the simpler form the docs also allow.

## Sources

- State, panel framing, path references: `docs.typesafe.ai/concepts/state.md`,
  `docs.typesafe.ai/primitives.md`.
- The three primitives and their answers: `docs.typesafe.ai/primitives.md`,
  `primitives/choice.md`, `primitives/noul.md`, `primitives/score.md`.
- Confidence, three ranges, risk-scaled thresholds: `docs.typesafe.ai/confidence.md`.
- Fan-out and its measured cost: `docs.typesafe.ai/patterns/fan-out.md`,
  `docs.typesafe.ai/primitives.md`.
- The API joggle builds on: `Decision.ts`, `DecisionModel.ts`
  (`Effect-TS/effect@87912c0`).
- joggle's use of it: `src/decision.ts`, `src/rule.ts`, `src/policy.ts`,
  `src/rules/cluster-verdict.ts`, `src/ask.ts`.
