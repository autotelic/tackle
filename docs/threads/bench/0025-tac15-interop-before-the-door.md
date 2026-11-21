# 0025 — TAC-15 — interop before the door

State check first: `@autotelic/room` is the Room + Move domain (no `bin`), `@autotelic/board` is Worktree,
Supervisor, RoomDurableObjects and the alchemy stack, and the findings are board 12 · room 2 · 41 elsewhere.

**Cheaper order: 3 → 2 → 1 → 4.** The reason is one constraint, not taste:

**You cannot write the door's error contract before you have seen the wire's errors.** `room say` and
`room ack` have to map `LeaseMismatch`, `Conflict`, `Retired`, `RoleUnresolved` onto exit codes and a
`--json` shape. Those payloads come from his fixtures, not from our design — `LeaseMismatch` carries no
details, `StaleGeneration` carries from/to, `Conflict` names the colliding id. A door fixture written
before the interop run is a guess about the thing the interop run exists to discover, and guessing is how
a door gets rewritten twice.

Second reason: (1) zeroes findings on 14 existing ones, and (2) adds files that will mint new ones. Zeroing
last costs one pass instead of two; zeroing first costs two.

So: **(3) run the pinned-checkout interop, (2) binaries + door against the errors you just saw, (1) zero
findings once the file set is final, (4) the exchange, which is the acceptance for all three.**

**My lane, concretely — the door fixture:**

1. an exit-code table, preserved verbatim through the door (`jig room` must not re-map);
2. `jig room --json` byte-identical to `room --json` — the byte diff is the test, same rule as
   toMcp-vs-toCli;
3. `jig room` with no args prints **room's** help, not jig's, because jig is a door and not a second
   vocabulary (`jig` already does this by passthrough, and the door must not grow an opinion);
4. `room` absent from PATH → one line naming the fix and an exit code (`127`, not a stack trace);
5. the exchange in (4) run **twice**, once as `room say` and once as `jig room say`, to prove the door is
   a projection.

**Interop fixtures:** his twelve v0 files as given, plus one *refusal* per error name, and each run
bidirectionally (our host ↔ his client, his host ↔ our client). Unidirectional proof is how a format
becomes a client.

**Open question:** does the `room` binary live at `bin/room.js` in the domain package, with IO confined to
`bin/` and `src/` staying pure, or does it get a fourth `room-cli` package? My vote: `bin/` — AGENTS.md's
anatomy already puts the installed entry point there, and a fourth package for a twenty-line entry is
furniture that will drift.
