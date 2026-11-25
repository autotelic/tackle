# ADR 0004 — daemons update by generation, not by hot patching

Status: proposed
Date: 2026-11-25

## Context

A factory pass is already a fresh process: it imports the current source, so a new pass picks up a
new prompt, kernel, or conformance rule automatically. The long-lived parts do not. The daemon and
the board HTTP server keep the modules they imported at start. Editing the tree does not change the
code inside them, and replacing those modules in place is not something Node/ESM supports safely.

Erlang/OTP is the reference for the alternative: a code server can hold two versions, a process can
run `code_change/3` to migrate its state, and a supervisor owns the restart. That is powerful, but
the important parts are the **protocol** (drain, migrate, hand over, roll back), not the BEAM trick.
Node cannot load two versions of one module and let a live closure keep the old one. Pretending it
can would be worse than restarting.

## Decision

1. **A generation is a unit.** Every deploy writes a generation descriptor:

   ```json
   { "gitSha": "…", "builtAt": "…", "schema": 2, "launcher": "…" }
   ```

   The daemon and board report the generation they loaded. A status page can say "running 9ce84aec,
   repo 15c326e2" instead of leaving the operator to guess.

2. **A supervisor owns replacement.** The daemon never replaces its own running code. A small
   supervisor (launchd/systemd/shop wrapper) watches a **promoted** generation, checks the tree,
   starts the new process, health-checks it, and only then retires the old one. Auto-pull is not
   auto-update: only a promoted ref is eligible.

3. **Drain is the handover.** The old daemon enters `draining`:

   - stop dispatching new passes;
   - wait for live passes or the wall budget;
   - release the shop/pass locks;
   - exit with a generation-stamped receipt.

   The new daemon starts only after the old one has released its ownership. A crash leaves the
   supervisor to start a generation; it does not leave two owners.

4. **Passes fold updates naturally.** A pass worker is already ephemeral. The new generation owns
   the next pass; the current pass finishes under the generation that started it. No in-process
   module hot-swap, no mixed kernel inside one pass.

5. **State has a schema version.** Workstreams, events, receipts, desk items, and readiness records
   carry a version. A new daemon must read the previous version and migrate it explicitly. An old
   daemon must refuse a newer record rather than dropping it or guessing. The board uses the same
   rule: an unknown phase is an error row, never a disappeared workstream.

6. **Board and daemon move together.** They share the record vocabulary. A generation restart
   includes the board; a stale board is not allowed to be the only reader of a new schema.

## Consequences

- A pass gets new code on the next pass; a daemon/board change gets it on the next drain.
- There is a short no-dispatch window during handover. That is the price of one owner and a
  consistent record, and it is visible in the generation status.
- Rollback is starting the previous promoted generation, not reverting files under a live process.
- A supervisor that cannot health-check the new generation must keep the old one; an unverified
  generation is not an update.

## First implementation slice

Write `~/.factory/generation.json` from the release/deploy step; add `factory daemon status` and
`/presence` fields for `runningGeneration` and `repoGeneration`; add `factory daemon drain`;
then put start/stop/drain under a supervisor. Do not build fs.watch auto-pull before the drain
protocol exists.
