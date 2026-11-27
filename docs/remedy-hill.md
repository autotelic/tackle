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

Deterministic normalisation only: keep the imperative clause (`Parse input…`,
`Narrow with…`, `Use an owner…`), drop the diagnosis. Judgment arrives in rung 2,
for the ambiguous tails; a first rung that already needs a model cannot be trusted
when it disagrees with us.

Every cluster carries a **counterexample pack**: for each pair of rules in it, the
sites one reaches that the other cannot, and why (a fact, computed, never asked).

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
