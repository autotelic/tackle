# The factory needs a goal and backpressure

Status: memorialized 2026-11-24. Not implemented as a controller yet.

## The two forces

The factory already has **backpressure**:

- conformance gates and receipts
- check events and conflicts
- quality regression and stalled-quality desks
- pass locks, leases, and budgets
- PR review, merge, and human landings

It does not yet have a **goal**:

- an objective it is trying to reach
- a task tree or next-action policy
- a completion predicate
- a reason to start a pass when no external event arrived

The two are not substitutes:

```text
goal without backpressure   becomes a runaway agent
backpressure without goal   becomes a very well-tested idle factory
```

## The shape to build

```text
goal controller
  objective
  tasks / milestones
  completion predicate
  next-action derivation
        │
        ▼
  event queue ◀──── GitHub · Linear · Slack · logs/telemetry · desk
        │
        ▼
  workstream pass
        │
        ▼
  receipt + checkpoint + checks
        │
        └── back into next-action derivation
```

The goal controller is **not** a replacement for the existing workstream. It is a layer above
it. It should be able to say:

```text
objective: make permissions-1862 mergeable
tasks: [fix conflict, clear check, get review, land]
next: run a pass for the check event
done: merged + project completed
```

and the workstream still owns the pass, checkpoint, receipt, budget, lock, and room.

## Wakes are inputs, not the plan

The factory must remain wakeable by:

- a PR comment, review, conflict, or check event
- a Linear issue or project change
- a Slack mention or decision
- a report/log/telemetry signal
- a desk answer
- a goal-created next task

A wake can change the next action. It must not erase the objective. The priority rule is:

```text
safety/backpressure  >  goal progress  >  opportunistic wake
```

A red check blocks a landing even when the goal wants to land. A new ticket does not silently
replace the current objective; it becomes a candidate or a new task.

## The overnight test

The point of the goal layer is this operator promise:

```text
point the factory at two projects
leave it overnight
do not set a Pi goal
in the morning the projects are done or parked with a specific blocker
```

That means the factory must be able to:

1. persist the objective and task list outside a Pi session;
2. resume after death from its own record;
3. create the next event when the last receipt leaves work remaining;
4. stop on a completion predicate, a budget, or a desk-blocking decision;
5. report “done”, “blocked”, and “waiting on human” distinctly.

## Relationship to Treadle and Pi goal-x

| Layer                             | Owns                                                       |
| --------------------------------- | ---------------------------------------------------------- |
| Pi goal-x                         | one agent’s multi-turn objective and task tree             |
| Treadle                           | issue queue, deterministic checks, rules, maintenance loop |
| factory workstream                | one durable project, events, passes, checkpoints, rooms    |
| factory goal controller (missing) | objective + next-action derivation across wakes            |

The long-term factory should absorb the useful part of Pi goal-x **inside its own record**, so
an operator does not have to start a Pi goal for every project. Treadle remains the reference
for deterministic checks, queue discipline, and maintenance.

## What is deliberately not decided here

- whether the controller is a board actor or a separate small service
- whether Treadle becomes the outer loop and the factory its pass executor
- the exact task schema and completion-expression language
- how goal priority is resolved against multiple projects

Those are implementation decisions for the next goal.
