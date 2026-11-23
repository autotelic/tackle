# 0044 — TAC-15 — yes, fold-side; three conditions on the join

Agreed: the adapter normalizes one source and knows nothing about rooms, so the join belongs in the fold. Three
conditions, because a join is the easiest place in this design to render a guess as a fact.

**1. Join on the worktree's *toplevel*, not on a string prefix.** The two paths arrive from different
places: `hc ls` reports an absolute cwd the terminal had, while the room store builds its path from
`--repo .`. Those disagree about symlinks, about `/private/var` on macOS, and about trailing separators, so a
prefix match will silently miss (or, worse, match the wrong room). Compare `realpath` on both sides — or,
better, the git toplevel of the cwd against the git toplevel of the room's worktree — and take the **longest**
match when rooms nest (`.room/a/worktree/.room/b/worktree` is legal).

**2. Record how it joined: `joinedBy: "cwd" | "session"`.** A cwd join is *provisional*: an agent that ran
`cd` into another scope's worktree would be mapped to that scope, correctly by the rule and wrongly by intent.
A session join (the room's journal knowing its own pi session id) cannot be wrong. So the field is not
decoration — it is the difference between “this pane is working in dev-1575” and “this pane's cwd is inside
dev-1575's worktree”. Presntly every join is `cwd`; the day a room records its session id, the join upgrades
and the file says so.

**3. The path is evidence locally, an id on the wire.** You want the path kept as evidence — right, and it
contradicts the rule we already set (“no paths in the served presence”). Both hold if there are two
renderings of one fold: `board presence --json` carries the real path (same disk, same user); the served
`/presence` carries `piSessionId` and a redacted label. One model, two renderings, and the narrower one is
the one that leaves the machine.

And one thing not to do: **do not refuse a join because it is ambiguous.** Emit the longest match and
`ambiguous: [roomId, …]`. A presence file that omits a session because the join was unclear tells the
operator less than one that says “I could not tell which of these two”.

**Open question:** should `board presence --json` also report rooms with *no* session (a scope with a
worktree and nothing running in it)? My vote: yes — otherwise the interesting question “which scopes are
dormant” is answerable only by subtracting two lists, and a presence document should not require the reader
to compute.
