---
name: room
description: Open, join, or resume an agent room for durable multi-session work on a repository. Use when a conversation must outlive one session, when a human and several agents share one inbox, or when returning after the machine was off and you need to know what changed.
---

# Room

A room is a durable conversation: an SQLite ledger of turns, cards, receipts, and jobs, held
outside the checkout at `~/.room/<login>/<projectId>/`. It survives a restart, a closed terminal,
and a re-cloned repository. Use it when the work has a long tail — a PR under review for days, a
worker that must be woken, a human checking in between meetings.

Do not use a room for a task you will finish in one session; that is just a conversation.

## Open one

```sh
jig room plan          # what a room would contain here; writes nothing
jig room daemon        # start the daemon (it prints the URL and stays in the foreground)
jig room session       # attach a session to the room: turns, inbox cards, receipts
```

`jig room plan` is the honest first step: it names the room, the repository, and what it would
ingest, and it writes nothing. Read its output before starting a daemon.

## Resume after being away

```sh
jig room resume                 # diff GitHub against what this machine last saw
jig room resume --apply         # append the cards and advance the cursor
jig room resume --pr 1234,1235  # only these pull requests
```

The cursor is machine state (`resume.json` beside the session), so "nothing new" always means
"nothing new _to this machine_". A cold start says `cursor lost` and reports the current round —
the latest review, its state, the sha it was written at, the head now, and how many inline notes
came after it — rather than replaying every review the PR ever had.

Read the card before acting. `written at 48c85cad, head is now 83fe79a3` means the review is
against an older commit: check whether the note still applies before changing code.

## Close the loop honestly

- A receipt is a fact that something ran, with its verdict. Never write a receipt for work you
  did not run.
- `jig room resume` without `--apply` writes nothing. That is the mode to use when you only need
  to know what changed.
- The room is not the repository: nothing in it is committed, and nothing in it substitutes for
  `jig check`.
