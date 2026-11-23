# Launch two forestbuilder projects through the factory

Status: prepared, not executed. The target repository was **not** adopted or edited during
this run. This is the handoff for the operator to kick off when ready.

## The two projects

| workstream         | Linear project | PR                                                                       | branch                              | worktree                                                     |
| ------------------ | -------------- | ------------------------------------------------------------------------ | ----------------------------------- | ------------------------------------------------------------ |
| `permissions-1862` | `P-AUT-128`    | [#1862](https://github.com/Shakti-Reforestation/forestbuilder/pull/1862) | `feature/permissions-overhaul`      | `/Users/togmund/autotelic/shakti-perms`                      |
| `enterprise-1854`  | `P-AUT-129`    | [#1854](https://github.com/Shakti-Reforestation/forestbuilder/pull/1854) | `feat/enterprise-readiness-alchemy` | `/Users/togmund/autotelic/feat/enterprise-readiness-alchemy` |

Both PRs are open against `develop`. The target repository is private:
`Shakti-Reforestation/forestbuilder`. The factory records already exist:
`permissions-1862` is in `build`, `enterprise-1854` is in `land`.

## 0. Preflight

```sh
TACKLE=/Users/togmund/autotelic/tackle
FACTORY_HOME=${FACTORY_HOME:-$HOME/.factory}
FACTORY="node --conditions=development $TACKLE/packages/board/src/factory/cli.ts"
WORKER="$TACKLE/scripts/factory-pi-worker.sh"
TARGET=/Users/togmund/autotelic/shakti-v2
PERMS=/Users/togmund/autotelic/shakti-perms
ENTERPRISE=/Users/togmund/autotelic/feat/enterprise-readiness-alchemy

gh auth status
gh repo view Shakti-Reforestation/forestbuilder --json name,defaultBranchRef
gh pr view 1862 --repo Shakti-Reforestation/forestbuilder --json number,state,headRefName,baseRefName
gh pr view 1854 --repo Shakti-Reforestation/forestbuilder --json number,state,headRefName,baseRefName

git -C "$PERMS" status --short --branch
git -C "$ENTERPRISE" status --short --branch
test -x "$WORKER"
bash -n "$WORKER"
"$FACTORY" status
```

Stop if either worktree is dirty with work you do not own, if the PR head is not the checked-out
branch, or if the PR is closed or merged. The factory refuses those states; do not work around
the refusal.

## 1. Adopt the records (skip when already present)

```sh
export FACTORY_HOME
"$FACTORY" adopt \
  --path "$PERMS" \
  --project P-AUT-128 \
  --label permissions-overhaul \
  --id permissions-1862 \
  --pr 1862 \
  --repo Shakti-Reforestation/forestbuilder \
  --phase build \
  --worker "$WORKER"

"$FACTORY" adopt \
  --path "$ENTERPRISE" \
  --project P-AUT-129 \
  --label enterprise-readiness \
  --id enterprise-1854 \
  --pr 1854 \
  --repo Shakti-Reforestation/forestbuilder \
  --phase build \
  --worker "$WORKER"
```

`factory status` already names both records, so the adopt commands above are the bootstrap
path for a fresh factory home only. A record owns one path and one PR; the collision refusal is
the ownership fence. To reopen an existing done record:

```sh
"$FACTORY" phase --id permissions-1862 --set build
"$FACTORY" phase --id enterprise-1854 --set build
```

## 2. Give each project its first bounded event

```sh
"$FACTORY" event --id permissions-1862 --kind task --payload \
  '{"task":"Read the open PR and the project state. Make the smallest verified change that advances the permission work. Run the project gate and report the commit."}'

"$FACTORY" event --id enterprise-1854 --kind task --payload \
  '{"task":"Read the open PR and the project state. Make the smallest verified change that advances enterprise readiness. Run the project gate and report the commit."}'
```

The word "task" is deliberate: it is a bounded pass, not a whole project. The worker stops
after the event and writes a receipt.

## 3. Start the shop

```sh
"$FACTORY" daemon start --worker "$WORKER" --interval 60000
"$FACTORY" status
```

The daemon runs one loop per workstream. A 30-minute pass in one repo does not stop the other
from polling. Stop it with `"$FACTORY" daemon stop`.

## 4. Verify each pass

```sh
"$FACTORY" status
jq . "$FACTORY_HOME/workstreams/permissions-1862.receipts"/00*.json
jq . "$FACTORY_HOME/workstreams/enterprise-1854.receipts"/00*.json

git -C "$PERMS" status --short --branch
git -C "$ENTERPRISE" status --short --branch
jig check --cwd "$PERMS"
jig check --cwd "$ENTERPRISE"

gh pr view 1862 --repo Shakti-Reforestation/forestbuilder --json state,mergeable,statusCheckRollup
gh pr view 1854 --repo Shakti-Reforestation/forestbuilder --json state,mergeable,statusCheckRollup
```

A pass is done when the receipt says `done` and the branch has its checkpoint. A PR is ready
for a human only when the check rollup is green and `factory status` shows the ready desk item.
The factory never merges; the human lander does.

## 5. Stop, pause, or abandon

Normal halt after a pass:

```sh
"$FACTORY" daemon stop
```

Pause a workstream's automatic work:

```sh
"$FACTORY" phase --id permissions-1862 --set blocked
```

Retire a finished or abandoned workstream without deleting its evidence:

```sh
"$FACTORY" retire --id permissions-1862
```

If the PR itself must be closed, say so explicitly; this is irreversible enough to require the
flag:

```sh
"$FACTORY" retire --id enterprise-1854 --close-pr
```

Do not remove a worktree with uncommitted work. Archive the room first if it has one:

```sh
node --conditions=development "$TACKLE/packages/room/src/cli.ts" down --id permissions-1862 --root "$TARGET/.room"
```

The room command refuses to claim a move it did not make; the worktree removal is a separate,
human-owned cleanup after the record is done.

## 6. Dry-run evidence

Read-only checks performed for this runbook:

```text
gh repo view Shakti-Reforestation/forestbuilder
  defaultBranchRef develop; private

gh pr view 1862 … state OPEN, head feature/permissions-overhaul, base develop
gh pr view 1854 … state OPEN, head feat/enterprise-readiness-alchemy, base develop

test -d /Users/togmund/autotelic/shakti-perms                         yes
test -d /Users/togmund/autotelic/feat/enterprise-readiness-alchemy   yes
bash -n scripts/factory-pi-worker.sh                                 exit 0
factory --help                                                       prints the current surface
```

### Dry-run result: the target is not green yet

The two target worktrees currently fail their own conformance gate. This is pre-existing target
debt, not a factory finding:

```text
jig check --cwd /Users/togmund/autotelic/shakti-perms
  exit 1
  plumb/authorization/no-hardcoded-role-check   14 failing findings
  plumb/palette/no-off-brand-color              2050 failing findings

jig check --cwd /Users/togmund/autotelic/feat/enterprise-readiness-alchemy
  exit 1
  joggle/layer-direction                        1 failing finding
  joggle/reversal                               2 failing findings
```

Do not start the daemon and call the launch ready while this is unresolved. Choose one
explicitly before kickoff:

1. **Repair first** — make the target's own gate green (the factory can work the repair, but
   that is a separate decision and a separate event), or
2. **Baseline deliberately** — review every accepted identity and commit the target's baseline
   in the target repository; the factory never baselines automatically, or
3. **Launch knowingly** — the kernel only refuses a pass that makes quality worse, so a red
   baseline can still be worked down. This is the riskiest choice and should be written down.

The only commands not executed are the ones that would adopt, write, or start a real target
workstream. That is intentional: the goal is to leave the launch to the operator.

## Limits

- `jig check --cwd` assumes the target checkout has its own `node_modules`; install there
  before launch if it does not.
- The factory's PR reader uses the operator's `gh` authentication. It never carries a token
  in the record.
- The worker is Pi with `--thinking low`; set `FACTORY_THINKING=medium` only for a workstream
  whose task actually needs it.
