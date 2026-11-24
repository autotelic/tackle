# Vision dogfood — two feature branches, cleanly

Date: 2026-11-24  
Target: a scratch clone of `autotelic/tackle` at `e79aa763`  
Target repository: untouched. No Shakti checkout was opened.

## What ran

```text
scratch clone   /tmp/vision-dogfood3
factory home    /tmp/vision-factory-home4
worktree A      /tmp/vision-perms3       branch dogfood/permissions3
worktree B      /tmp/vision-enterprise3  branch dogfood/enterprise3
PR metadata     local gh double returning PR 9903 / 9904
```

Each worktree links the repository's package dependencies so the **whole** project gate
runs, not just a partial dependency graph. The earlier dogfood's 184 errors were a broken
dependency graph in the scratch worktree (missing package-level `node_modules` links), not
a "raw census". That run is superseded by this one.

## Passes

Both workstreams received a **real check event** from the PR double and a bounded task:

```text
github:check:e79aa763…:passed
task-1795478460000
```

| workstream         | branch                 | checkpoints            | quality                | ready handoff                   |
| ------------------ | ---------------------- | ---------------------- | ---------------------- | ------------------------------- |
| `permissions-dog4` | `dogfood/permissions3` | `e5806a27`, `9da1dffd` | before 0/0 · after 0/0 | `desk-permissions-dog4-ready-1` |
| `enterprise-dog4`  | `dogfood/enterprise3`  | `31988f65`, `b5cbcdfa` | before 0/0 · after 0/0 | `desk-enterprise-dog4-ready-1`  |

There are no stalled-quality desk items. Both ready items were raised by `readyForHuman`,
which only fires when a check event and a zero-error local gate meet.

## Retirement

Both lifecycle exits were exercised:

```text
enterprise-dog4  desk done answer  → phase done, no pass
permissions-dog4 merged PR event   → phase done, no pass
```

```text
enterprise-dog4  P-DOGFOOD  PR 9904  done  checkpoint b5cbcdfa
permissions-dog4 P-DOGFOOD  PR 9903  done  checkpoint 9da1dffd
```

The merge path used the real `merged` event parser against the PR double; the desk path used
the real answer store. The target's real PRs were not opened or merged.

## Checkpoint hygiene

```text
git show --name-only ad5843e8... | grep node_modules   → none
git show --name-only 31988f65... | grep node_modules   → none
```

The `.gitignore` now ignores `node_modules` as a name as well as a directory, so a symlinked
dependency tree cannot enter a checkpoint. No checkpoint carries an absolute host path.

## Evidence

```text
/tmp/vision-perms3/docs/vision-dogfood-permissions-dog4.md
/tmp/vision-enterprise3/docs/vision-dogfood-enterprise-dog4.md
/tmp/vision-factory-home4/workstreams/permissions-dog4.receipts/000{1,2}.json
/tmp/vision-factory-home4/workstreams/enterprise-dog4.receipts/000{1,2}.json
/tmp/vision-factory-home4/desk/desk-{permissions,enterprise}-dog4-ready-1.json
```

## What this proves

- two feature-branch workstreams can run concurrently with their own branches, worktrees,
  checkpoints, events, receipts, and quality measurements;
- a check-passed event and a zero-error gate produce the explicit ready-to-merge handoff;
- a done answer and a merged PR both retire without spending another pass;
- checkpoint contents are clean of host dependency symlinks;
- the Shakti target was not touched.

## Limits

- The PR is a local test double. It exercises the same GitHub event parser and the same
  factory lifecycle, but it is not a remote GitHub PR. Real target PRs remain out of scope
  until the operator launches them.
- The dogfood edits are documentation-only. They prove orchestration, not a target feature.
- Embedded agentOS isolation is proven separately in `packages/room/test/agentos.test.ts`;
  the board preview bridge still forwards host ports.
