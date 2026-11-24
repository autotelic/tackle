# Vision dogfood — two feature branches, two processes

Date: 2026-11-24  
Target: a scratch clone of `autotelic/tackle` at `e79aa763`  
Target repository: untouched. No Shakti checkout was opened.

## What ran

```text
scratch clone   /tmp/vision-dogfood3
factory home    /tmp/vision-factory-home5
worktree A      /tmp/vision-perms3       branch dogfood/permissions3
worktree B      /tmp/vision-enterprise3  branch dogfood/enterprise3
PR metadata     local gh double returning PR 9905 / 9906
```

The worktrees link every package's dependencies, so the whole project gate runs. The earlier
184-error run was a broken dependency graph in that scratch worktree; it is superseded.

## Passes across processes

Pass 1 was a real check event, run in one process per workstream. Pass 2 was a task event,
run in a **new process** per workstream.

| workstream         | pass 1                | pass 2                | quality                    |
| ------------------ | --------------------- | --------------------- | -------------------------- |
| `permissions-dog5` | pid 75253 · 03:20:48Z | pid 76712 · 03:21:04Z | 0 errors / 0 warnings both |
| `enterprise-dog5`  | pid 75254 · 03:20:48Z | pid 76713 · 03:21:04Z | 0 errors / 0 warnings both |

The records, events, locks, worktrees, and checkpoints survived the process boundary. The
two workstreams ran concurrently in the first process pair and again in the second.

## Ready, done, merge

Both pass-1 receipts produced the explicit handoff:

```text
desk-permissions-dog5-ready-1  Ready to merge PR #9905
desk-enterprise-dog5-ready-1   Ready to merge PR #9906
```

Both exits were exercised:

```text
enterprise-dog5  desk done answer  → phase done, no pass
permissions-dog5 merged PR event   → phase done, no pass
```

After merge retirement the ready desk is closed automatically; `factory desk list` is empty.
The merged event parser was also exercised against the real merged PR #11
(`github:merged:11:8ba6fee6...`), and the real open PR #1862 was read without touching it.

## Checkpoint hygiene

Checkpoints `4f5cbec1`, `485769a1`, `6ffcda4a`, and `e8a695dc` contain no
`node_modules` entries. The `.gitignore` ignores the name as well as the directory, and
`adopt.test.ts` has a regression test for a symlinked dependency tree.

## Evidence

```text
/tmp/vision-perms3/docs/vision-dogfood-permissions-dog5.md
/tmp/vision-enterprise3/docs/vision-dogfood-enterprise-dog5.md
/tmp/vision-factory-home5/workstreams/permissions-dog5.receipts/000{1,2}.json
/tmp/vision-factory-home5/workstreams/enterprise-dog5.receipts/000{1,2}.json
/tmp/vision-factory-home5/desk/  (empty after retirement)
```

## Limits

- The two-workstream PR is a local test double. It exercises the same GitHub event parser and
  factory lifecycle, but it is not a remote GitHub PR. Real target PRs remain out of scope.
- The dogfood edits are documentation-only; they prove orchestration, not a target feature.
- Embedded agentOS isolation is proven separately in `packages/room/test/agentos.test.ts`;
  the board preview bridge still forwards host ports.
