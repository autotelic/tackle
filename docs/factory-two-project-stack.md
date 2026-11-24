# Two stacked factory projects — operating plan

Status: pre-launch. The project names are intentionally slots; the operator supplies them once the
shape is accepted. The parent is the current Permissions branch.

## 1. The topology

```text
origin/develop
    │
    └── feature/permissions-overhaul        PR #1862 · permission foundation
            │
            ├── feature/<project-a>         one worktree · one PR · factory A
            │       PR base: feature/permissions-overhaul
            │
            └── feature/<project-b>         one worktree · one PR · factory B
                    PR base: feature/permissions-overhaul
```

The two child branches are **siblings**. Neither is stacked on the other. Each starts at one
recorded Permissions tip and rebases onto a newer tip when Permissions moves. The factory now
watches the PR base OID and emits a `parent` wake when the parent advances; a successful pass
records the new `baseSha`.

No per-ticket branches and no per-ticket PRs. The canonical Permissions session established the
reason: 73 open PRs, five useful fixes 72–133 commits behind, one 198-file foundation. One project
gets one long-lived feature branch and one PR.

## 2. What the canonical session proved

The map is the execution runbook in
`/Users/togmund/autotelic/shakti-v2/docs/permissions-overhaul-tree/RUNBOOK-execution.md`, plus the
tree in `03-tree.md`.

### The vehicle

```text
worktree beside the main clone
one feature branch from the dependency branch
one draft PR to that dependency branch
```

### The per-ticket loop

```text
claim → read ticket and every reference → deep-dive code
→ front-end: cutlist assemble from primitives
→ failing acceptance test
→ minimal implementation
→ front-end: cutlist compress; record before/after
→ commit per ticket → push → gates
→ record commit sha + evidence in the ticket
```

A ticket is not done when the code compiles. It is done when its own acceptance test failed before,
passes after, the gates are green for the touched scope, and the ticket records the evidence.

### The gates

```sh
jig check
joggle --types --no-replay --baseline .joggle-baseline.json
cutlist
pnpm lint:errors:changed
pnpm check-typescript-errors:changed
FILE=<test> pnpm test:rest:file
pnpm test:ui
node scripts/spec-check.mjs
node scripts/policy-snapshots.mjs --check
node scripts/derive-tree-facts.mjs --tree permissions
```

Run the commands from the child worktree; use the parent's installed dependencies and the same
gate configuration. A baseline edit to make a gate pass is a failure. A scoped jig check can
report 0 errors and still carry `unjudged > 0`; the factory records `complete: false` and does
not call that clean. A tool defect is reported, not worked around.

### Effect and composition

Every ticket gets the same three questions:

1. Did I add an early return or boolean branch that is really a business decision?
2. Is there a business rule in the handler? Move only the touched part to a domain function or
   Effect service.
3. Does the error path say what happened, with a typed error at the boundary?

Front-end tickets use cutlist twice: assemble from existing primitives, then compress the result.
Hoist at the third use, delete the old copies in the same commit, and record before/after counts.

## 3. The goal contract for each factory

Each factory is a workstream **plus** a goal contract. The workstream is the executor; the goal
contract is the momentum.

```text
objective: finish <project> on feature/<project>, one PR to feature/permissions-overhaul
tasks: the project's Linear issues, in dependency order
completion:
  - every issue is done or explicitly refused
  - the project PR is green and ready for a human
  - no new conformance findings outside accepted baselines
  - the target project's acceptance tests and evidence are recorded
wakes:
  - Linear issue/project change
  - PR review, comment, conflict, or check event
  - desk answer
  - parent branch advance
backpressure:
  - the gate matrix above
  - parent branch has moved → rebase before the next pass
  - a tool defect → report it; park the ticket; continue elsewhere
stop:
  - complete, blocked on a human decision, or budget exhausted
```

The goal controller is memorialized in `docs/factory-goal.md`; the factory today supplies the
pass, receipt, checkpoint, lock, room, and wake loop. Until the goal controller is implemented,
the operator (or a Pi goal) supplies the objective/task selection and reads the receipts.

## 4. The handoff map (one per factory)

```text
project:        <name>
linear:         <project URL / P-...>
parent:         feature/permissions-overhaul @ <sha>
branch:         feature/<project>
worktree:       <absolute path>
PR:             <number> → feature/permissions-overhaul
worker:         scripts/factory-pi-worker.sh
first events:   <the first 3 tickets, ordered>
acceptance:     <the project's done-when, copied from Linear>
forbidden:      never edit the parent branch directly; never open a per-ticket PR;
                never merge; never touch the sibling worktree
gates:          the matrix in §2
monitor:        factory status · desk list · /factory · /preview/<id>/
```

The map is handed to the factory as the workstream's task payload and stored beside the factory
home (not inside the target repository). The target repo keeps code and Linear keeps intent.

## 5. Kickoff, once the names exist

```sh
TARGET=/Users/togmund/autotelic/shakti-v2
PARENT=/Users/togmund/autotelic/shakti-perms
TACKLE=/Users/togmund/autotelic/tackle
FACTORY="node --conditions=development $TACKLE/packages/board/src/factory/cli.ts"
export FACTORY_HOME=${FACTORY_HOME:-$HOME/.factory}

git -C "$TARGET" fetch origin
PARENT_SHA=$(git -C "$PARENT" rev-parse feature/permissions-overhaul)

# one worktree and one branch per factory
git -C "$TARGET" worktree add /Users/togmund/autotelic/shakti-<project-a> \
  -b feature/<project-a> "$PARENT_SHA"
git -C "$TARGET" worktree add /Users/togmund/autotelic/shakti-<project-b> \
  -b feature/<project-b> "$PARENT_SHA"
```

Open one draft PR per child branch with base `feature/permissions-overhaul` (or the project's
chosen parent). Then adopt each worktree with its PR:

```sh
"$FACTORY" adopt --path /Users/togmund/autotelic/shakti-<project-a> \
  --project <linear-project> --label <label> --id <id> --pr <pr> \
  --repo Shakti-Reforestation/forestbuilder --phase build \
  --worker "$TACKLE/scripts/factory-pi-worker.sh"
```

Repeat for B. Adopt is a collision fence: the same path or PR cannot belong to two workstreams.

## 6. Seed the map

The first event is not "do the whole project." It is the first bounded ticket plus the map:

```sh
"$FACTORY" event --id <id> --kind task --payload \
  '{"task":"Read the attached map and the first Linear ticket. Do the vehicle preflight, then implement only that ticket with its acceptance test and gates. Do not merge and do not open a per-ticket PR."}'
```

The map itself is attached as a file path in the event or in the workstream's prompt directory.
The worker must report the ticket id, branch head, commit, gate exits, and evidence.

## 7. Monitoring

```sh
"$FACTORY" status
"$FACTORY" desk list
curl -s http://127.0.0.1:4780/presence | jq .
```

The live read surfaces are `/factory` and `/preview/<workstream>/`. A workstream is healthy when:

- its phase is moving, not stuck in build with no receipt;
- its last receipt has the expected checkpoint and gate counts;
- its PR base is still `feature/permissions-overhaul`;
- its branch is not behind the parent without a recorded rebase;
- its desk contains only real human decisions.

Stop and rebase when the parent advances. Do not merge the parent into the child; rebase the child
onto the new parent tip, then rerun the gates. If the parent is red, the child can still work, but
the child PR cannot be called ready until the dependency is green.

## 8. The two rules that keep it from becoming a rat king

1. **One parent, two siblings.** Never stack A on B. Never let A and B share a worktree, branch,
   room, port, or PR.
2. **One project, one PR; one branch owner.** Commits are per ticket; PRs are per project.
   The stack is the dependency, not a ladder of review artifacts. Adoption now refuses a second
   workstream for the same repository branch as well as the same path or PR.

The remaining launch decision is only the two project names and their Linear URLs. The topology,
map, gate matrix, worker, and monitoring surface are ready.
