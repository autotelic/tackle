# The feedback ledger

The factory's own backlog. `docs/factory-plan.md` §Phase 4 is where reports come from; this is the
record that answers "what happened to that report" without re-reading the stream.

A report is handled when its **verdict** is written where the next pass can read it. The watcher
advances `cursors.reports` past each file, so the inbox forgets; this ledger is the memory. The key is
the report's `fingerprint`: a repeat increments a count and cites the first verdict, it is not
triaged again.

**Fingerprint equality is sufficient, not necessary.** `fingerprintOf` hashes the kind, the command
and the first line of `actual`, so one defect reported through a second command — `gh run view --job
… --log`, then `gh api …/jobs/…` beside a local re-run — yields two fingerprints and one subject.
The subject is what the report is about: a repo and a run, job or step. A second fingerprint on a
subject already in the table gets a `duplicate` row that cites the first; that row is the count, and
it is not a second investigation.

## 1. Verdicts

| verdict          | where the defect is                                | what follows                                                                              |
| ---------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `owner-repo`     | a workstream's own code, config or CI              | routed back to it; this repo is not edited — cross-workstream work is a mail, not an edit |
| `factory-defect` | a tool this repo publishes                         | a trunk pass: the fix, a fixture test, before/after jig counts                            |
| `gate-defect`    | a protected path (`packages/factory/**`, the gate) | a desk item first, then a branch with a human merge — trunk mode does not lift this       |
| `duplicate`      | nothing new                                        | increment the count on the first row and cite it; nothing else                            |
| `not-a-defect`   | not in the tool                                    | record why the expectation cannot hold, so the next identical report closes in one line   |
| `waiting`        | a fix that exists                                  | name the blocker: a release, another workstream, an unmet gate                            |

## 2. Two rules that decide most reports

**A red check is not a failing test.** A step killed at its bound exits with no test summary because
no test failed. The factory's own runner already draws that line and pins it: `StepResult.timedOut`,
`infrastructureFailure.kind: "step-timeout"`, and a failure set that skips a timed-out step
(`packages/treadle/src/checks.ts`, `packages/treadle/src/report.ts`, each with the test that fails if
the guard is removed). So "the log has no test name" is read as _the red step does not say what
happened_, not as _the runner lost the name_. That distinction is what decides whether a report
describes a defect in the factory or in the workflow that ran the step.

**A report is about the factory the reporter ran, not about the world it observed.** `gh`, a job log
and a Linear page are the reporter's tools; when the bytes are thin because CI killed the process,
the fix belongs where the process runs. Triage asks which config produced the line; a line produced
by a workflow's own `timeout-minutes` is that workflow's to fix.

## 3. The ledger

| id                                      | fingerprint                                                                                                  | kind        | verdict      | route                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------- | ------------ | --------------------------------------------------------- |
| `report-permissions-1862-1795303302409` | `conformance:gh run view --job 136075695353 --log:bf49d72626a9`                                              | conformance | `owner-repo` | permissions-1862: its `test-rest` shard                   |
| `report-permissions-1862-1795303401889` | `conformance:gh api .../actions/jobs/136075695353; cd services/rest; npx mocha <shard 2 files>:7712854710d8` | conformance | `duplicate`  | cited: `report-permissions-1862-1795303302409` — same job |

### Case: the REST shard that named no test

The expectation was "a failing REST shard names the test that failed". The shard failed no test, so
there is no name to print. The same workstream's follow-up report 99 seconds later
(`report-permissions-1862-1795303401889`) shows `Run REST tests` running 15m13s and being killed by
the workflow's `timeout-minutes: 15`, while the same 58 files pass locally in 44s (671 passing, 1
pending) under the workflow's own shard formula; `docs/factory-receipt.md` had already measured the
same kill in the reconcile pass. The teardown line the report quotes — `Terminate orphan process: npm
exec mocha` — is the runner stopping the process group of the step it killed. It is the signature of a
timeout, not of an assertion failure.

Nothing in this repo can add a name to a log that has none, and the fix is a change to a workflow this
workstream may not edit. So the verdict is `owner-repo`, with the cause named so the owner does not
repeat the same log read. This pass did not run `gh` against `shakti-perms`: the evidence was already
on this machine, and a read is still a visit to another workstream.

**What would change it:** a run where mocha printed a summary and the reader lost it (that would be a
`factory-defect` in whatever read it); a run that failed an assertion without printing the name (the
workflow's reporter configuration); or a second repo reporting the same shape, which makes "how a red
check reports itself" a shared rule rather than one CI's problem.

### Case: the same shard, measured

`report-permissions-1862-1795303401889` comes at the same job through a second command and adds the
measurement the first one lacked: `Run REST tests` 04:08:22–04:23:35 (15m13s) against
`timeout-minutes: 15`, and the same 58 files green locally in 44s (671 passing, 1 pending) under the
workflow's own awk shard formula. Verdict: `duplicate` of the row above — one job, one defect.

The report names two candidates and leaves them equal. Its own measurement does not leave them equal:

- **A leaked Effect runtime or fiber from the policy plugin keeps mocha alive.** The local run is the
  same code, and it printed a summary and returned in 44s. A leak that is unconditional in the code
  under test would have kept the local process alive at exit too. So the candidate survives only in
  an environment-conditional form — a subscriber that starts where CI supplies a host, a flag or a
  key — and the line that would settle it is in the suite's setup, not in a CI log. The assumption
  to break before quoting this: that the local command exited on its own. If the workflow or a local
  wrapper hands mocha `--exit`, the 44s says nothing about leaks and this paragraph is wrong.
- **CI slowness in specific suites.** 15m13s against 44s is 20×, and the kill lands on the step's
  bound rather than on a test, so "one suite blocks or crawls in CI" needs no help from the runner to
  be true.

What neither candidate can recover is which one it was, because the kill took the tail of the log:
"no mocha summary" is consistent with _the suite had not finished_ and with _the epilogue sat in a
buffer that never flushed_. The evidence that separates them is per-test lines printed as the run
goes, and that is a reporter choice in the owner's workflow: `spec` names a suite as it enters it,
and a per-test `--timeout` makes a blocked test fail by name inside the step's own bound instead of
ending the step with nothing. The factory has no line in this failure — nothing here read the log
wrong, and `docs/factory-plan.md` §Phase 4 makes the fix the workflow's.

**What would change it:** a run whose log names the last test that started (the owner then has a test
and this closes as a diagnosis); an `--exit` found in the workflow or a local wrapper (candidate one
goes live again and the note reverses); or a second repo reporting the same "the red check says
nothing" shape.

## 4. What a verdict is not

- **not a desk item.** A report is a tooling complaint; only `gate-defect` and a real choice produce a
  question a human must answer. `blocked: false` on this report means the reporter is proceeding.
- **not a licence to edit another workstream.** Their CI, their branch, their ticket. A mail is the
  cross-workstream verb.
- **not a broadcast.** Intercom is a doorbell to a live session; when the owner has no session, the
  report file plus this row is the durable route, and the next pass reads it.

## 5. Filing a verdict

1. Read the report's own lines first; do not re-run the command to learn what it said.
2. Choose the verdict from §1 and write the evidence, not the conclusion.
3. For `factory-defect`, the pass carries a fixture test and the before/after counts.
4. For `gate-defect`, raise the desk item before touching the path.
5. A repeat — by fingerprint, or by subject through another command — is a `duplicate` row, not
   a second investigation.
