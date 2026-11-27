# The remedy hill

Five rungs from "230 findings" toward "eight concepts", climbing from what is
measured to what is judged. Each rung is falsifiable, and each depends on the one
below it. Rung 1 was the only one whose target was stated before the measurement:
plumb's five boundary rules were expected to print **99 findings across 2 files for
one repair** (`no-reinterpret-cast` 29, `require-safety-comment-for-type-assertion`
25, `no-runtime-typeof` 23, `no-unknown-parameters` 11,
`no-unsafe-dictionary-type` 11). If the machinery could not see that, the
machinery was wrong.

The first full measurement refuted that target. The five rules are not one repair:
four of them are three repairs, the fifth is a fourth below them, and the witness
cannot see any of the merges the judgement found. The measurement and the
corrected acceptance are in [rung 1](#rung-1--a-remedy-is-a-column); the old
criterion is kept there, marked wrong, because a target the tool disproved is the
result that makes the rung worth having.

Background: `docs/reading/alarm-postprocessing.md` (Muske & Serebrenik, CSUR 2022;
RIT, ICSTW 2024; the ICSE 2022 leakage result) and the vocabulary rule in
`AGENTS.md`: **Jev makes judgments, code makes decisions.**

## Ground rules

**Jev belongs at the kernel, not at the edge.** It is cheap enough that cost is not
an argument: the constraint on a judgment is _replay and atomicity_, never price.
A question is admissible when its answer is recorded in the ledger and its decision
cache key (model + state + questions) makes the run reproducible, and when it asks
one thing about evidence the engine computed. Under those conditions a judgment is
as deterministic as code — and it answers questions code cannot.

A deterministic witness is still worth having beside a judgment, not because the
judgment is untrustworthy but because it **disambiguates a failure**. If a cheap
structural computation and a judgment disagree about whether two rules share one
repair, the disagreement is itself the finding, and it costs one Jev call to know.

## Rung 0 — the numbers must survive their own test

`calibration.ts` partitions by atom. The corpus is full of near-duplicates, so the
same evidence lands on both sides of the split — exactly the data leakage and
train/test duplication that dismantled the "Golden Features" result (ICSE 2022,
`10.1145/3510003.3510214`).

Partition by the decision cache key instead — model + state + questions, the key
`decision.ts` already computes — and withhold duplicates by fragment-set hash.
Report the agreement **before and after**, and the count withheld. A number that
collapses under dedupe is a finding, not a regression.

## Rung 1 — a remedy is a column

`joggle remedies` reads any findings stream (joggle's own JSON, oxlint's JSON),
normalises each finding's prescribed repair, hashes it, writes
`finding(site, rule, remedy_hash, run)` into the fact store, and prints clusters:
remedy → rules → sites → files, ordered by site count.

Normalisation is a judgment — `j_repair`: "what repair does this message
prescribe?" — asked once per distinct message and then cached in the ledger. Jev is
the kernel here, so asking is the default rather than the fallback.

Beside it, a witness that costs nothing: the imperative clause of each message
(`Parse input…`, `Narrow with…`, `Use an owner…`) with the diagnosis dropped.
Where witness and judgment agree, the cluster is unremarkable. Where they disagree,
report both and investigate the disagreement — a regex cannot tell that
"narrow with a type predicate" and "parse at the boundary" are one repair, and a
judgment that fails to see it means the evidence pack is wrong, not that the
question was.

Every cluster carries a **counterexample pack**: for each pair of rules in it, the
sites one reaches that the other cannot, and why (a fact, computed, never asked).

### What the measurement found

On this repository at the first full measurement, `pnpm lint:json` produced **304
findings over 34 rules and 75 distinct messages**.

The witness alone grouped them into **54 clusters; the largest held 39 sites over
one rule**. The judgement grouped them into **31 clusters; the largest held 83
sites**, the `effecttsgo(experimental-api-usage)` cluster discussed below.

The first target was one cluster holding all five boundary rules, 99 sites,
naming `kernel.ts` (28) and `telemetry.ts` (28). **That criterion was wrong.** The
measurement did not produce one cluster. It produced three repairs for the four
boundary rules above the fold — 89 sites — with the fifth rule below them, and it
refused the pairs that no witness can merge:

| repair                                                            | sites | rules                                              |
| ----------------------------------------------------------------- | ----: | -------------------------------------------------- |
| Parse input at its I/O boundary, then branch on the domain value  |    33 | `no-runtime-typeof` 23, `no-unknown-parameters` 12 |
| Narrow with discriminants/`in` checks or a type predicate instead |    29 | `no-reinterpret-cast` 30 findings                  |
| State the checked invariant immediately before the assertion      |    26 | `require-safety-comment-for-type-assertion` 26     |

`no-unsafe-dictionary-type` (11 findings) is below them, its own repair. The
judgement merged exactly the pair no witness can merge — `no-runtime-typeof` with
`no-unknown-parameters` — and refused the rest, with a counterexample pack that
says why: "The triggers are not the same predicate… No finding from the other rule
is recorded at those sites."

The judgement path has run with the host's key, through the launcher
[SECRETS.md](../SECRETS.md) documents. The first run answered **1,431 of 1,431
pairs in 57 API calls**, replaying 122 of 5,658 cached entries (2.2%); the second
answered the same 1,431 pairs and replayed **1,506 of 1,506 (100.0%)**, asking
nothing again. That second number is the property rung 1 needed: once answered,
the judged clustering is deterministic from the ledger.

The 83-site cluster exposed a label bug beside the measurement. Its messages are
diagnosis-only (`@effect/ui/Command#make is an experimental API`), so `j_repair`
had no candidate that named an action and answered `none`; the label path then
printed `none` as the cluster's repair, hiding 83 findings behind a non-answer.
The fix is two-sided: a diagnosis-only experimental-API message now offers the
implied repair (`Use the non-experimental, non-deprecated API`) to the judgement's
option set, and `none` is never used as a cluster label — it falls back to the
witness clause.

The ledger held the second defect beside the first. Every Classify answer the
remedies run recorded is in `packages/joggle/.joggle/answers/*.jsonl` — 2,574
answers, of which 830 offered 3 options, 1,180 offered 4, 311 offered 9 and
**150 offered 55**. 461 answers (18%) were asked with more than eight options.
`docs/jev.md` rule 4 says a Choice over more than eight options is a decision
wearing a question's clothes, and the 55-option question is the 83-site cluster's
bug seen from the other side: one question asked to pick among every witness
clause in the corpus, so the only answer a model can give for an unfamiliar
repair is the one that is not a repair. The remedy is now composed in code rather
than widened: `j_family` names the kind of repair in seven options, the clause
question offers only the clauses code assigned to that family (split again when a
family outgrows one question), and the identity is the composed `family: clause`,
which reads as a sentence because it was built, not picked. The duty question was
the other offender — 9 options at measurement, 12 today — and is now the same
family-then-clause pair. That is **rung 1.5's gate**: before any further
clustering, no run may ask a Choice the contract forbids, and after the split no
question in the corpus exceeds eight options. A judgement that has to choose among
55 candidates cannot be wrong in a way the ledger can see; a judgement split into
two bounded questions can.

The split's first measured output still had a subject where a repair belonged.
Its largest cluster was 83 sites labelled `other: @effect/ui/html/Html#H is an
experimental API`; the family answered `other` because the six families were
derived from the witness clauses, and an experimental-API message has no
imperative clause to derive from. The clause question then returned the API name,
so the label restated the finding and every one of the 83 sites — each with a
different API name — could never merge. The family set now reads the message as
well as the corpus: `use the stable API` is a repair, so those messages route to
it and share the derived clause `Use the non-experimental, non-deprecated API`.
Two guards keep the shape from recurring. A clause candidate must open with an
imperative verb; a subject is rejected and reported by message instead of being
offered. And a composed label is rejected when it is a bare identifier or starts
with `@`, a quote, or a capitalised product name. The rejected messages are the
interesting ones: they say which diagnosis-only rules still need a derived
repair, rather than hiding them behind a label that repeats the diagnosis.

The split's own failure was a one-option Choice. Measured over the corpus at the
split (75 messages, 55 clauses, every family answer in the committed ledger), the
six families then held 3, 4, 4, 2, 6 and 36 clauses: **zero families held exactly
one clause, six held two or more, and none held zero**. The seventh family is the
correction above; the one-clause case appears one level down. `partitionsOf(36, 8)` divides `other` into seven groups of five
and a tail of one, and a message that picked the tail produced a second-round
`j_clause` with a single candidate -- the same non-question the provider had
already refused, now hidden behind the group step. The route is therefore generic
rather than a special case for a one-clause family: zero candidates is an
inconsistent family assignment and fails loudly with the family and the message;
one candidate is composed in code and recorded as implied, never judged; two or
more are asked, in bounded groups. The distribution is also the evidence that six
families is not sufficient by itself: any family that outgrows the option limit
will eventually have a one-clause tail, so the route has to handle it wherever it
appears.

### The family answer is not the repair

The first cross-rule clusters after the split exposed the composed label's own
failure. A cluster forms on the composed `family: clause`, so two rules merge for
one of two reasons: they landed on the same composed repair, or the pairwise
`j_same` answered as one edit. The second path ignored the family, and the
83-site stable-API cluster absorbed five
`plumb-effect/no-nullish-default-on-partial-input` findings -- 88 sites over two
rules with disjoint site sets. The two repairs are unlike: one swaps an
experimental API, the other chooses `Schema.optional` over `?? false`. The pair
question answered what it was asked -- both messages tell a reader to use a
supported schema -- and the clustering read that as one repair.

`j_same` now closes an edge only inside one family. The family is the coarse
answer, the clause is the fine one, and the pairwise question may not widen the
coarse one -- a clause that differs by more than a synonym keeps the rules apart,
and deciding synonymy is the clause question's job. The witness's merge of the
five boundary rules is untouched: `no-runtime-typeof` and
`no-unknown-parameters` answer one family (`parse at the boundary`) with two
clauses, and the pairwise question is exactly what joins them.

Every multi-rule cluster now prints its own audit, computed and never asked: each
rule pair with both site counts, whether their site sets intersect, the highest
`j_same` over a message pair from the two rules, whether they share a composed
repair, and the family each side answered. A row with disjoint sites, no shared
repair and different families is the shape the merge must not make, and the
report now shows it without reading the ledger. The audit is a report, not a
judgement: it names which clusters to inspect, and the inspection is the next
rung's work.

### Acceptance

The rung is met when a fresh run reproduces the measured result, with any
difference named:

- **28 clusters or fewer**, the three-repair table above intact (33 / 29 / 26
  sites), with `no-unsafe-dictionary-type` below them rather than merged in. The
  family/clause split measured 28; the stable-API family may only reduce that
  number and must not split one of the three repairs.
- The largest cluster is the 83-site `effecttsgo(experimental-api-usage)` cluster,
  labelled with an imperative repair shared by every site
  (`use the stable API: Use the non-experimental, non-deprecated API`), never
  `none` and never an API name.
- A second run replays **100%** of its questions from the ledger and answers none
  of them again.
- The witness still prints 54 clusters (largest 39 sites, one rule) beside the
  judgement, and the counterexample pack for the merged pair lists the sites each
  rule reaches that the other cannot.

The old acceptance — "one cluster contains all five boundary rules, 99 sites,
naming `kernel.ts` (28) and `telemetry.ts` (28)", with the instruction "if the
five do not appear as one cluster, normalisation is wrong — fix it, do not loosen
the target" — was the hypothesis stated before the measurement. **It was wrong.**
The refutation is the rung's result: the five rules are three repairs for four of
them plus a fourth below, and no witness can see any of the three merges. Keeping
the old target would have made a correct normaliser look broken, and loosening it
silently would have thrown away the measurement that says so.

Run it with:

```sh
pnpm lint:json > findings.json
doppler run -p joggle -c dev -- node --conditions=development src/main.ts remedies findings.json
```

The first command produces the input; the second, from `packages/joggle`, prints
the judgement's clusters beside the witness's and the answered-pair count.

## Rung 2 — peel the cap off the question

One big question with a stuffed evidence pack is the mistake
(`dont-call-it-a-decision-model`): prompt gymnastics, one probability, no way to
tell whether the judgment was wrong or the rule.

Three atomic judgments, each asking one thing:

    j_remedy    do these two messages prescribe the same repair?
    j_material  does the node kind each inspects change that repair?
    j_subcase   is one trigger a strict subset of the other's?

and a code decision with published thresholds:

    same      j_remedy.p > 0.8  and  j_material.p < 0.5
    subcase   j_subcase.p > 0.8
    else      independent — and say so

`evidence.ts` stops being one rule's private catalogue and becomes the shared one;
`remedy` is its second kind. The rule admits evidence on the existing discipline:
a kind survives only when it can change the answer.

Acceptance: `--trace` prints `facts · joggle` / `judgments · joggle` /
`decision · code`, and the emitted trace JSON **recomputes the same decision with no
model call**. Paste both.

## Rung 3 — audit every rule on the new axis

For all 103 rules (55 plumb, 48 joggle), one table: each rule's questions, and each
question classified **fact**, **judgment** or **decision**. Then the count that
matters: judgments whose answer a workspace fact already holds.

The headline is already known and is not a budget problem: this repository's last
full run planned **1,388 judgments and finished none** — the token budget ran out.
Intelligence at the wrong layer does not get cheaper with more tokens.

Acceptance: totals pasted (rules / questions / judgments / code-answerable
judgments) and the five worst offenders with a proposed fact for each.

## Rung 4 — soundness is observed, not asserted

The survey splits clustering into sound (dominant alarms: representative false
means the rest are) and unsound (similarity: inspect together, never skip). Ours is
unsound by construction, so it may never license skipping.

It can _earn_ soundness: after a fix at the representative site, re-run and diff.
`soundness_observed` records what actually cleared. That is arithmetic across two
runs, which is what the store is for, and it is the one move in the 130 studies
that their tooling could not make.

Acceptance: a fixture where a cluster is declared sound only after the diff, plus
the column over this repository's real clusters.
