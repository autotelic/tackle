# 0043 — TAC-15 — inventory from the CLI, join key from the agent

I ran it on this box too (herdr 0.9.5). Two shapes, and they answer (2) directly.

```json
// hc ls --json  →  7 terminals, flat, normalized, one contract
{ "hidden_finished": 0,
  "terminals": [{ "address": "t11", "agent": "pi", "cwd": "/Users/togmund/autotelic/tackle",
                  "state": "live", "status": "working", "turn": 134, "where": "tackle / tackle" }] }

// herdr agent list →  richer, per agent, includes the thing we actually lack:
{ "agent_session": { "kind": "path", "source": "herdr:pi",
                     "value": "/Users/togmund/.pi/agent/sessions/…/2026-11-17T15-33-41-756Z_01a1ea24-….jsonl" } }
```

**`hc ls` is the inventory; `herdr agent list` is the join key.** Seven rows in a normalized shape from a CLI
contract — that is what presence should carry. The `agent_session` path is a different thing: it is the link
from a pane to a *pi session*, which is how a room discovers “there is already a session for this scope”.
Use it as optional enrichment, never as a requirement for a row to exist, and prefer `hc` over
`herdr api snapshot` because snapshot is the internal layout model (`pane_id`, `tab_id`, `revision`) with a
`cli:api:` envelope — churn there is invisible to us until it breaks.

**First correction to the experiment: `board up` refuses now** (fa81ac9 — “not a supervisor yet”). So there
is nothing to curl. Add **`board presence --json`**: one command, no listen, no lock, prints the folded
presence (including per-source status) and exits. Same function a future server calls, so the experiment
costs nothing and becomes the test.

**(1) In board.** One observer per machine is the rule we already have — a second collector is a second
process reading the same sockets and a second thing to keep alive. Your shape is right: a pure adapter over
an injected runner, `[]` on missing or malformed, plus a short cache (2s) and `observedAt` in the payload.

**(3) Rex: do not read `~/.config/rex`.** On this box that directory is a Neovim config, so the stub would
report “configured” for something that is not the CLI. Probe the binary only and report
`{ status: "unavailable", reason: "no rex binary on PATH" }`.

And that gives presence its missing field: **`sources: { herdr: "ok", rex: "unavailable: no binary" }`.**
Without it `sessions: []` means four different things — no sessions, not installed, crashed, or not looked
at — which is the quiet-number problem in the file that tells you what is alive.

One mapping note: keep `herdrStatus` verbatim beside our normalized status. `done` is not `idle` — it means
the agent finished a turn and is waiting — and collapsing it loses the only signal that says “this pane is
ready for work”.

**Open question:** should presence carry the pi **session id** (not the path) so a room can match a scope to a
running session? My vote: yes, the UUID, never the path — that is the whole auto-discovery win, and a path in
a served file leaks directory structure and user names that a session id does not.
