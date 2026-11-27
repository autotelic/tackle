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
| `fixed`          | nothing — the tool already changed                 | cite the commit and verify on the artefact you have; do not re-fix it                     |

## 2. Four rules that decide most reports

**A red check is not a failing test.** A step killed at its bound exits with no test summary because
no test failed. The factory's own runner already draws that line and pins it: `StepResult.timedOut`,
`infrastructureFailure.kind: "step-timeout"`, and a failure set that skips a timed-out step
(`packages/treadle/src/checks.ts`, `packages/treadle/src/report.ts`, each with the test that fails if
the guard is removed). So "the log has no test name" is read as _the red step does not say what
happened_, not as _the runner lost the name_. That distinction is what decides whether a report
describes a defect in the factory or in the workflow that ran the step.

**An empty read is not an empty log.** `gh api …/actions/jobs/<id>/logs` exits 1 and writes **no**
stdout when the body contains terminal escape sequences; the refusal goes to stderr, so a reader that
measures a body sees `0 bytes` on a 171,705-byte archive (`report-enterprise-1854-1795303934346`). A
missing body is not a conclusion — the exit code and the error channel are, and the bytes are usually one
flag away: `--allow-escape-sequences`, or `gh run view --log --job <id>`, which sanitizes escapes and
bounds a 13MB run stream to one job. Same shape as the truncation notice in §3: bytes the reader dropped,
taken for content or for absence.

**A report is about the factory the reporter ran, not about the world it observed.** `gh`, a job log
and a Linear page are the reporter's tools; when the bytes are thin because CI killed the process,
the fix belongs where the process runs. Triage asks which config produced the line; a line produced
by a workflow's own `timeout-minutes` is that workflow's to fix.

**A report can arrive before the build it is about.** `bin/factory.js` runs `dist/`, which is
gitignored and rebuilt by `pnpm build`; a line that landed in source seconds ago is invisible to
anyone holding the previous build. Compare the report's timestamp with `git log` before reading a
missing command as missing code — the fix may already be in the tree. That is not a dismissal: the
reporter read the artefact it had, and the artefact was wrong for it.

## 3. The ledger

| id                                      | fingerprint                                                                                                                                                | kind        | verdict       | route                                                                                                                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report-permissions-1862-1795303302409` | `conformance:gh run view --job 136075695353 --log:bf49d72626a9`                                                                                            | conformance | `owner-repo`  | permissions-1862: its `test-rest` shard; count 2 — repeat delivered to `tackle-underused-primitive` on 2026-11-26, same fingerprint, not re-triaged                        |
| `report-permissions-1862-1795303401889` | `conformance:gh api .../actions/jobs/136075695353; cd services/rest; npx mocha <shard 2 files>:7712854710d8`                                               | conformance | `duplicate`   | cited: `report-permissions-1862-1795303302409` — same job; count 2 — backfilled to `tackle-underused-primitive` with the inbox on 2026-11-26                               |
| `report-permissions-1862-1795303503690` | `ergonomics:read a long file (docs/permissions-overhaul-tree/05-audit.md) through the agent's read tool, then paste the result into a commit:93a81a7d8cb3` | ergonomics  | `owner-repo`  | permissions-1862: restore §16 from `580049816`, delete both notices; count 2 — backfilled to `tackle-underused-primitive` with the inbox on 2026-11-26                     |
| `report-permissions-1862-1795303853012` | `ergonomics:node packages/factory/bin/factory.js --help:5997bc3147b1`                                                                                      | ergonomics  | `fixed`       | fixed in `559d8bcc`; the reported bytes predate `0173a342`; count 2 — repeat delivered to `tackle-underused-primitive` on 2026-11-26, same fingerprint, not re-triaged     |
| `report-enterprise-1854-1795303934346`  | `ergonomics:gh api …/jobs/137021854184/logs; gh run view 44961528061 --log:9827a001f031`                                                                   | ergonomics  | `owner-repo`  | enterprise-1854: its `test-rest (3)` shard — re-read with `--allow-escape-sequences`; count 2 — backfilled to `tackle-underused-primitive` with the inbox on 2026-11-26    |
| `report-tackle-factory-1795311764988`   | `ergonomics:factory-view Open (herdr t18):54dd1b16c105`                                                                                                    | ergonomics  | `fixed`       | fixed in `3018aa4f`; the posted address is now checked against discovery, not a charset; count 2 — backfilled to `tackle-underused-primitive` with the inbox on 2026-11-26 |
| `report-tackle-view-1795312137685`      | `blocker:factory status:72d1a1d64468`                                                                                                                      | blocker     | `fixed`       | fixed in `d04af66f`; the gate serves its counts and names each absent state — `newestAccepted: null` because the ledger records no timestamps                              |
| `report-tackle-factory-1795326730977`   | `quality:factory daemon start --worker /tmp/factory-pi-worker.sh --interval 120000:0f06d08b9c68`                                                           | quality     | `gate-defect` | half fixed in `3a465cb1`; see `desk-tackle-factory-1795326754866` for the rest                                                                                             |
| `report-tackle-factory-1795326738246`   | `ergonomics:factory watch --id tackle-factory (base:commit events):d35ba8ec354f`                                                                           | ergonomics  | `gate-defect` | `desk-tackle-factory-base-events`: author and paths are one `git log` away                                                                                                 |
| `report-tackle-factory-1795326769939`   | `conformance:factory run --id tackle-factory --worker <worker> (change set):6d4bc28c96c0`                                                                  | conformance | `fixed`       | fixed in `3a465cb1`; the diff base is the pass's own `rev-parse HEAD`                                                                                                      |
| `report-permissions-1862-1795367455336` | `conformance:node -e "require('./packages/domain/dist/permissions/conditions.js')" and grep -rn shared_with_my_company:52d5f75b7746`                       | conformance | `owner-repo`  | permissions-1862: its `packages/domain` conditions catalogue — one declared key, no body; queued behind `desk-r1862a`                                                      |
| `report-permissions-1862-1795381355167` | `ergonomics:read this session's 69 user messages and categorise the ones a guardrail should have caught:243cf011696f`                                      | ergonomics  | `gate-defect` | `desk-tackle-factory-branch-guard`: one `symbolic-ref` call from `runPass`; four mechanisms already ship, one shipped in this pass, the rest classified below              |

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

**The repeat.** Both files on this subject — this report and its duplicate
(`report-permissions-1862-1795303401889`) — reached `tackle-underused-primitive` on 2026-11-26, five
days after this verdict, in two consecutive passes. That is the inbox, not a second defect. The
reports source is wired for every trunk workstream (`recordOf` in
`packages/board/src/factory/store.ts`) and `reportEvents` in `packages/board/src/factory/watch.ts`
reads every `.json` in the shared directory without comparing `report.at` to `cursors.reports`, the
watermark `recordOf` already sets at adoption. A new trunk workstream therefore backfills the whole
inbox; because the reader skips reports addressed to its own workstream, it receives exactly the
ones it does not own — which is why the backfill arrives as two files that the ledger had already
closed, and why a fingerprint count alone cannot say how many were replayed. Closing that backfill
is the `cursors.reports` watermark named as unbuilt in `docs/faucets-sinks.md` §1, and the path is
protected (`packages/board/src/factory/**`).

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

### Case: the audit that pasted its own truncation notice

`report-permissions-1862-1795303503690` asks for two different things at once: that a truncation
notice never be taken for content, and that the tool mark it as metadata. The bytes are Pi's. The
notice in the document — `[Showing lines 1-346 of 361 (50.0KB limit). Use offset=347 to continue.]`
— is formatted by
`node_modules/@earendil-works/pi-coding-agent/dist/core/tools/read.js`, against a 50KB
`DEFAULT_MAX_BYTES`. A grep for `Showing lines` across this repo's `packages/*/src` finds nothing:
no tool here reads a file on an agent's behalf, and a factory worker is a Pi session
(`docs/worker-invocation.md` §1), so the notice was never ours to shape. "Clearly marked as tool
metadata" is a change to the harness.

Verdict `owner-repo`. The damaged artefact is the workstream's own evidence document, and the pass
that pasted into it was its own; this repo read nothing wrongly and edits neither the document nor
its commit. The repair needs no investigation, because the reconcile pass had already measured it —
`docs/factory-receipt.md` records "two pasted truncation notices; section 16 is recoverable from
`580049816`, sections 17–20 never existed" — and the report names the same mechanical repair:
restore §16 from `580049816`, delete both notices. No mail was sent: the reporter is the owner, so a
second copy of its own sentence is not a route, and `blocked: false` says it is proceeding.

Not `not-a-defect`: the damage is real and sits in a governed document. Only its emitter is outside
every tree.

The one surface tackle owns is the prompt the kernel writes (`promptOf` in
`packages/factory/src/kernel.ts`). A line there — a read of a long file ends in a notice, and the
notice is not content — would blunt the class in every pass. `packages/factory/**` is a protected
path in this workstream's record, so that is a gate decision rather than a trunk edit; the hazard is
written into `docs/worker-invocation.md` §4 so the line is there when the prompt is next opened.

**The repeat.** The same fingerprint reached `tackle-underused-primitive` on 2026-11-26, five days
after this verdict and in the same backfill as the REST-shard pair: `reportEvents` reads every file
in the shared reports directory and skips only reports addressed to its own workstream, so a newly
adopted trunk workstream receives exactly the reports it does not own. Nothing was re-triaged; the
row takes the count, and the repair named above is still the owner's.

**What would change it:** a second repo pasting the same notice (a shared hazard, which makes the
prompt line the fix and the gate the place to decide it); a Pi release that machine-marks the
truncation (this row closes as shipped upstream); or an owner regenerating the document from
`580049816` instead of patching §16, which needs no ledger change.

### Case: the help that hid its own phase command

`report-permissions-1862-1795303853012` is accurate about the binary it ran and stale about the tree.
`factory phase` and its usage line landed in `0173a342` at 16:30:21; the report was filed at
16:30:53 against a `--help` that matches the _pre-`0173a342`_ list exactly — `adopt`, `status`,
`event`, `run`, `watch`, `report`. So the reporter read a `dist/` built before the line existed;
`bin/factory.js` runs `dist/` and `dist/` is gitignored, so source seconds old is invisible until the
next build. Eight minutes later `559d8bcc` did the second thing the report asked for and wrote the
reason into the code: leaving `reconcile` or `blocked` needs an answer record, "(a probe did exactly
that)".

At HEAD both asks hold. Verified in a throwaway `FACTORY_HOME` against a copy of a record, so the
probe could not advance a live workstream:

- `--help` lists all ten commands, `phase` among them with `[--answer <desk-answer.json>]`;
- `phase --id tmp-probe --set build` on a `reconcile` record exits 1 with
  `desk gate: reconcile -> build needs --answer <desk-answer.json>` and leaves the phase at
  `reconcile`;
- the same command with `{"choice":"accept"}` advances it to `build`.

Hence `fixed`, not `factory-defect`: re-cutting a fix that is already an ancestor of HEAD would be a
second edit of a protected path for no gain. Two things were still true when this row was written, and at
`466155c7` one of them has shrunk:

- the usage list is hand-maintained and nothing compares it to the dispatcher. Every top-level command
  and subcommand the dispatcher handles is in it at HEAD; what it cannot promise is the next one, so a
  fixture test is the guard — and the guard is a gate decision;
- the `adopt` line omitted `--delivery`, `--reports` and `--linear-project-id`. `884cc3f6` documented
  the first two for trunk delivery; `--linear-project-id` is still accepted (`cli.ts` line 449) and
  still absent from `--help`, so adopting with a Linear project id cannot be read off help at all.

Both live in `packages/factory/**`, protected for this workstream, so the backlog pass raised
`desk-tackle-factory-usage` instead of editing: accepting it grants the usage line and the dispatcher
test. See "the backlog, verified at HEAD" below.

**The repeat.** The same fingerprint reached `tackle-underused-primitive` on 2026-11-26, five days
after this verdict and in the same backfill as the three reports above: `reportEvents` reads every
file in the shared reports directory and skips only reports addressed to its own workstream, so a
newly adopted trunk workstream receives exactly the reports it does not own. Nothing was re-triaged;
the row takes the count, and the usage line and dispatcher test remain a gate decision.

**What would change it:** a `--help` that omits a command _after_ a clean `pnpm build` (the source
drifted, and the row reopens as `factory-defect`); or a decision to lift the gate for the usage test.

### Case: the job log that was never empty

`report-enterprise-1854-1795303934346` says the failed `test-rest` shard's log body is empty: `0 bytes`,
the run log carrying only that job's teardown lines, and nothing but `Process completed with exit code 3`
in the annotation. The reading is wrong about the log and right about the reader. The archive was
171,705 bytes, and had been since `23:27:40Z` — 94 seconds after the step ended, 4m34s before the report:

```
$ gh api repos/…/actions/jobs/137021854184/logs -i
HTTP/1.1 200 OK
Content-Length: 171705
Content-Type: text/plain
Last-Modified: Sat, 21 Nov 2026 23:27:40 GMT

the response contains terminal escape sequences; pass --allow-escape-sequences to output it anyway
```

`gh` 2.102 refuses to render a response body carrying terminal escapes: exit 1, the refusal on stderr,
**nothing on stdout**. A read that measures stdout — or a pipeline that let stderr go — has 0 bytes of a
171,705-byte log. The same command with `--allow-escape-sequences` returns all of it, and it names what
the report could not: `607 passing (39s)`, `3 failing`, and the three assertions in full.

The escapes are the workflow's own: 871 log lines carry ANSI codes (1764 `ESC[0m`, 630 `ESC[32m`, 80
`ESC[31m`), the first at line 346 in a composite action's colored command echo. The job is attempt 1 of
run attempt 1, so no re-run had discarded anything, and `Run REST tests` ran `23:26:57–23:27:37` (40s): a
real assertion failure, not the permissions shard's timeout kill.

Verdict `owner-repo`, and not `not-a-defect`, because the expectation holds. The three failures are the
enterprise workstream's own subject: `POST /api/inventory`, `GET /api/inventory/:id` and
`GET /api/inventory-options` return `''`, `false` and `+0` where the expectation has `null` (`age`,
`box_size`, `lift_status`, `nursery_key`, `plug_size`, `stock_type`, `trees_per_bundle`, `short_code`) —
the inventory nullable-key drift that workstream is mid-way through. Nothing here reads a GitHub job log
(`packages/*/src` has no `actions/jobs`), so the read was a Pi session's `gh`; the repair is a flag and
three assertions, and no CI config is implicated.

The second read carries the same lesson: `gh run view 44961528061 --log` without `--job` is 13,158,153
bytes across 61,629 lines for this run's 26 jobs, and the failed shard's summary sits at line 58,532 — a
read bounded by bytes ends in teardown. `--job 137021854184` is 245,386 bytes and starts at the step's
first line. What cannot be recovered is which bound the reporter used; the whole-run read reproduces as a
13MB stream, and the report does not say how it was cut. Bound by job before bounding by bytes.

The permissions case predicted that a second repo reporting "the red check says nothing" would make the
shape a shared rule. It happened, and the rule it bought is about the reader rather than the check: the
two repos lost their evidence in different places — a timeout with no summary in one, a summary behind an
escape guard in the other — so §2 gains the rule and no workflow rule follows from the pair.

**The repeat.** The same fingerprint reached `tackle-underused-primitive` on 2026-11-26, five days
after this verdict and in the same backfill as the four reports above: `reportEvents` reads every
file in the shared reports directory and skips only reports addressed to its own workstream, so a
newly adopted trunk workstream receives exactly the reports it does not own. Nothing was re-triaged;
the row takes the count, and the flag the case names is still the whole repair.

**What would change it:** an archive that is genuinely empty (`Content-Length: 0`) while the annotation
names a failing step — then the runner lost the bytes and the rule becomes the workflow's; a tackle tool
that reads job logs and swallows the refusal (the defect is here); or an enterprise CI change that stops
emitting color, which reads the body plainly and closes this row as a config fix.

### The backlog, verified at HEAD

`report-backlog-1795306551000` fired at `00:15:51Z`, one second after the intake drained five report
files into five `report` events, and the five then landed as five passes — `5a9edbd8` at `00:22:03Z`
through `4d831808` at `00:40:46Z` — each with its verdict, its fix and its receipt. So this pass did not
re-triage the five; it verified every verdict at `466155c7` rather than re-cutting a fix, and corrected
the one line the tree had moved under. Evidence, in the order the runs produced it:

- `--help` lists every command the dispatcher handles, `phase` among them with
  `[--answer <desk-answer.json>]`; the one option it does not print is `--linear-project-id`, which the
  `adopt` path accepts. That is the live drift, and the reason for `desk-tackle-factory-usage`;
- in a throwaway `FACTORY_HOME` against a copy of a record, `phase --id probe --set build` on a
  `reconcile` record exits 1 with `desk gate: reconcile -> build needs --answer` and leaves the phase
  at `reconcile`; the same command with `{"choice":"accept"}` advances it to `build`. A probe cannot
  advance a held workstream;
- `docs/worker-invocation.md` §4 carries the truncation hazard and §2 above carries the
  escape-sequence rule, so the two `owner-repo` rows point the next reader at the line that matters;
- the REST-shard row stays `owner-repo` with no mail: the timeout is the workflow's own
  `timeout-minutes`, and `docs/factory-receipt.md` had already measured the same kill.

The two reports that arrived after the event are in the table, and only one of them is this pass's:

- `report-tackle-factory-1795311764988` is `fixed` in `3018aa4f` — the board writes a `.command` file
  and opens it, 5s bound, no AppleEvent — but the fix left the posted address checked by a charset
  alone, so `POST /open {"address":"--help"}` reached `hc attach --help`. An allowlisted command taking
  a request parameter is the argv hazard `VISION.md` refuses, so this pass finished the fix:
  `servesAddress` decides from the same discovery `/presence` serves, so an address the shop does not
  serve is a 400 rather than an `hc` argument, and a target that vanished between the snapshot and the
  click is refused instead of attaching to a recycled id. Verified against a throwaway `board up`:
  `--help` is charset-legal and no terminal has it, so the address check refuses it; an unknown source
  and a shell-shaped address are refused at the schema; and `~/.factory/open` gains no file;
- `report-tackle-view-1795312137685` is `factory-defect` and not this pass's work: it is pending in
  this stream as `report:report-tackle-view-1795312137685`, so the pass that takes it starts there.
  `packages/board` owns the document it reads and is not protected, so the counts are servable — the
  baseline identity count from each record's `.jig-baseline.json` (read through
  `@autotelic/protocol`'s `decodeBaseline`, the seam that owns that format) and the error and warning
  counts from the newest receipt's `quality`, which `activityOf` already loads. What is not servable
  from a file is the newest accepted identity: the baseline is an unordered set of 48 identities with
  no timestamps, so that half of the ask is a decision about the format, not a field to copy.

**The repeat.** `report-tackle-factory-1795311764988` reached `tackle-underused-primitive` on
2026-11-26, five days after this verdict and in the same backfill as the five reports above:
`reportEvents` reads every file in the shared reports directory and skips only reports addressed to
its own workstream, so a newly adopted trunk workstream receives exactly the reports it does not own.
Nothing was re-triaged; the row takes the count, and the `servesAddress` check recorded above is
still the whole repair.

The three reports that arrived after that event came from passes 6 and 7 of this workstream, at
`05:52Z`, and all three are about the factory itself. A pass writes a report for the defect it may
not fix — the workstream's protected path is `packages/factory/**` — so none of the three was edited
by the pass that found it. `3a465cb1` (11:06:44Z) closed one and half of another; the rest is behind
the gate.

### Case: two passes on one worktree, and the head they were diffed from

The receipts are the evidence, not the report. Pass 7's `0007` carries a checkpoint, a journal and
`status: failed` with `exit: 0` — the shape `runPass` writes when a protected path was touched, in
this case `466155c7`'s `packages/factory/src/watch.ts`, which pass 7 never edited. Pass 6's `0006`
was left `running` by a daemon that no longer existed two minutes later and now carries neither
checkpoint nor journal: the branch `runPass` writes when the checkpoint cannot be captured, before
the pass is done with its work. Neither receipt consumed its events, and the record's `head` never
advanced — which is what armed the stale-head defect below.

**The change set: fixed in `3a465cb1`.** `report-tackle-factory-1795326769939` is right about cause
and consequence. `runPass` diffed `record.head..HEAD`, and `record.head` advances only when a pass
finalizes, so a pass inherited every trunk commit landed since the last finalize — here
`466155c7`'s edit of the protected `packages/factory/src/watch.ts`. At `3280f1db` a pass was judged
on work it did not do. `3a465cb1` reads `git rev-parse HEAD` before the worker starts
(`packages/factory/src/kernel.ts:225`), diffs `startHead..currentHead`, and falls back to
`record.head` only when HEAD cannot be read. `dist/kernel.js` was rebuilt at `11:06:32Z`, twelve
seconds before the commit and twenty-four before the daemon started, so the daemon serving this pass
is not carrying the old line.

What the commit does not carry is a fixture test: the pass that lands a rule owes the test that fails
without it, and the test (a record whose head sits behind trunk, whose own diff is clean, which must
finalize rather than block) lives in `packages/factory/test` — a gate ask, written into the desk item
rather than taken.

**The concurrency: half fixed, in the same commit.** The report asks for two refusals and a reap.
`3a465cb1` added the first: `runningPass` (`kernel.ts:123`) scans the receipts newest-first and
refuses this pass with `PassRunning: pass N` when a `running` receipt's `pid` is alive
(`kernel.ts:112`). The rest is in the protected package:

- `lease` is a schema field with a default and nothing else. `store.ts:31` declares it,
  `store.ts:217` writes `{holder: hostname, generation: 1}`, and a grep of every package's `src`
  finds no reader and no writer: the record a pass could fence itself with is decorative;
- a `running` receipt whose `pid` is gone is skipped, not rewritten — the guard lets the next pass
  start and leaves the corpse `running`, so `passesUsed`, which counts receipt files, charges a pass
  that will never finalize. This workstream holds 8 receipt files against `passesPerPhase` 10;
- the view says `Working now` for it, because the renderer reads `pass?.status === "running"`
  (`packages/factory-view/src/main.ts:317`) and `activityOf` takes the last receipt with no
  liveness check (`packages/factory/src/activity.ts:111`).

`desk-tackle-factory-1795326754866`, raised `05:52:34Z`, already asks a human for a supervised branch
carrying the guard, the lease and the reap, so this pass added nothing to it.

**The base event: still true, and the cheapest of the three to close.**
`report-tackle-factory-1795326738246` asks that a `base:commit` event carry enough to decide whether
a pass is owed: who committed, what paths moved, and whether any is protected. Two such events are
pending in this stream, and this is one payload entire:

```json
{
  "id": "base:commit:466155c7…",
  "payload": {
    "sha": "466155c7…",
    "subject": "factory: a pending event wakes when the budget opens"
  },
  "headSha": "466155c7…",
  "actor": "base",
  "status": "pending"
}
```

`baseEvents` already runs `git log -1 --format=%H%x00%cI%x00%s` for those three fields
(`packages/factory/src/watch.ts:119`), so an author and a changed-path list are the same call and
the same parse. Without them the only way to learn that `466155c7` edited
`packages/factory/src/watch.ts` is to re-run git inside the pass — which it may not act on anyway.
`desk-tackle-factory-base-events` asks for the payload and for the kernel test above.

**Why one event woke two passes.** `report-backlog-1795306551000` fired at `00:15:51Z` and was
still `pending` at this pass: a pass that fails consumes nothing, and the receipt it leaves records
the event ids it took without recording that they were returned. Pass 7 triaged under that event and
failed on the gate; pass 8 was woken by the same one. That is the same defect seen from the queue
side, and it lives in the same protected `runPass`.

**What would change it:** `desk-tackle-factory-1795326754866` answered `approve-fix` (the guard, the
lease and the reap become a branch with a human merge); a `base:commit` payload carrying author and
paths, which closes the ergonomics row as `fixed` on the commit that ships it; or two passes running
at once after `3a465cb1`, which would say the guard is not the fix and reopen the row.

### Case: the repo gate nobody served

`report-tackle-view-1795312137685` asked `/presence` for a gate on every workstream: baseline
identity count, error and warning counts, newest accepted identity. `factory.workstreams[].repo` was
served, so the view had a repo to hang the panel on and no gate to render.

Two of the three were already facts about files the shop reads. `baseline.identities` is the committed
ledger named by `gate.baseline` in `jig.config.json`, decoded through `@autotelic/protocol` — the
package owns the format, so the board reads the same bytes `jig` writes instead of re-spelling the
reader. `quality` is the newest receipt's `after` counts, the same record `activityOf` loads for
the activity panel. The third is not a field: the ledger is an unordered set of identities with no
timestamps, so "newest accepted" from it would be a file mtime — a claim about the file, not about
acceptance. It is served as `newestAccepted: null` with its reason in `note`, so a renderer says
"not recorded", and a format that timestamps an acceptance later changes one field, not the document.

Absence is named rather than zeroed, for the reason a quiet census is not a clean one:
`baseline.state` is `present | absent | unreadable` and `identities` is null unless the ledger
decoded, and `quality.state` is `measured | unmeasured` — a running pass has not measured the gate.
The fixture tests in `packages/board/test/gate.test.ts` and `packages/board/test/cli.test.ts` cover
each state. Read live through `board presence --json`: `tackle-factory` carries 48 baseline
identities and pass 9 `unmeasured` because it was still running; `permissions-1862` carries 15
errors and 5 warnings from pass 1.

Before: `pnpm jig check` 0 errors, 0 warnings (pass 8's receipt). After: 0 and 0.

### Case: a base:commit event, read by hand

`base:commit:3280f1db` is the first of this stream's two pending base events, and its whole payload is a sha and
a subject — the shape `report-tackle-factory-1795326738246` is about. So the pass paid the cost the report names,
once, and wrote it down: `git show --stat` says the commit is six files by `Ted Ogmundson`, two of them inside
`packages/factory/**`, this workstream's protected path. The author is a human session outside any pass, so
nothing was owed to it and nothing was refused. The event closes as **nothing owed** rather than as a verdict on a
report: the commit is an ancestor of HEAD, and both halves of its claim hold there.

- **Activity carries the budget and the phase.** `activityOf` against the live record:
  `{"budget":{"used":10,"passesPerPhase":10},"phase":"build"}`. The cap is not hypothetical — this pass is the
  tenth of ten.
- **The served card names the cap.** `packages/factory-view/dist/assets/index-*.js` (built `04:23`, after its
  source's `22:42`) carries `Paused: pass budget reached` and the `factory budget` line beside it, so the
  document the board serves shows a capped queue as capped instead of idle.
- **The remedy the card prints works.** In a throwaway `FACTORY_HOME` holding a copy of the record and its ten
  receipts: `factory run --id tackle-factory --worker /bin/true` → `factory: budget: passesPerPhase 10`, exit 1;
  `factory budget --id tackle-factory --passes-per-phase 15` → `passes per phase -> 15`; `run` again →
  `factory: PassRunning: pass 10` — that is the guard `3a465cb1` added, not the budget; activity then reads
  `{"used":10,"passesPerPhase":15}`. The live budget was not touched.

Two document shapes answer "a capped workstream must not look idle", and only one of them is built.
`docs/workstream.md` §7 specifies a status document whose cap is a `capStop` state (`"passes"` beside
`used 5 of 5`), with `blockedBy`, three-valued `freshness` and `checkpoint.ageSeconds`. No code emits any of
those four fields — a grep of `packages/*/src` finds none — and `factory status --json` prints the raw records.
What the shop serves instead is `activity.budget` with `{used, passesPerPhase}` and `phase`, which is what the
view reads. The spec's own fixtures, `packages/factory/test/fixtures/status/{fresh,stale,unobserved}.json`, are
read by nothing, though the fixtures README says each is read "by a test that asserts on structure" and each file
carries an `assertions[]` list. That is a rule that never looked: three files claiming coverage of a document that
has no producer. They sit in the protected `packages/factory/**`, so the pass raised
`desk-tackle-factory-status` instead of deleting them or building §7.

What this pass leaves for a human: at 10/10 the queue is capped, so this was the phase's last pass. One event is
still pending (`base:commit:466155c7…`) and four desk items are open — three that predate this pass, plus the
status item it raised. Nothing wakes until the budget is raised; the desk items are what a human reads while
deciding whether to.

What would change it: a `factory status` that emits §7, which closes this section as built and turns the three
fixtures into its tests; §7 shrunk to the activity document the shop serves, in which case the fixtures go and the
spec stops describing a document nobody writes; or a `base:commit` payload carrying author and paths, which makes
the first paragraph here one field.

### Case: the condition the catalogue offers and the compiler refuses

`report-permissions-1862-1795367455336` is a report about a workstream's own domain model, and the first thing
triage owes it is the check that the thing it names is not here. The command runs
`require('./packages/domain/dist/permissions/conditions.js')` — `packages/domain` is not a package in this
workspace (tackle has `mailbox-domain`, a different tree), and a grep of every package's sources for
`CONDITION_KEYS` or `shared_with_my_company` finds nothing. Neither `jig` nor `joggle` claims to judge a
catalogue's completeness: `jig` runs a repo's declared checks, and `joggle` judges duplication and naming. The
expectation the report holds the code to — SOW leaf 3.3's fourteen conditions, each with a rule, a filter and a
parity test — is that workstream's own. So the verdict is `owner-repo`.

What it reports is a defect of shape, and the report is careful to say so: fourteen `CONDITION_KEYS` against
thirteen `CONDITION_RULES`, with `ConditionKeySchema` decoding all fourteen and `grantRule` rendering a call the
compiler refuses afterwards. Its sharpest line is the test —
`packages/domain/test/permissions/service.test.ts:42` asserts `conditionRule('shared_with_my_company')` is
`None` — because a test that pins the gap makes the gap a declared intent, and intent is the owner's to keep or
to replace. Both repairs it names (write the Polar body, or delete the key and AUT-379's "13 of 14" with it) are
edits to that workstream, and the factory has no line in either.

Its timing is the owner's queue rather than this ledger's: permissions-1862 is in `reconcile` with `desk-r1862a`
open, so its record cannot take a code change until that desk item is answered. No mail was sent — the reporter is
the owner, so a second copy of its own sentence is not a route, and `blocked: false` says the reporter is only
filing. The row for `report-permissions-1862-1795367455336` is the durable route.

**What would change it:** a `packages/domain` catalogue inside tackle (the claim becomes ours to keep); a
`jig`/`joggle` rule that says it catches a declared-but-unimplemented key (the miss is then a `factory-defect` in
that rule); or a policy that ships `shared_with_my_company` and fails only at compile time, which turns a claim
into an outage and hands the owner the fixture its body should be written against.

### Case: the 69 messages, and which engine had already said it

`report-permissions-1862-1795381355167` is not one defect; it is a session's self-audit — eight categories
and twenty proposed mechanisms, ranked by what each would have cost. Triage therefore owes it a per-mechanism
answer, and the first thing to say is the one the reporter could not see from another repository: **four of the
mechanisms already ship here**, so for those the miss is the requesting repo's rulebook, not the rule. Verified
at `1812ccd4` by reading the plugins' registrations and the kernel, not the README:

| mechanism the report asks for                      | state at `1812ccd4`                                                                                                                                                         | verdict          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| pre-push branch check against the record           | absent: `runPass` reads `HEAD`, `status` and `rev-parse`, and never asks which branch `HEAD` is on; `record.branch` is written at adopt and read only by the adopt printout | `gate-defect`    |
| raw `<form>`/`<input>`/`<button>` on a route       | absent: `plumb-ui` ships one rule, `no-deprecated-parts`                                                                                                                    | `factory-defect` |
| hand-rolled surface vocabulary on a route          | absent — and the palette rule the report assumes exists does not; no plumb rule reads a class string                                                                        | `factory-defect` |
| a card list that does not compose the catalog card | half: `joggle/page-needs-composition` asks the consumer question; the producer half is in no engine                                                                         | `factory-defect` |
| exported data interface without `Schema`           | ships: `plumb-effect/require-schema-type-derivation`                                                                                                                        | `fixed`          |
| `try`/`catch` around an Effect                     | ships: `plumb-effect/no-try-catch`                                                                                                                                          | `fixed`          |
| `Effect.runPromise` outside the seam               | was absent; shipped as `plumb-effect/no-run-promise-outside-seam` in `d79f8044`                                                                                             | `fixed`          |
| an I/O module that declares no Service and Layer   | not mechanical: a deterministic rule would fire on every CLI edge                                                                                                           | `not-a-defect`   |
| property coverage measured by branch count         | superseded: `plumb/prefer-property-tests` requires `fast-check` in every test file, which is the stronger claim                                                             | `not-a-defect`   |
| identical AST shape differing only in literals     | ships as `joggle/duplicate-implementation`; whether a literal-only difference joins is a property of `shape`, which this pass did not measure                               | `waiting`        |
| a docs budget per PR                               | absent: `jig` has no file-count engine, and `kind: "internal"` engines are host-owned and reported as skipped                                                               | `factory-defect` |
| a stale-reference check                            | absent: no engine or rule resolves a markdown link or a comment's path                                                                                                      | `factory-defect` |
| a vocabulary list of thinking metaphors            | absent; `plumb/no-generic-export-names` is the AST half, not a list                                                                                                         | `factory-defect` |
| a regex over rendered Polar                        | absent; `plumb/no-sql-string-interpolation` is the shape it would take                                                                                                      | `factory-defect` |
| report kinds that separate content from tooling    | the ledger has the verdicts, but `Report` carries no subject, though the section above reasons about one                                                                    | `gate-defect`    |
| full output read rather than grepped; CI as a gate | an agent contract, and `docs/factory-receipt.md` already says it                                                                                                            | `not-a-defect`   |

The rule this repo was actually missing is the seam one: it is one of the three Effect mechanisms the report
names, and the only one of the three with no rule behind it. `no-run-promise-outside-seam` fires on
`Effect.runPromise` and on the namespace and named-import aliases of it, exempts a file named in its `seams`
option (a path or a segment-boundary suffix), and skips test files, because a test owns its runtime. Its RuleTester cases cover the
seam option, the namespace and named-import aliases, and the test-file skip; its property suite pins the
exemption itself — every prefix of a seam path is exempt, a lookalike tail is not, and an empty seam exempts
nothing. In this
workspace the rule is on through the root config's `plumbEffectRulesByMetaType`, so `packages/room/src/cli.ts`
carries the file-scoped narrowing that says why it is the one entry point; `packages/treadle` is outside the
plumb engine's scope, so its `runPromise` is unjudged rather than exempt.

The gate mechanism is the report's first rank and this ledger's first `gate-defect` from it:
`desk-tackle-factory-branch-guard` proposes one `symbolic-ref --short HEAD` check shared by `runPass` (refuse
before the receipt is written, so no pass is charged) and a `factory guard` command that a `pre-push` hook can
call. It is the same function in both places, so the kernel and the host hook cannot disagree about which branch
the record owns. It cannot stop a hand session from editing a protected path — that is the lease's stated limit,
and the two `packages/factory` edits this pass found in the worktree are that limit, measured.

The counts for this pass are the reason to read that last sentence carefully. While pass 26 ran,
`packages/factory/src/daemon.ts` and `packages/factory/src/kernel.ts` changed in this worktree (mtimes 14:18:50
and 14:18:57 local) under another session, and were committed as `f8c81a96` mid-pass: the daemon gained
per-workstream error isolation, and the kernel gained a promise-based `runProcess`. Neither is this pass's change set, yet both land in it, because the change set is
the pass's diff from its starting `HEAD` — so a commit another session lands mid-pass is charged to the pass. The new `try`/`catch` at
`packages/factory/src/daemon.ts:77` is also the single finding in this pass's `jig check` — the committed dist
already carried `no-try-catch`, so the finding is the new code, not a rule this pass enabled. `report-tackle-factory-1795382603477`
records it: a pass judged on paths it did not touch is the same defect as a push to a branch it did not choose.

**Who did the work.** This case was written by pass 26, whose worker outlived the kernel's 30-minute
bound by nine minutes: the receipt says `failed`, `exit 124`, while the worker went on to add the rule, the
desk item and these paragraphs. The daemon, seeing a failed pass and a pending event, started pass 27 on the
same event — so pass 27 landed what pass 26 left uncommitted (`d79f8044`) instead of re-deriving it. That is
`desk-tackle-factory-1795326754866`'s lease-and-reap defect seen from the other side: a timed-out pass is
charged, its work survives it, and nothing in the record says the worker was still writing.

One artifact had to be forced past a `.gitignore`: `packages/plumb/dist` is ignored while 212 files under it
are tracked, so the rule's two new dist files were invisible to `git add` and the committed
`dist/effect/index.js` imported a module that did not ship. `git add -f` closed it here; the next plumb rule
meets the same trap until the `dist` question in MIGRATION.md item 2 is settled.

**What would change it:** the branch guard landing (the row closes as `fixed` with the commit and the two
fixtures); a requesting repo enabling `plumb-effect` and closing four rows as `fixed` by configuration; or a
`shape` key measured against a literal-only pair, which turns the one `waiting` row into evidence either way.

## 4. What a verdict is not

- **not a desk item.** A report is a tooling complaint; only `gate-defect` and a real choice produce a
  question a human must answer. `blocked: false` on this report means the reporter is proceeding.
- **not a licence to edit another workstream.** Their CI, their branch, their ticket. A mail is the
  cross-workstream verb.
- **not a broadcast.** Intercom is a doorbell to a live session; when the owner has no session, the
  report file plus this row is the durable route, and the next pass reads it.

## 5. Filing a verdict

1. Read the report's own lines first; do not re-run the command to learn what it said.
2. Choose the verdict from §1 and write the evidence, not the conclusion. For `fixed`, cite the
   commit that closed it and the artefact you verified; do not re-fix a line that is already on trunk.
3. For `factory-defect`, the pass carries a fixture test and the before/after counts.
4. For `gate-defect`, raise the desk item before touching the path.
5. A repeat — by fingerprint, or by subject through another command — is a `duplicate` row, not
   a second investigation.
