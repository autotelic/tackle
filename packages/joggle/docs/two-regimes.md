# Two regimes

> Where joggle's own switch statements are the classifier, and where TypeSafe
> should be.

**This is the note that started the migration it describes.** It is kept as the
reasoning, not as the current state: the line it drew held, the migration is done,
and the specifics that have changed since are marked inline. The current rules are
in [rule-coupling.md](./rule-coupling.md), which audits every rule against the same
question rather than proposing the moves.

This was the question behind a round of work that added three static rules
(`reimplemented-primitive`, `field-type-drift`, `object-shape`), three judged
ones (`naming-drift`, `language-drift`, `one-concept-one-type`), and a type
layer. Going granular is only right in one of two regimes, and the line between
them is not "AST versus model". It is **what kind of decision the code is
making**.

## Regime 1: the code decides, and the classifier is a proxy for it

A table of thresholds and branches standing in for a classification that a
System One model would make better. The tell is a hand-written cut: a
`minWords`, a `minKeys`, a `>= 2`, a `switch` on a string that names a meaning.
Each one is a person's opinion wearing the costume of a fact -- exactly what
`joggle/rule-judgment` exists to find -- and each is a candidate to delete.

The concrete count today:

| Proxy | Cut | Would become |
| --- | --- | --- |
| `roleRank` in `roles.ts` | six roles hand-ranked `0..3`, so "which layer may import which" | a `Question` over a module and its role -- the ordering is a taste, not a derivation |
| `prescriptionFor` in `cluster-verdict.ts` | a table over `(role, relationship)` | one more `Decision.classify` whose options ARE the prescriptions |
| `field-type-drift` | `minWords >= 2` and `canCompose` string rules | "do these two declarations describe the same thing?" -- **done, and then further**: both were deleted, and the rule now collects one fact (a field declared two ways) and asks |
| `reimplemented-primitive` | "the leaf inputs match", computed via `inputKey` | "is this body a call to that one?": the Noul the old judge already ran, over a resolved graph -- **done**: `inputKey` is gone, and the pairing key is the resolved callee, a fact |
| `object-shape` | suppressed when keys are a subset of any declared type | "is this shape a declared type or an unnamed one?" |
| `policy.ask.minTokens` / `maxCandidates` | a keyword filter standing in for relevance | `ask` already does this with Nouls per candidate |

`EDGE_ROLES`, `moduleRoles`, `dutyVocabulary` and `homeVocabulary` are already
this: they are options handed to a `Decision`, which is the right shape and
should be the template for the rest.

## Regime 2: no classifier, the switch IS the answer

A specification executed: a lookup table, a grammar, a dispatcher, pushed-down
agreement. The branches are the product. Collapsing these into a fuzzy
classifier does not make the tool better; it makes it **wrong** -- a probability
distribution over options where the caller needs an execution.

joggle's own Regime 2 set, which is the whole deterministic half:

- `imports.ts` -- resolving a specifier to a file is a lookup, not a judgement.
- `architecture.ts` / `import-architecture.ts` -- `cyclesIn`, `directionViolations`,
  `purityViolations`. A cycle is a property of the graph. There is no "probably".
- `cascade.ts` -- the import-graph walk that lists what a merge costs. A fact.
- `operation.ts` `permitted` / `settle` -- the part that is a rule, not a vote.
- `workspace.ts` parsing and normalisation -- the index everything else reads.
- test files, migrations, config -- a classifier that has to be run per run is
  the wrong tool for code where the answer is fixed.

The previous implementation was mostly Regime 1 with more constants: a
hand-written heuristics binary, every threshold tunable, and no calibration
harness. That is the pile this layer exists to replace -- and the mistake to
avoid is replacing Regime 2 with it instead.

## The test

For every branch, ask: **is the classification about meaning, or about a fact
that can be decided from the graph?**

- If a person would tune the threshold, or argue about a borderline case, it is
  Regime 1. Delete the branch; supply the evidence; ask a `Choice`, `Score` or
  `Noul`; put the code back in charge of the *consequences* of the answer.
- If a wrong answer is a wrong answer -- a cycle that is not a cycle, a specifier
  that resolves to the wrong file -- it is Regime 2. Keep it, and make it
  provable.

The `roleRank` case is the sharpest: a rank is being treated as derivation
("lower cannot import higher"), but the ranks are a taste about what "domain"
means. It should be a question, and the import-direction rule should read the
answer. That is the first candidate.

## The second question: are we feeding state, or doing the classification?

This is the one that matters for the judged rules, and the honest answer is
**one is doing the work and the other is supplying state**.

### Doing the work ahead of time

`derivedOperation` in `operation.ts` computes `merge` from
`oneThing >= probabilityFloor` and `difference === "value"`, then `settle`
cross-checks it against the model's own read. The cross-check is good design --
diverse estimators, disagreement reported -- but it only exists because the
table is doing the work first. The `difference` question already tells the model
what to decide; asking it about the operation TOO is the code second-guessing
the answer it paid for.

The cleaner shape: ask `difference` (which the model can answer), and let the
table and the model's `operation` answer be *peers* rather than one deriving the
other.

### Supplying state

`cluster-verdict.ts` is the model to copy. One cluster, one request, and the
panel is the material a reviewer would need: each declaration's `source`,
`documented`, `doc`, `types`, and -- when the run asked for a trace -- the
compiler's `resolved`. The questions point into it by backticked path, which is
what the TypeSafe docs ask for. `read` decides consequences from the answers and
does not re-ask them.

The type layer is the same move one level deeper: `resolved.display` is a
compiler fact in the state, not a judgement the code made. See
`docs/type-resolution.md`.

### Where the split puts the last round

- `reimplemented-primitive` keying on `inputKey` is the code doing the work.
  The right fix is upstream: a *resolved call graph* is the state, and the
  resurrection is a question asked once over it -- the same Noul the deleted
  `same_behavior` used, but with call sites in the state, which is what that
  question was missing. **Done**: `inputKey` was deleted outright rather than
  demoted to evidence, because "the same inputs" is the question.
- `object-shape` and `field-type-drift` are in the same place: pure Regime 1
  wearing a Regime 2 costume. Deterministic and free, so they stay as a cheap
  first pass; their over-reported cases are the judgement, not the rule.

## What to do next

All four are done.

1. **`roleRank` is a question.** `RoleRanking` in `vocabulary.ts` asks which role
   sits lowest; `classifyModules` asks it once per run and returns `ranks`, and
   `module-direction` reads them. `EDGE_ROLES` followed: `edgeRolesOf(ranks)`
   derives the outer layer, so a repository whose API is the edge and whose UI is
   the product is no longer reported upside down.
2. **`prescriptionFor` is an option set.** The prescription is one more
   `Decision.classify` on the cluster questionnaire, with the operations the
   import graph permits named in the instructions. The table remains only for the
   unverified path and its tests.
3. **`derivedOperation` and the model are peers.** `settle` compares them and
   reports a disagreement; neither decides first.
4. **Resurrection is judged.** `reimplemented-primitive` became a `PlannedRule`:
   the call graph generates pairs (high recall), and a question over both graphs
   decides whether they are the same operation. `inputKey` was then deleted, not
   demoted: the pairing key is the resolved callee, and what each call reads is
   evidence the question sees.

## What this cost

`reimplemented-primitive` moved from the deterministic column to the judged one,
so a run with no model key now reports its pairs marked unverified instead of
asserting them. The breach count in `check.test.ts` went 11 -> 10 for the same
reason: a rule that asks a question is withheld when its evidence would cross a
repository boundary.

## The one that is not a text problem either

`field-type-drift` is the rule to watch, and the lesson from it is narrower than
"use the checker" and narrower than "ask a question". Its finding is "one field
name, two incompatible types"; the feedback that produced this note answered
whether that matters in the words "two concepts, not one", which looks like a
meaning question -- so it was built as one, and **measured worse**: 150 findings
against the deterministic rule's 102, with the model answering "one concept" 85%
of the time and `ProjectRole`/`ProjectCrewRoles` still a confident warning.

The reason is circular and worth stating plainly: telling two vocabularies apart
means comparing their **values**, and the values are the resolved type the trace
does not carry. A question cannot recover a fact missing from its state, and the
state here -- two field names and two annotation strings -- has never contained
what the answer needs.

What worked instead was a hazard test, not an identity test: **drift is only a
hazard when a value can move between the two declarations**, so a pair in two
packages with no import path is skipped, deterministically. That is the opposite
of the locality argument for duplicates (`docs/reference/names.md`), and correctly so -- a
duplicate claims two things ARE one, which can be true across areas; drift claims
a shared name will be confused, which needs a path. On `shakti-v2` it took 97
incompatible pairs to 74 findings and silenced every case in the feedback.
`docs/type-resolution.md` keeps the measurement, the question that failed, and
the routes that remain (a checker host for the value sets, config for the rest).

So the rule kept a frozen text resolver as the least bad instrument. **That
resolver was later deleted too**: the rule now collects one fact (a field name
whose declared annotation differs between two declarations that can reach each
other) and asks the model whether the difference is drift, which is the question it
was already asking. The remaining Regime 1 rules -- `object-shape`,
`compose-types`, `name-the-primitive` -- keep their deterministic pass as high
recall candidate generation and ask for a question only when the state a question
needs is present.

## Afterwards

Read this note with [rule-coupling.md](./rule-coupling.md), which is the same test
applied to the finished rule set rather than to a plan. Two things it settled that
this note could not see:

- **Every rule ended up judged.** The "deterministic half" here became candidate
  generation inside a judged rule, never a rule of its own: a check that is not a
  question is a linter's job, and a meta-rule now rejects one.
- **Two vocabularies stayed, declared.** `temporal-coupling`'s operation pairs and
  `data-error-as-outage`'s framework method names are knowledge about resource APIs
  and about HTTP, not facts derivable from the code, so they live in policy with a
  stated reason rather than hiding in a rule.

