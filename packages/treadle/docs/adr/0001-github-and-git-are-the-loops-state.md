# GitHub and git are the Loop's state, not a machine snapshot

The Loop is an XState machine, but it doesn't persist or restore its snapshot. After a restart it rebuilds where it was from GitHub and git: issue labels (`treadle:ready` / `treadle:working` / `treadle:parked`) say which issue is in progress, the `loop/<issue>` branch and its Checkpoints hold the work, and Receipts (issue comments the Loop writes after each Pass) hold the history the budgets count. It then re-enters evaluating and runs the Checks on the working issue. We chose this because a live Session can't be restored from a snapshot anyway, the Checks are cheap and deterministic to re-run, a person can steer the Loop by editing labels, and losing the mini's local state (`~/.treadle`) loses nothing that matters.

## Considered options

- **A persisted XState snapshot restored exactly.** It's more precise, but when the snapshot and GitHub disagree (a label changed by hand, a PR merged while the Loop was down) the snapshot wins and is wrong.
- **A snapshot reconciled against GitHub on startup.** That means two sources of truth plus reconciliation code, for no state that GitHub and git can't already reconstruct.

## Consequences

- Anything the Loop needs after a restart must be written to GitHub or git as it happens: the Checkpoint after every Session, the Receipt after every Pass, and questions and answers as issue comments. In-memory-only state is lost on restart by design.
- A Session cut off by a restart is never resumed. Its leftover changes become an interrupted Pass that counts against the budget, so a Loop that keeps crashing still runs out.
- Receipts and labels can be written by anything with the `gh` login, including the agent. Keeping the agent from forging them is a guardrail concern (#16), not something this design protects against.
