# ADR 0012 — a chief waits on the truth document, and the wait writes nothing

Status: accepted
Date: 2026-11-28

## Context

`notifyPass` (`packages/board/src/factory/notify.ts`) is the return edge: one message per
finished pass, sent when the pass ends. It assumes a session that is already awake. A chief
that is not is left with a prompt reminder in its own instructions — polling from memory — and
`docs/shop.md` §3.5 makes the same point about supervision: "blocked" is the only state worth
interrupting a human for, and a supervisor that cannot tell idle from blocked either nags or
strands work.

The truth it would poll is already one document: `truthOf` (`truth.ts`) derives running,
pending, next event, open desk, held and last receipt from the receipt directory, the event log
and the desk, and `factory status` serves it as fields on the record array. Nothing in that
read writes, so waiting on it costs no state.

The ticket asked for the wait to be durable and event-aware, preferring pi-durable's
`sleepUntil`/`onWake` "where it fits", and to stop and name the boundary rather than invent a
timer daemon if it does not fit.

## What was checked

- **pi-durable.** Installed at
  `~/.pi/agent/npm/node_modules/@earendil-works/pi-durable`, and documented in `docs/shop.md`
  §2.5: `runtime.sleepUntil(until)` stores the sleep in the task's journal so the task holds
  no invocation meanwhile, and `onWake` asks an evictable host to arm an alarm. Both are
  methods on a runtime opened over a journal the Pi process owns — the harness inside a bench.
  The factory CLI is a plain Node process started from a shell (`bin/factory.js`), handed a
  worktree and an environment; it has no harness handle, no conversation, and no journal it
  may open read-write. A sleep there would have to be a durable timer in a store the factory
  does not own, which is the second event store the ticket ruled out.
- **The truth document.** `servedStatus` reads `workstreams/*.json`, each workstream's
  receipts, each event log and `desk/`; all of it is under `FACTORY_HOME`, on the same machine
  as the CLI.
- **The push edge.** `notifyPass` already tells a session that a pass ended, one outcome at a
  time, and records the attempt on the receipt. Nothing here changes it.

## Decision

1. The wait is a read-only function, `waitForAttention` (`packages/board/src/factory/attention.ts`),
   and one option on the command that already exists: `factory status --wait <seconds>`
   (`packages/board/src/factory/cli.ts`). No new command, no new package, no daemon.
2. It compares `attentionOf(status)` — phase, updatedAt, head, checkpoint, running pass,
   pending count and next event, open desk, held, last receipt, and the open desk list — and
   never includes `ageMinutes`, which moves on every read and would wake a wait for nothing.
3. Backoff is one minute, doubling to half an hour (`waitIntervals`), and every sleep is
   bounded by what is left of the wait. A timeout returns `changed: false`; it is a fact, not
   a failure, and nothing is charged for it. Only an uninterrupted sleep advances the backoff:
   a write that woke the sleep but did not change attention costs one extra read, never a jump
   to the next interval.
4. The local equivalent of `onWake`: a recursive `fs.watch` on the workstream and desk
   directories, armed before the first read, aborts the pending sleep. A change that arrives
   while the truth is being read leaves a flag, so the next sleep is skipped rather than
   waiting out an interval that predates it. A missing directory leaves the backoff as the
   only ceiling; nothing breaks.
5. `--wait` prints the status it started from, then the status that woke it. It refuses
   `--json`: one stdout document per invocation is the contract a pipeline can decode, and a
   JSON reader that wants to wait can loop over `factory status --json` itself.
6. The wait writes nothing — no lock, no marker, no last-seen cursor. A killed wait costs the
   chief only the time it was asleep, because the next read of the truth is the whole state.
7. The kernel stays outside this. A pass does not wait; a chief does. The factory's own
   scheduling (what runs next, and when) is unchanged.

## The boundary this does not cross

If the chief should instead be woken by a stored deadline that survives the CLI process — the
`sleepUntil` shape — the sleep has to live in the session's journal, and the session has to
call the wait. That is a Pi extension or tool surface over the existing factory, not a change
to this module, and it was not invented here.

## Consequences

- A chief can run `factory status --wait 1800` and be told by the answer, not by a reminder,
  that a pass finished, a gate parked a workstream, a review arrived, or a desk item was
  raised.
- Idle costs one read a minute, then one every half hour; the first interval is short because
  a pass usually ends within it.
- The printout and the wait cannot disagree: both read `servedStatus`, and the changed
  printout is the read that spotted the change.
- The acceptance tests are `packages/board/test/attention.test.ts`: the backoff's shape, a
  change returning on the change, a watched write aborting the sleep, an irrelevant wake not
  skipping an interval, the deadline never being overshot, and the factory home being
  byte-identical after a wait.
