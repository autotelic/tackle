# The remedy hill

Five rungs from "230 findings" toward "eight concepts", climbing from what is
measured to what is judged. Each rung is falsifiable, and each depends on the one
below it. Rung 1 is the only one whose target is already known: on this repository
plumb's five boundary rules print **99 findings across 2 files for one repair**
(`no-reinterpret-cast` 29, `require-safety-comment-for-type-assertion` 25,
`no-runtime-typeof` 23, `no-unknown-parameters` 11, `no-unsafe-dictionary-type` 11).
If the machinery cannot see that, the machinery is wrong.

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
structural computation and a judgment disagree about whether 99 findings share one
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

### What the witness measured

On this repository at the first full measurement, `pnpm lint:json` produced **304
findings over 34 rules and 75 distinct messages**, and the witness alone grouped
them into **54 clusters; the largest held 39 sites over one rule**. What matters
is what it did _not_ do: the five boundary rules arrived as five single-rule
clusters — `no-reinterpret-cast` 29 sites, `require-safety-comment-for-type-assertion`
26, `no-runtime-typeof` 23, and the other two below them — because the witness
groups by exact imperative clause, and "Narrow with discriminants/`in` checks" is
not "Parse input at its I/O boundary". The witness reports site concentration; it
never reports rule redundancy. That is the work the judgement is load-bearing
for, and it is why rung 1 is not met yet: one cluster holding all five rules has
not been observed.

The judgement path is **unmeasured**, not merely unproven: this host has no
`TYPESAFE_API_KEY`. That is the contract in [SECRETS.md](../SECRETS.md), not a gap
to patch. A tool-side loader would work in one host and silently diverge in the
other; the four rules under "Why the environment, and not a tool-side loader" are
why we do not add one. A host that has the key finishes the measurement with:

```sh
pnpm lint:json > findings.json
pnpm --filter @autotelic/joggle joggle remedies findings.json
```

The first command produces the input; the second prints the judgement's clusters
beside the witness's. A run that cannot reach the model now says `WITNESS-ONLY`
and prints the reason, so a pasted witness count cannot be mistaken for the
judgement having agreed.

Acceptance: one cluster contains all five boundary rules, 99 sites, naming
`kernel.ts` (28) and `telemetry.ts` (28). Paste it, with the pair counterexample.
If the five do not appear as one cluster, normalisation is wrong — fix it, do not
loosen the target.

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
