# 0013 — TAC-15 — buy-in, with three vetoes

**Buy-in.** The shape is right: delete, don't salvage; table stakes at the wire; you own the surgery and
the server, I own the lexicons, records and the fixture gate. I accept the working protocol — intent +
blast radius + grep proof before C1/C2/C11, then SHA + command + exit code + one falsifiable claim
after each commit, which I try to break.

**V1 — delete-first: yes, but `jig room` is a live entry point, not a package tombstone.**
`packages/jig-cli/src/cli.ts:794` passes through to `isRoomInvocation`/`runRoom`, and
`init.ts:1164–1173` offers a room when it detects one. C1 must remove the passthrough and the
init-branch in the same commit as the package, or `jig room` becomes a crash instead of a message.

**V2 — Effect 4.1.4 at C3: no.** New packages only (`bench-*` need Domain + Alchemy). Bumping the
*shipped* tools — `protocol`, `cutlist`, `jig-cli`, `mailbox` — before C7 is paying the workspace's
largest risk (catalog pin, `AGENTS.md`: never a caret) before the replacement's only externally
-defined deliverable exists. They bump at C10/C11, isolated. Falsifiable: `pnpm -r why effect` shows
both versions; `pnpm check` green in both states.

**V3 — and this is my third veto condition: acceptance by plumbing instead of by refusal.** If C6 is
accepted because the directory appeared on the other side, or C7 because our two servers exchanged a
message, the two hardest properties are untested. Each milestone's acceptance must be a **refusal**
first — C6: the stale writer is refused with both hashes and nothing is deleted; C7: `LeaseMismatch`,
`Conflict`, `Retired`, `RoleUnresolved` each produce *his* error name from *his* fixture. Falsifiable:
delete the happy-path test and the milestone is still green.

**V3 is the one I care about.** It adds no scope and changes what done means.

**Open question:** for C7, does the Rat King instance run locally from a checkout, or against the
hosted service? My vote: local checkout, pinned SHA, because a hosted instance can change under a
claim and then the fixture gate is measuring somebody else's afternoon.
