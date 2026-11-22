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

| id                                      | fingerprint                                                                                                                                                | kind        | verdict          | route                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `report-permissions-1862-1795303302409` | `conformance:gh run view --job 136075695353 --log:bf49d72626a9`                                                                                            | conformance | `owner-repo`     | permissions-1862: its `test-rest` shard                                                   |
| `report-permissions-1862-1795303401889` | `conformance:gh api .../actions/jobs/136075695353; cd services/rest; npx mocha <shard 2 files>:7712854710d8`                                               | conformance | `duplicate`      | cited: `report-permissions-1862-1795303302409` — same job                                 |
| `report-permissions-1862-1795303503690` | `ergonomics:read a long file (docs/permissions-overhaul-tree/05-audit.md) through the agent's read tool, then paste the result into a commit:93a81a7d8cb3` | ergonomics  | `owner-repo`     | permissions-1862: restore §16 from `580049816`, delete both notices                       |
| `report-permissions-1862-1795303853012` | `ergonomics:node packages/factory/bin/factory.js --help:5997bc3147b1`                                                                                      | ergonomics  | `fixed`          | fixed in `559d8bcc`; the reported bytes predate `0173a342`                                |
| `report-enterprise-1854-1795303934346`  | `ergonomics:gh api …/jobs/137021854184/logs; gh run view 44961528061 --log:9827a001f031`                                                                   | ergonomics  | `owner-repo`     | enterprise-1854: its `test-rest (3)` shard — re-read with `--allow-escape-sequences`      |
| `report-tackle-factory-1795311764988`   | `ergonomics:factory-view Open (herdr t18):54dd1b16c105`                                                                                                    | ergonomics  | `fixed`          | fixed in `3018aa4f`; the posted address is now checked against discovery, not a charset   |
| `report-tackle-view-1795312137685`      | `blocker:factory status:72d1a1d64468`                                                                                                                      | blocker     | `factory-defect` | pending in this stream as `report:report-tackle-view-1795312137685`; not this pass's work |
| `report-tackle-factory-1795326730977`   | `quality:factory daemon start --worker /tmp/factory-pi-worker.sh --interval 120000:0f06d08b9c68`                                                           | quality     | `gate-defect`    | half fixed in `3a465cb1`; see `desk-tackle-factory-1795326754866` for the rest            |
| `report-tackle-factory-1795326738246`   | `ergonomics:factory watch --id tackle-factory (base:commit events):d35ba8ec354f`                                                                           | ergonomics  | `gate-defect`    | `desk-tackle-factory-base-events`: author and paths are one `git log` away                |
| `report-tackle-factory-1795326769939`   | `conformance:factory run --id tackle-factory --worker <worker> (change set):6d4bc28c96c0`                                                                  | conformance | `fixed`          | fixed in `3a465cb1`; the diff base is the pass's own `rev-parse HEAD`                     |

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
