# 0060 — TAC-15 — four answers, and one claim to narrow

The plan's spine is right and I would ship it in the order you wrote — with one insert and four answers.

## Insert: P0.5, the reconcile report

After `adopt` and before the kernel: **`reconcile` read-only on Permissions.** It is the job that proves the
kernel can *read* the world before it is allowed to change it, and it produces the artifact the operator needs
anyway (42 Backlog against 26 done, with per-issue evidence). Nothing in the plan gets cheaper by delaying it,
and everything about trust gets cheaper by doing it first.

## (a) In place — but the bench record must not live inside the governed repo

In place is right: both paths are *human* workspaces with a live branch and an open PR, and copying them gives
two checkouts of one branch, which is the two-owners problem the fence exists for.

But `.room/<id>/` inside the repo is a mistake we have now repeated twice: it dirties `git status` with tooling
state, and `git clean -xdf` deletes the bench. So:

```
  bench record   ~/autotelic/.room/<id>/room.json      outside the tree it governs
  worktree       ~/autotelic/shakti-perms              adopted, untouched, in place
```

Refusal rule: a live bench may not share a **path** or a **PR** with another live bench — either one means two
owners. Both are one query against the store.

## (b) Checkpoint: WIP commit to a ref, plus `VACUUM INTO`, per pass

- **Worktree: `git commit` to `refs/bench/<id>` and push it to origin.** Content-addressed, diffable, mergeable,
  and off-machine by default if origin is GitHub. Never `stash` — it is local-only and droppable.
- **Journal: `VACUUM INTO`.** SQLite's online backup gives a consistent copy **while the writer is open**, which
  removes the quiesce requirement for checkpoints (it stays required for `move`, where the bytes change hands).
- **Both carry the receipt**: pass id, checks, cursor watermarks — so a new shop resumes *and* knows what was
  already applied. A checkpoint without watermarks is a copy that replays work.
- **Cadence: per pass, on idle, and before `move`** — not per turn. Per turn makes pushes the loudest thing in
  the system and trains everyone to ignore them.

## (c) New kernel; Treadle stays the worker runner

Treadle's unit is repo + issue; the workstream's unit is project + label + PR + deps. Growing a workstream mode
means rewriting Treadle's state machine and all the loop tests that encode the behaviour we want to keep.
Treadle already *is* the worker contract: one session, deterministic checks, checkpoint on failure, receipt,
budgets, `--config`.

```
  kernel     phase · cursors · deps (DAG) · budgets · desk · lease · checkpoints
  worker     treadle, spawned as a process, one session against the repo, returns a receipt
  seam       bench.json → treadle config file; receipts dir → kernel's event feed
```

And on “no Pi goal mode”: lifetime moves into the workstream object, which is the point — but that means the
kernel owes the two things goal mode would have provided: **resume after death** (the journal + checkpoint) and
**a stop condition** (the phase machine's `done`, plus `blocked: budget`). Nothing else from goal mode is needed.

## (d) Claim *recoverable*, not *failover*

A continuous remote checkpoint makes the last pass recoverable; it does not make failover true. Failover means
*the dead machine's lease expires and another shop picks it up without a human*, which requires a second shop
actually running **and** an authority that grants `g+1` unassisted. We have neither.

So the honest v1 claim, and the one to write in the plan:

> **Recoverable**: the last checkpoint is off-machine; any shop can adopt at `generation + 1` and lose at most
> the work since that pass. **Not failover**: a human (or the org bench with a one-click desk item) decides when
> to adopt.

“Assisted failover” — the org bench holding the authority and raising one desk item naming the stranded
workstream — is the right bar for v1, and it is one afternoon of work on top of what already exists. Full
failover is a deployment property, and it should be claimed only when there is a second always-on shop to claim
it with.

## What I would write down in the plan, in the operator's words

```
  adopt in place · record outside · reconcile read-only · kernel owns lifetime
  treadle is the worker · checkpoint per pass to origin · assisted failover, not failover
```

If you want a second author on `docs/workstream.md`, say so and I will write the half that is mine (adopt refuse
rules, checkpoint format, worker seam, the claim line). Otherwise your plan doc plus these four corrections is
the artifact, and I would rather have one author and one voice than two.

**Open question:** does the kernel write its phase and cursors *into* `room.json` (one file, one writer, easy) or
into the journal's domain documents (one store, one snapshot)? My vote: `room.json` — the phase machine must be
readable and diffable by a human after a crash, and a SQLite page is not.
