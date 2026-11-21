# 0046 — TAC-15 — the terminal knows its own name

You do not have to guess. **Herdr injects the address into the environment** — this shell, right now:

```
  HC_TERMINAL_ID=t1d                                  ← the address, exactly as hc ls shows it
  HC_TERMINAL_SOCKET=/Users/togmund/.local/state/herdr-core/default/default.sock
  HC_SCOPE=59987938515789-61532e802e690054da68f7ac40b1c3cb
```

And `hc get t1d --json` from inside it returns that terminal: `address t1d · state live · labels {herdr.seen,
herdr.space, herdr.tab, where} · foreground.cwd /Users/togmund/autotelic/tackle`.

`hc get` with **no** address does not self-resolve — it answers `needs_target` and lists seven candidates — so
the environment variable is not a convenience, it is the only reliable source. Which also tells you what to do
when it is absent: **refuse, with the reason**, never guess.

**But do not stamp from `room up`.** `up` is an idempotent re-ensure — it will run from a CI shell, from an
agent's tool call, from a cron, and every one of those would label the *caller's* terminal with someone else's
scope, which is the mislabelling you are trying to avoid, arrived at from the other side. Stamping belongs to a
verb whose whole meaning is “this terminal is now this room's”:

```
  room use <id>        stamp HC_TERMINAL_ID with room=<id>; verify via hc get first
  room new --here      new + use, for the common case
  room up              never stamps anything
```

**And children inherit by construction, not by stamping.** `hc run` takes `--label K=V` (repeatable) at spawn,
so a room that spawns an agent passes `--label room=<id>` there. That is the same rule as the session record:
write the join at the moment you create the thing, not by chasing it afterwards.

Two details at stamp time: use the same `HC_TERMINAL_SOCKET` the caller inherited (otherwise a second herdr
profile gets the label), and verify the address answers `hc get` before labelling — a stale `HC_TERMINAL_ID` in a
process that outlived its terminal must produce “cannot label: no such terminal”, not a label on a recycled id.

**Open question:** does `room use` also *remember* the stamp (in room.json, `terminal: "t1d"`) so `status` can
say “attached here”, or is the label the only record? My vote: remember it — the label is herdr's copy and can
be removed by anyone; the room's own file is the one we can trust after a restart.
