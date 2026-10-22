# Tuning the rules

> The report is the product; the census is the instrument. This file is how to read the
> instrument, when a rule is wrong, and how to change it without losing the ratchet.

A rule that reports nothing is only "clean" if it looked. There are exactly three things a
judged rule can be doing when the report is quiet, and the census tells them apart:

| what it did | where it shows | what it means |
| --- | --- | --- |
| judged, said no | `drops[].stage = "declined"` | looked, and there is nothing to change |
| judged, unsure | `stage = "gated"` | looked; the answer is below the band's floor |
| not judged | `stage = "unreadable"` or a `notes[]` "not judged" | **not looked at** — never clean |

## 1. Read the census, not the report

```sh
joggle check --format json > census.json
```

`summary.drops` is one entry per candidate — `ruleId`, `subject`, `stage`, `reason`. Read it
by rule and by stage. `summary.notes` carries the rules that had nothing to check and the
counts the report cannot show. The human report is a projection; the census is the data.

## 2. Calibrate, which classifies the questions

```sh
joggle calibrate --types --format json > calibrate.json   # whole repo
joggle calibrate --rule joggle/object-shape               # one question
```

`calibrate` replays every question over the candidates this project produces and labels each
rule:

- **decisive** — answers near 0 or 1. The question can tell. A decisive rule with `fired 0`
  is a real "clean".
- **weak** — answers sit in the middle (median near 0.5). The question *cannot tell*. Tune it.
- **noisy** — the band would act on most states. Either the candidates are mostly violations,
  or the question is too eager. Tune it, or narrow the candidates.
- **skipped** — fewer than five states, or the rule declares no violating decision (a
  deterministic rule, which has no question to calibrate).

### Two caveats, both observed here

- **Fixtures are in the calibration set.** `tests/fixtures/**` are deliberately broken so the
  tests can assert a rule fires; they show up as high-probability states. Filter fixture
  subjects before reading a verdict — `compose-types` reads "noisy" on fixtures alone.
- **Calibration's candidate set can be wider than `check`'s.** `duplicate-implementation`
  calibrates a three-way `onPath` cluster across the two `extensions/` files, which the tsgo
  program (`packages/*/src/**`) does not include, so `check` never generates it. A
  calibrate-only candidate is a scope question to resolve, not a finding to act on.

## 3. Tune in layers, cheapest first

1. **Policy** — `packages/joggle/src/policy.ts`: thresholds and floors (`minMentions`,
   `maxFiles`, the quality band, `repeats`). Re-derives candidates without touching rule code.
2. **The question** — the rule's `Decision` `instructions` and `criteria`. Sharpen the wording,
   add a label, split one question into two.
3. **Candidate generation** — the rule's `plan`: stop producing a false candidate (skip
   `node_modules`, skip test files, raise a similarity floor).
4. **An ignore** — `joggle.config.json`. A deliberate exception, with the reason written down.
   The reason is the artifact; an ignore without one is missing on purpose.
5. **The code** — when the decline is wrong and the rule is right.

Layers 1–3 change the engine and must be committed with the re-judged answers. Layer 4 changes
the config. Layer 5 changes the code.

## 4. Re-judge, re-measure, commit

```sh
doppler run -p joggle -c dev -- joggle check --rule joggle/<id> --no-replay   # fresh verdicts
joggle check --offline                                                        # replay, no key
joggle calibrate --rule joggle/<id>                                           # re-classify
pnpm jig baseline                                                             # shrink the ledger
```

Commit `.joggle/answers/` with the change: the committed verdicts are what CI replays, and a
rule change without them makes the next run judge candidates no one reviewed.

## 5. Positive controls

Every rule has a test that produces a finding (`packages/joggle/tests/`). When a rule reports
"nothing to check" here, its test proves the rule *can* fire — the repository genuinely lacks
the shape. When adding a rule, add both the fixture that fires it and the near-miss that does
not; a rule with only one of the two is a rule nobody has tuned.

## Where the numbers live

- `packages/joggle/docs/calibration.md` — the recorded measurements, with the round they were
  taken in. Read the last note first.
- `.joggle/answers/` — the committed verdicts, the replay path.
- `.jig-baseline.json` — accepted findings; it should be empty, and its length is the metric.
