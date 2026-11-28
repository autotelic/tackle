# @autotelic/standin

**A local stand-in behind joggle's judgement seam.** It has no model, no encoder, and no
network. It answers from a registry of heads and names every question it cannot answer.
That is the whole package: proof that the seam admits a provider which abstains instead of
guessing, and a ledger that says what the run did not decide.

## What a head is

A head is a function from the encoded state a question reads to one of Effect's
`Decision.Answer` shapes:

```ts
type Head = (input: Schema.Json) => Decision.Answer<Decision.Any>

const registry = new Registry()
registry.register("verdict", (input) => ({
  label: "reimplements",
  probabilities: { reimplements: 0.9, legitimate_local: 0.1 },
  confidence: 0.9,
}))
```

The input is the JSON the wire would carry, not the repository object. A head cannot read
state the question did not declare. Heads are registered by the decision name a rule used
(`verdict@3`) or by the question hash, and a lookup that finds neither is a miss. There is
no fallback head: a near-miss with a default answer is a guess with extra steps.

A head that throws, returns the wrong shape, names a label the definition does not offer,
or returns a distribution that does not sum to one is reported as `head-failed`. It is never
turned into a zero-probability answer — zero means "the head looked and said no".

## What a miss is

A miss is a question with no answer. Its reason is one of:

| Reason        | Meaning                                                        |
| ------------- | -------------------------------------------------------------- |
| `no-head`     | The registry had no head for this question.                    |
| `head-failed` | A head existed but threw, or produced a value Effect rejected. |

The question itself is the unit, as the wire sees it: `(tag, instructions, criteria,
state paths)`. Its identity is the decision's tag plus a short hash of its encoded
definition, so a head trained on a question survives the candidate changing underneath it
and fails loudly when the question's wording changes.

## What the ledger records

`MissLedger` is append-only and keyed by question hash. Each row records:

```ts
{
  questionHash: "1234abcd",
  kind: "Classify",
  labelSet: ["reimplements", "legitimate_local"],
  reason: "no-head",
  count: 3,
  firstSeen: 1770000000000,
  lastSeen: 1770000001000,
}
```

`snapshot()` returns the rows in render order, and `render()` prints one line per row,
sorted by count then hash so two runs over the same ledger are byte-identical:

```text
miss  Classify  3 questions  no-head  1234abcd  ['reimplements','legitimate_local']
```

The CLI reads a ledger and prints it; it never writes one:

```sh
standin misses --ledger .joggle/misses.json --format text
standin misses --ledger .joggle/misses.json --format json
```

A malformed ledger decodes to empty. A stale artifact must degrade to silence, never to
false findings.

## Why abstention is a first-class answer

Most judging systems treat "I don't know" as a soft failure and then round it to a number,
because a number is easier to consume. That rounding is the bug this package exists to
prevent: a zero-probability guess is indistinguishable from a confident "no", and a
confident "no" that nobody actually made is worse than no answer at all. For a conformance
tool the asymmetry is stark — a missed question costs a training-queue item or one skipped
rule, while a fabricated answer enters the report, the baseline, and the next reviewer's
belief. Abstaining is therefore a successful outcome with a name, a reason, and a count.
The miss ledger is the product: aggregated over real repositories, it says which heads are
worth building next, and a run that made zero network calls can still show exactly what it
did not decide.

## The baseline, the evaluation, and the gate

The corpus is balanced on purpose; the ledger is not. `standin baseline` reports the
constant-majority predictor both ways, under two names, so neither can stand in for the other:

```sh
standin baseline --corpus packages/joggle/testdata/single-path-corpus.jsonl \
  --prior 0.85 --majority legitimate_local --out packages/standin/testdata/single-path-baseline.json
```

`priorWeightedAccuracy` is the 0.85 the ledger's shape implies; `balancedAccuracy` is the
0.50 the balanced split would suggest. A head is scored with `standin evaluate`, whose
`--head` is a manifest carrying a map from item hash to label (or `none`, which marks every
item unlooked):

```sh
standin evaluate --corpus <jsonl> --head <manifest|none> --threshold 0.5 --out <json>
node scripts/promote.mjs --verification <json> --head <manifest>
```

`scripts/promote.mjs` is the gate, and its exit code is the contract. It refuses when there is
no head manifest, when the corpus hash does not match the manifest's `corpusHash`, when
prior-weighted recall on the violation label is at or below the constant-majority baseline, or
when abstention exceeds 20% of the verification set. Abstaining is never scored as a wrong
answer; it is counted in the unlooked bucket, and the gate refuses on the budget instead.
