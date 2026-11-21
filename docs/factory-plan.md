# The factory plan: adopt work, own it for the project, move it when a machine dies

Status: draft for TAC-15 review. This is the plan the operator can turn into a goal. It is deliberately
smaller than `shop.md`: `shop.md` is the destination, this is the route to the first useful factory.

## The sentence

> Adopt the Permissions overhaul and the Enterprise Readiness work as two workstreams, run them on this
> machine, and keep a third workstream in Tackle for factory feedback. If this machine dies, another shop on
> the tailnet picks each workstream up at its last checkpoint.

No Pi goal mode. No autonomous-run budget. The workstream owns its lifetime; a worker session owns one turn.

## Principles

1. **Workstream owns life, worker owns a turn.** A worker is a Pi session that can exit. The workstream
   record, event log, phase, budgets, desk and lease survive it.
2. **Adoption is a state transition, not a copy.** Existing worktrees keep their path; the workstream
   record is written around them.
3. **Move is adoption at another shop.** The same import/rehydrate function serves both; only the transport
   differs.
4. **Checkpoint before you claim durability.** Processes and ports are ephemeral. A workstream is durable
   only to its last verified checkpoint.
5. **Humans own the SOW and the merge.** The worker may propose Linear changes and prepare a merge; it may
   not edit the SOW or merge.
6. **One live owner.** One lease per workstream; one live merge grant per `(repo, pr)`.
7. **Events are the clock.** Poll with replayable cursors first; webhooks are an accelerator over the same
   cursor.

## The object

```jsonc
{
  "id": "perms-1862",
  "project": "P-AUT-128",
  "label": "permissions-overhaul",
  "repo": "Shakti-Reforestation/forestbuilder",
  "worktree": "/Users/togmund/autotelic/shakti-perms",
  "branch": "feature/permissions-overhaul",
  "pr": 1862,
  "deps": [],
  "phase": "reconcile",
  "lease": { "holder": "macbook", "generation": 1 },
  "cursors": { "github": 0, "linear": 0 },
  "budgets": { "passesPerPhase": 5, "wallMinutesPerPass": 30, "tokensPerDay": 0 },
  "autonomy": ["comment", "label", "push", "pr-body", "rebase", "ci-fix"],
  "desk": [],
  "lastCheckpoint": { "sha": "…", "at": "…" },
}
```

Canonical records live **outside** the governed repository (for example
`~/.factory/workstreams/<id>.json`). Never `.room` inside the repo: it dirties `git status`, and
`git clean -xdf` deletes the bench. The repository holds only code and checkpoint refs.

## Phase 0 — Adopt what already exists

Both branches are already checked out in their own worktrees:

| Project                        | Path                                            | Branch                              | PR   | State            |
| ------------------------------ | ----------------------------------------------- | ----------------------------------- | ---- | ---------------- |
| P-AUT-128 Permissions overhaul | `~/autotelic/shakti-perms`                      | `feature/permissions-overhaul`      | 1862 | clean, 55aa5293a |
| P-AUT-129 Enterprise Readiness | `~/autotelic/feat/enterprise-readiness-alchemy` | `feat/enterprise-readiness-alchemy` | 1854 | clean, 6e4f4ffc8 |

Command shape:

```sh
factory adopt --path ~/autotelic/shakti-perms --project P-AUT-128 --label permissions-overhaul --pr 1862
factory adopt --path ~/autotelic/feat/enterprise-readiness-alchemy --project P-AUT-129 --label enterprise-readiness --pr 1854
```

Adoption must:

- prove the path is a git worktree and the branch is not owned by another live workstream;
- refuse if this path or this PR is already owned, and name the owner;
- record HEAD, dirty files, the PR head and the label;
- refuse if the PR head and branch disagree, or if the project already has a live workstream;
- capture uncommitted work as a checkpoint before any worker starts: a WIP commit to
  `refs/bench/<id>` pushed to origin, never a stash;
- infer the phase: `reconcile` when Linear and the branch disagree, `land` when review is the queue,
  `build` otherwise;
- never move or rewrite the worktree.

Acceptance: both workstreams appear in `factory status`; no second writer; HEAD and PR match; the worktree
is clean after adoption or the checkpoint says exactly what was dirty.

## Phase 1 — The workstream kernel (no Pi goal)

The kernel is the long-lived thing. It does not need a Pi session to stay alive. It is **new**; Treadle
stays the worker runner. The seam is Treadle's config file and receipts directory: the kernel spawns a
Treadle pass and reads the receipt; it does not fork Treadle into a second product.

```
event.log ──▶ reducer ──▶ phase/next action ──▶ worker start (ephemeral)
                                  │
                                  ├─ desk item (human)
                                  └─ checkpoint (durable)
```

Minimum phases:

```
adopted → reconcile → build → land → done
                    ↘ blocked (desk) ↗
```

Minimum events:

- GitHub: PR review submitted, review comment, issue comment, checks completed, head moved, PR merged/closed.
- Linear: project updated, issue created/updated, comment created.
- Timer: poll tick / wake deadline.
- Desk: answer recorded.
- Worker: pass completed / failed.

Rules:

- A worker pass ends in a checkpoint or a desk item, never in an unbounded session.
- A worker can exit; the kernel restarts it only on an event or a due timer.
- Budgets are per workstream and per phase: passes, wall minutes, tokens/day, rounds of changes requested.
  A cap-stop is a state, not a crash.
- No `maxAutonomousRuns`. The project's definition of done is the goal; events are the scheduler.

Reuse from Treadle: pass/checkpoint/receipt vocabulary, deterministic checks, per-pass budgets, persistent
receipts. Do not reuse its one-issue-at-a-time tracker as the workstream model; tickets are items inside a
phase, not separate PRs.

Acceptance: no worker is running while the workstream is idle; a queued review starts one pass; the worker
exits; the state says `blocked` or `idle` honestly.

## Phase 2 — Event ingress

Poller first:

- one cursor per source, stored with the workstream;
- dedupe by event id;
- on startup, replay from the cursor, then poll;
- webhook receiver later writes the same event shape and advances the same cursor.

The first useful wake: a review comment on 1854 or 1862 starts a pass with that comment as the input. The
human does not say "there is a review".

Acceptance: comment on the PR → within one poll interval, one worker pass starts; the receipt names the event
and the head it acted on; no duplicate pass for the same event.

## Phase 3 — Checkpoints and failover

Local durability:

- worktree + journal + outbox + desk + record are the workstream;
- after every **pass**, not every turn, write a checkpoint;
- worktree: a WIP commit to `refs/bench/<id>`, pushed to origin; never a stash;
- journal: SQLite `VACUUM INTO` a consistent copy plus the receipt; never copy the live file;
- never "the disk is the backup".

Remote durability:

- push a `refs/factory/<workstream>/<pass>` commit to origin, plus the journal/receipt;
- record the checkpoint hash in the workstream record;
- do not copy a live SQLite journal; checkpoint after quiesce or use an append-only journal for the moving
  copy.

Failover:

1. lease expires or the host is declared dead;
2. another shop reads the workstream record and the last checkpoint;
3. it verifies the hash, acquires generation + 1;
4. it restores the worktree at the checkpoint, replays unacked events, starts a worker;
5. the old copy, if it returns, is fenced out; data divergence goes to `blocked: divergent`.

Honest bar for v1: **recoverable, not failover**. Assistance is a human starting the org bench;
the authority does not yet grant `g+1` without a human. Call it failover only when a second shop is
running and the authority grants `g+1` automatically. Until then, a crash loses everything after the
last checkpoint; do not call it memory-durable.

Acceptance: kill a worker mid-pass; start the org bench on another machine and adopt from the last
checkpoint; the worktree and receipts match it; no duplicate commit; the old shop cannot write after the
new generation is granted.

## Phase 4 — The factory feedback workstream

A third workstream in Tackle:

- input: structured `factory report` messages from the two Shakti foremen;
- output: triage, code change, release, broadcast;
- it owns no project PR; it owns the factory's own backlog.

Report shape (minimum):

```json
{
  "workstream": "perms-1862",
  "kind": "ergonomics",
  "command": "factory status",
  "output": "…",
  "expected": "…",
  "blocked": "…"
}
```

Intercom first. The AT mailbox replaces it when the mailbox service is real; the report shape is the seam.

## The two project starts

**Permissions** — `phase: reconcile`.

- 42 Linear issues are Backlog; the project document says 26 leaves done/refused on the branch.
- First output: a read-only reconciliation report, not a code change.
- Then a desk decision: accept the report, then `build` the remaining leaves.

**Enterprise** — `phase: land`.

- 76 items: 46 In Review, 8 Done, 16 Backlog, 6 Todo; PR 1854 open.
- First output: make the PR mergeable; one batched SHA-bound merge item for the human.
- No new ticket or PR before the existing one is reviewable.

## What this deliberately does not do

- No Pi goal mode. The workstream record is the goal.
- No autonomous merge. The human merges in GitHub.
- No AT federation in v1. Intercom is the bridge; the mailbox service is a later replacement.
- No VM/container in Phase 0. Existing worktrees are the body; the container is Phase 3.5.
- No automatic SOW edits. Linear writes are proposals to the desk.

## Decisions settled by review

1. **Adopt in place**, record outside the repo, refuse same path or same PR.
2. **Checkpoint per pass:** WIP commit to `refs/bench/<id>` pushed to origin; journal via `VACUUM INTO`
   plus receipt.
3. **New kernel**; Treadle remains the worker runner, configured by a file and receipts directory.
4. **Claim recoverable, not failover**, until a second shop runs and the authority grants `g+1` without
   a human. Assisted recovery through the org bench is the v1 bar.

Still open: **container timing** — before the two projects run, or after the kernel proves the loop on
worktrees?

## First three commits

1. `factory adopt` + the workstream record + `factory status`; tests against the two existing worktrees.
2. `factory watch` with GitHub/Linear cursors and one wake path; test on PR 1854 review comments.
3. The foreman skill and the first reconcile/land pass; no Pi goal, no merge, report to Tackle.
