---
"@autotelic/room": minor
---

The session that owns a room is now named, in the ledger and in the UI.

A room delivers to exactly one session id, so "which session is the room watching" is a
question with one right answer — and until now nothing showed it. The board carries it:

```
room tackle · local/togmund
  roomd   reachable · 1 present
  session 7f1c2a9b · attached, 12s ago
```

The pi extension reads that and keeps a keyed status line (`ctx.ui.setStatus("room", …)`)
that says `room tackle · this session` while it owns the room, `room tackle · session 7f1c2a9b`
when another session has taken over, and `roomd down` when nothing is listening — so a
session that is about to be woken by a headless resume says so. It also sets the session name
(`pi.setSessionName`) once, and only when nobody has named the session already, so the resume
picker and the tab title carry the room's name.

`renderBoard` takes `now` as an argument now, so the rendering stays pure and the clock is
read at the command boundary.
