# 0020 — TAC-15 — I removed the guard, and then broke the claim three other ways

**Your mutation fails correctly.** I deleted the `if (bench._tag !== "Paused")` line from the aggregate and
ran the story:

```
removed guard at line 57
Test Files  1 failed (1)
  × creates once, pauses a ready bench, resumes a paused one
StoryFailure: Rejected: expected a rejection, the command was accepted
Tests  1 failed | 2 passed (3)
```

Exactly the right assertion, from the story rather than from an implementation detail. The test is not
tautological; the claim holds for the mutation you named. Restored; tree clean.

Three other breaks, none in the story:

**1. “No cloud” — the package boundary is wrong.** `bench-domain/package.json` lists `alchemy`
(2.0.0-beta.87) under `dependencies`, and nothing in `src/` or `test/` imports it:

```
grep -rn 'from "alchemy"' packages/bench-domain/{src,test} → ∅
```

The code is pure; the manifest says the domain depends on the engine. The plan's own words are “import
only `@alchemy.run/domain` and `effect`”, so this is the boundary test failing before the code does.
It belongs in `bench-server`.

**2. “No clock” — there are two time sources, and one of them is the caller.** `CreateBench` uses the
domain's `now`; `PauseBench` and `ResumeBench` carry `at: Schema.Int` in their *input*:

```ts
decide: { PauseBench: (bench, command) => … [new BenchPaused({ at: command.at })] }
```

A caller-supplied timestamp is a clock in disguise: the story is honest because it passes `T1`/`T2`, but
an operator can stamp a pause with any instant, including one before the create. Either all three read
`now`, or `at` comes out of the command input — and I would take `now`, because “when did this happen”
is not a thing a caller should decide.

**3. Refusals are typed but not distinguishable.** `PauseBench` on an `Absent` bench and on a `Paused`
bench both throw `BenchNotRunning` (“Only a ready bench can be paused”). That is true, and it collapses
“there is no such bench” into “it is already paused”, which is the one distinction an operator needs
after a restart. Either a `BenchNotFound` rejection for `Absent`, or say in the code why the collapse is
deliberate.

None of these is a reason to stop C4. All three are one-line-shaped, and the second is the kind of
thing that gets harder after the supervisor exists, because the supervisor will be the caller.

**Open question:** does `PauseBench` take `at` because an operator may back-date a pause, or because the
Domain story API wants a deterministic clock everywhere? My vote: if it is the second, move it to `now`
and let the story pass a clock Layer — determinism is the story's job, not the command's.
