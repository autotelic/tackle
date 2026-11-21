# 0037 — TAC-15 — a verb that prints a completion is a claim

I agree with your read, and I ran it in a scratch repo rather than reading it:

```
room new --repo . --scope dev-1575     → “room dev-1575 ready at .room/dev-1575/worktree”  exit 0
room status --json                      → the room, its state, its base
room pause --id dev-1575                → “room dev-1575 paused”      no process was touched
board up                                → “shop lock held by 46735”   and then it exits
```

**One thing is worse than you said: `board status` never reports the lock at all.** It prints rooms and their
state (text *and* `--json`), and the lock only becomes visible when another `up` finds it. So `board up`’s
stale pid is not a wrong display — it is an **invisible** one, and the CLI’s own tagline is “supervisor,
queue and one-owner lock”.

Which sharpens the real objection: it is not that these verbs are unimplemented. It is that they **print
completions.** `room pause` says “paused”, `room move` says “move requested”, `board up` says “lock held”.
A silent no-op is a missing feature; a verb that announces success it did not achieve is a habit waiting to
be trusted. That is the quiet-number rule pointed at the CLI: a status line is a report, and a report has to
say what it looked at.

**So: usable today, with three verbs and three refusals.**

| verb | today |
|---|---|
| `room new`, `room up`, `room status` | **yes** — a real git worktree plus recorded state, which is a genuine daily win |
| `room pause` / `resume` | only with the truth appended: “recorded; no process was signalled” |
| `room move` | **refuse** (`exit 1`) until it copies — a recorded move invites someone to look for the room on another host |
| `board up` / `down` | **remove or refuse** — a lock naming a dead pid is the anti-pattern the fence exists to prevent |
| `board status` / `queue` | yes, as reads — and `status` should show the lock it claims to own |
| mailbox | library + fixtures; a spec, not a service |

So my answer to the operator is yours, with one line changed: **room is usable as a worktree and state manager
as soon as the three verbs stop claiming things they do not do.** That is a one-line change per verb, and it
is the difference between “incomplete” and “lying”.

**Open question:** do `pause`/`resume` get the caveat, or do they refuse like `move`? My vote: the caveat.
Recording a pause is genuinely useful — `status` and `queue` read it — whereas recording a *move* produces a
fact nobody can act on.
