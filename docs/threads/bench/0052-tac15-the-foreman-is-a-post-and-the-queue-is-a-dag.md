# 0052 — TAC-15 — the foreman is a post, and the queue is a DAG

Your object is right and it is **one field short**. `deps` is not metadata — it changes what the queue is.

```
  { project, label, repo, pr, branch, desired, foreman, deps[] }
  ↓ our records
  work.scope { project, label, repo, base, reviewers, ship policy }
  work.ship  { pr, sha, branch, state, checks[] }
  dependsOn[] : project or workstream ids
```

`board queue` then stops being a FIFO and becomes a **partial order**: P-AUT-128 before Collaboration / Documentation Files / Projects List, and transitively the rest. Two consequences the product needs and the current `board queue` does not have: render `blockedBy`, and refuse `board up <id>` while a prerequisite is unshipped — with the blocking id in the refusal. That is “attention is the binding constraint” made operational: you cannot spend attention on work that is not yet permitted.

**(1) Body: container, with the worktree inside it, journal for continuity.** L0-alone fails for a foreman for three reasons that have nothing to do with isolation: services outlive the process (ports, orphaned dev servers), `pause` cannot reliably stop them, and credentials end up in the host's environment. L2 gives you “kill the container and every process dies” plus a real `bench.json` services block. But keep the worktree as a real worktree *inside* the body — it is the data plane, and it is what `room status` and `room move` already understand. And do not make the agent pid 1: the foreman is a **supervised child**, so a container restart re-attaches to the same journal instead of ending the conversation. No memory snapshot on macOS is fine — that is what the journal is for.

**(2) Poller first, and not for simplicity — for replayability.** A poller holds a cursor you can re-read (`since`, `updatedAt > t`), so a crash re-reads and dedupes and the foreman can answer “what happened while I was asleep” without a relay. A webhook is a one-shot delivery you must ack in seconds. GitHub and Linear both support `since`-style filters on exactly the resources we care about. When webhooks come, they are an **accelerator over the same cursor** (this is his `subscribe` + `list(afterSeq)` design: the socket is a hint, the list is the truth), and polling stays the catch-up path. It also keeps the rack closed: nothing dials in.

**(3) One journal per workstream, N sessions over its life.** The foreman is a *post*, not a process; a session is a borrower. Autonomy should be **declared, not implied** — `desired.autonomy: ["labels","retarget","rebase-main","draft-toggle","ci-config","pr-body"]` — so a reviewer can read what it may do without a desk item. Three hard limits, none of which an autonomy list can grant:

- **never edits the Linear SOW or project description** — it may propose a diff as a desk item;
- **never merges** — merge is a human or a lander policy;
- **never touches another workstream's PR** — cross-workstream work is a mail, not an edit.

Everything reversible inside its own PR is allowed: labels, assignee, base retarget, rebase, draft↔ready, CI config the repo owns, re-running checks, fixing its own PR body.

**(4) Reconciliation first — as a report, not a rewrite.** 42 issues at Backlog while 26 are done on `feature/permissions-overhaul` / PR 1862 is exactly the case where an autonomous agent confidently rewrites a board and is wrong; the cost of wrong is the human's trust in the place that holds their intent. So job #1 is a read-only reconciliation: per issue, the evidence (branch, commit, PR, checks) and a proposed state; the human applies or approves.

And the thing that falls out of your own numbers: **“one PR per project” needs a size threshold, because 42 issues is where the preference meets review bandwidth.** Record it as `desired.prPolicy: "single" | "split-at"` with a threshold in files/lines, and let the foreman *refuse and ask* when the diff crosses it. A preference that cannot be violated is fine; a preference that nobody recorded is a future argument about a 4,000-line PR.

**Open question:** is the split threshold on **size** (files/lines) or on **cohort** (the dependency graph's unblocked set)? My vote: on size, with cohorts as the natural place to cut — because a time-based or cohort-only rule produces half-done features, while size is the thing a reviewer actually feels.
