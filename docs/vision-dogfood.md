# Vision dogfood — two feature branches

Date: 2026-11-23  
Target: a scratch clone of `autotelic/tackle` at `8366e99b`  
Target repository: untouched. No Shakti checkout was opened.

## What ran

```text
scratch clone   /tmp/vision-dogfood
factory home    /tmp/vision-factory-home
worktree A      /tmp/vision-perms       branch dogfood/permissions
worktree B      /tmp/vision-enterprise  branch dogfood/enterprise
PR metadata     fake gh returning PR 9901 / 9902
```

Both workstreams were adopted as PR workstreams, each with its own branch and worktree. The
factory read the same PR-shaped document a real run would read, but `gh` was a local test
double; this dogfood did not open or merge a real pull request.

## Passes

| workstream | branch | checkpoint | receipts | local gate |
| --- | --- | --- | --- | --- |
| `permissions-dog` | `dogfood/permissions` | `320f1eac` | 3 | `jig check` 0 |
| `enterprise-dog` | `dogfood/enterprise` | `ab215095` | 3 | `jig check` 0 |

The first pass for each workstream ran concurrently in its own process:

```text
factory: permissions-dog pass 1 done; checkpoint cf215232
factory: enterprise-dog pass 1 done; checkpoint 196fc16a
```

A fresh process then ran a second set of events against the persisted records. The first retry
failed because the worker's edit was not idempotent ("nothing added to commit"); after fixing
the worker to append, pass 3 completed in both worktrees. That is the restart evidence: the
records, events, locks, and worktrees survived the process, and a stale failed pass did not
silently become a success.

```text
factory: permissions-dog pass 3 done; checkpoint 320f1eac
factory: enterprise-dog pass 3 done; checkpoint ab215095
```

## Evidence

```text
/tmp/vision-perms/docs/vision-dogfood-permissions-dog.md
/tmp/vision-enterprise/docs/vision-dogfood-enterprise-dog.md
/tmp/vision-factory-home/workstreams/permissions-dog.receipts/000{1,2,3}.json
/tmp/vision-factory-home/workstreams/enterprise-dog.receipts/000{1,2,3}.json
```

Each worktree's own `jig check` exited 0:

```text
A=0 B=0
plumb: 0 finding(s)
plumb-plumb: 0 finding(s)
plumb-joggle: 0 finding(s)
joggle: 0 finding(s)
```

The receipt's quality counter is the raw diagnostic count, not the gated count; it was 184 in
both worktrees, while the gated `jig check` was clean. That difference is worth keeping: the
receipt records the census, the gate records what the baseline allows.

## What this proves

- two feature-branch workstreams can be adopted, worked, and receipted concurrently;
- each has its own worktree, branch, checkpoint, and event stream;
- the factory survives a fresh process and does not lose the workstream state;
- a failed worker pass leaves the record accountable rather than pretending success;
- the Shakti target was not touched.

## Limits

- The PR read was a local fake, not GitHub. Real check runs, review comments, and merge events
  remain covered by the unit tests and the launch runbook, but this dogfood did not exercise a
  remote PR.
- The dogfood edits are documentation-only. They prove the orchestration and gate path, not a
  target feature.
