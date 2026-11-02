---
"@autotelic/room": minor
---

The room's session is a durable conversation, opened on `@earendil-works/pi-durable`.

The room's brief named pi-durable and the room did not use it: it grew its own session registry —
a `PUT /session` heartbeat, a 60-second staleness window, a `shouldWake` predicate, and a
`pi -p --session` spawn to wake what had gone quiet — and the failure mode that produced was a
room accepting events and queuing nothing until someone `PUT /config` by hand.

`src/session.ts` is the seam now: `openRoomSession` opens the conversation over the room's own
sqlite storage, `submitToRoom` hands it a delivered item (busy/idle admission is the library's),
and `roomSessionView` reads the live state — busy, queue, and why the last run ended. Verified
on this machine: a conversation opens (id `1`), a submission is admitted (id `8`), and with no
provider configured the view reports `runFailure: "no_model"` instead of silence.

Also recorded: `tools/foreman/journal.md` §1.1 concluded that pi-durable "is not in this
environment" because it searched for `pi-durable` and `@autotelic/pi-durable`; the package is
`@earendil-works/pi-durable` and it is on npm. The section now says so.

The heartbeat, the wake spawn, and the `setWidget` block are next: the daemon submits through
this module, and the badge moves into the editor border.
