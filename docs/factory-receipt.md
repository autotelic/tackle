# Factory slice receipt

At the close of the first factory goal, 2026-11-21.

## Adopted workstreams

| id               | project   | path                                            | PR   | phase     | checkpoint |
| ---------------- | --------- | ----------------------------------------------- | ---- | --------- | ---------- |
| permissions-1862 | P-AUT-128 | `~/autotelic/shakti-perms`                      | 1862 | reconcile | 55aa5293a  |
| enterprise-1854  | P-AUT-129 | `~/autotelic/feat/enterprise-readiness-alchemy` | 1854 | land      | e5d6e030e  |

Records are under `~/.factory/workstreams/`, outside both repos. A second owner for the same
path or PR is refused.

## Permissions — reconcile pass

- Read-only. No code, Linear or SOW edits. Worktree clean before and after.
- Report: `~/.factory/reports/permissions-1862-reconcile.json`, 42 issues:
  20 done, 13 refused, 9 remaining, 0 unknown.
- Evidence/inference split: 3 evidenced, 39 inference only.
- PR 1862 is `CONFLICTING` on seven generated `tools/ui-catalog/*` files.
- CI: lint fails on the same stale catalog; `test-rest (2)` is killed by the 15-minute
  timeout, with the last green test before `relationshipListParity.test.js`. Local timing of that
  file is 7s; the shard total is 44s locally. The CI-only hang is unresolved.
- `docs/permissions-overhaul-tree/05-audit.md` contains two pasted truncation notices; section
  16 is recoverable from `580049816`, sections 17–20 never existed.
- Desk item `desk-r1862a` asks the human to accept the report. Nothing moves to `build` until
  that answer.

## Enterprise — land pass

- First pass was interrupted at its 10-minute bound; a second pass was run.
- The pass merged `develop` into the branch and pushed `0c52e6ad4`.
- PR 1854 is `MERGEABLE`; merge state `BLOCKED` on `REVIEW_REQUIRED`, head
  `e5d6e030e`.
- The REST failures traced to `8d706f9b5`; readiness reverted it as `e5d6e030e`.
  `pnpm test:rest`: 2328 passing, 15 pending, 0 failing. The conformance baseline is back
  to 1772 entries rather than claiming the nullable keys fixed.
- The pass did not merge and did not edit the SOW.
- A live half-applied Alchemy stack remains in `forest-builder-demo-437619`; it is blocked on
  `roles/servicenetworking.networksAdmin` for `ted@autotelic.com`. No Cloud SQL or Memorystore;
  spend ~$0.
- Pass 4 is a no-op receipt pass at the green head: checkpoint `e5d6e030e`, journal snapshot,
  jig 0/0 before and after, receipt `done`.

## Kernel, watch, reports

- `factory adopt/status`: in-place adoption, outside-repo record, path/PR collision refusals.
- `factory run/event/watch`: durable event log, one pass per waking event, charge-at-start
  receipt, quality-ratcheted pass (jig before/after; regression refused), per-pass
  `refs/bench/<id>` checkpoint, SQLite `VACUUM INTO` journal snapshot.
- `factory watch`: GitHub/Linear cursors normalized to instants; stale-head reviews wake,
  consumed/self-authored/blocked/cap-stopped events do not.
- `factory report`: structured report outside the repo, optional intercom delivery to Tackle.
- All fixture-tested: 9 tests in `packages/factory/test`.

## Running now

- `factory daemon` is running on this machine with two workstreams, a 2-minute poll, and a log at
  `~/.factory/daemon.log`; the one-owner lock is `~/.factory/shop.lock`.
- `board presence` now carries `factory.workstreams` and `factory.reports` beside rooms, sessions
  and the tailnet. That is the room/board read surface for the feedback stream.

## Gates

`jig check` 0, `pnpm check` 0. The last commits are on `main`; this receipt is committed with
them.

## What is not ready

- **Publish:** no. `@autotelic/factory` is new and private; room/board/mailbox are still private
  `0.0.0`. The mailbox has no auth/federation service; the AT path is a library plus fixtures.
- **Desk:** the report and the desk id exist, but there is no desk store/answer command yet;
  acceptance is a human message plus `factory phase --set build` for now.
- **Watch loop:** one-shot/watch logic exists; no always-on shop process is supervising both
  workstreams yet.
- **Recovery:** last-checkpoint recovery is implemented; failover/automatic `g+1` is not.
- **Enterprise receipt:** pass 2 was stopped, so its receipt says `running` while the PR is
  mergeable. A follow-up pass should close it.
