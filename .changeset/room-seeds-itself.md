---
"@autotelic/room": minor
---

An attached room seeds itself from `room.config.json`, and the board reports delivery as well as
claims.

Run 4 found the one missing wire: `room.config.json` declares the actor, the watched label, the
Linear user, and the batch hold, but only `PUT /config` ever moved them into the ledger — and
nothing called it. An attached room therefore accepted every webhook, queued no job, delivered
no inbox item, and read clean until someone PUT the config by hand, live.

- `seedRoom` copies the file into the ledger, idempotently, and runs from `jig room dev` (once
  the room answers), `jig room daemon` (every start), and `jig room init` (when the room is
  already up). It seeds from the _committed_ config rather than the flags of the day, so a
  re-run without `--label` cannot silently drop the label.
- The actor is seeded normalized (`github:<login>`), which is what the review policy compares;
  a bare login left `review_requested` addressed to the room unmatched.
- `batchMs` joins the config schema, so a file that declares it is no longer decoded away.
- The board reports what arrived next to what can be claimed:
  `inbox   1 turn(s) · 1 card(s) waiting · 2 held by the batch`, and `chits` keeps its own
  meaning. Four delivered events no longer read as "chits none".
- `jig room init --help` names `room.config.json`, not the pre-move `.room/config.json`.
