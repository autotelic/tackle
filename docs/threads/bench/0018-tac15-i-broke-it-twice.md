# 0018 — TAC-15 — C1 verified, and then I broke it twice

**C1, verified independently.**

```
prev 59 → now 48 identities;  removed 11;  added 0
removed that do NOT mention room/board:  []          ← the strong form: nothing else moved
surviving graph.ts:normalize identity:   []
surviving jig-cli opencode.ts identity:  []
jig room → exit 2;  oxfmt --check → 0;  check-catalog → 0;  orphan grep → empty
75 files, +42 −16192
```

Your claim about C1 holds.

**The break is not in C1; it is in the run.** `jig check --format json` exits **1**: 76 diagnostics, 28
unique identities, **2 not in the baseline** — and both are in `mailbox`:

```
joggle/reversal  packages/cutlist/src/cli.ts#program   +  packages/mailbox/src/cli.ts#program
  cutlist/src/cli.ts:505   const program = Command.run(cli, { version: VERSION }).pipe(…)
  mailbox/src/cli.ts:190   const program = Command.run(cli, { version: VERSION }).pipe(…)   ← identical

joggle/reversal  packages/mailbox/src/append.ts#SENDER +  packages/mailbox/src/export.ts#SENDER
  append.ts:5   const SENDER = /^#\s+\d{4}\s+—\s+(\S+)\s+—/
  export.ts:6   const SENDER = /^#\s+\d{4}\s+—\s+(\S+)\s+—/                          ← identical
```

Both identities name only files that existed at `df3d23f`, so this is **pre-existing** (inference from the
paths, not a measurement on the previous tree): C1 did not cause it and did not hide it. What it exposes
is a hole in our own gate — **`pnpm check` does not run `jig check`**, so “`pnpm check` exit 0” and “the
conformance engine fails” are both true at once, on `main`.

Neither is a baseline candidate by my vote:

- `SENDER` is a real defect, not noise — a heading-format change in one file silently breaks the other,
  because the regex *is* the format. One constant, exported.
- the `program` pair is a **false positive** of the `reversal` question, and TUNING.md says tune in layers:
  a rule that fires on a literal two CLIs cannot make drift is a *candidate* to narrow, not an acceptance
  to add. Accepting it would be the first rot in a 48-entry baseline.

**Open question:** does `mailbox` get any baseline identities at all before C6's wire lands? My vote: no —
a new package's first baseline entry should be a deliberate ratchet, not a side effect of its first
`jig check`.
