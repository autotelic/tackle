# 0045 — TAC-15 — `hc ls`'s cwd is the terminal's, not the agent's

I probed one terminal and it changes the join:

```json
// hc get t11 --json  (abridged)
{ "address": "t11", "cwd": "/Users/togmund/autotelic/shakti-v2",
  "foreground": { "argv": ["pi", ""], "cwd": "/Users/togmund/autotelic/tackle", "pid": 59992 },
  "status": { "app": "pi", "state": "done" }, "turn": 135,
  "labels": { "herdr.seen": "134", "herdr.tab": "…", "where": "tackle / tackle" } }
```

`cwd` is where the **terminal** was spawned; `foreground.cwd` is where the **agent** actually is. For t11 they
differ. Your one-shot reported `cwd: /…/shakti-v2` for a terminal whose pi agent is in `tackle`, so the fold is
joining on the wrong path — and it is wrong for exactly the terminals we care about (the ones that cd'd into a
worktree).

Two other things the same probe gives us:

**1. Labels are the join we should be using.** `hc label <t> k=v...` exists, and `hc ls --label K=V` filters on
them. So the room stamps the terminal it spawns:

```
  hc label t11 room=acme-web~dev-1575 leaseGenerationHint=7
```

and presence reads `labels` — exact, cheap, no realpath, no symlink games, no nesting ambiguity. The join
becomes `joinedBy: "label"`, with `foreground.cwd` as the fallback for terminals that predate the convention.

**2. Do not hash `piSessionId`.** The UUID is already the basename:
`…_01a1ea24-7afc-7618-a125-97f46d2abc32.jsonl`. That UUID is what a room's journal can record and compare —
it is an identifier, not a path, and it leaks nothing. Hashing the *basename* would fold the timestamp and the
extension into the value, so the same session would hash differently the moment pi renames the file, and it
would stop joining to anything. Extract the UUID; hash nothing.

**But the enrichment may not be worth building yet**, on evidence: `herdr agent list` takes no flags and
returns the **focused** agent only, keyed by `terminal_id` / `pane_id` — and `hc get` exposes neither
(it has `pid`, `address`, `title`, `labels`). So the cross-tool match would have to be by `terminal_title`,
which is fragile. There is a stronger path that needs no mapping at all: **when a room spawns an agent it
records the pi session id itself**, so the join is `joinedBy: "record"` — perfect, and ours. Herdr enrichment
then only helps foreign terminals, and can wait until it has a real key.

So the order I would ship: labels (exact, ours, today) → `foreground.cwd` fallback → session record when rooms
spawn → herdr enrichment last, if ever.

**Open question:** should the room stamp the label at spawn — mutating herdr's own terminal metadata — or
should presence stay a pure reader and treat labels as something a human sets manually? My vote: stamp it.
A label is the terminal's own metadata, not a second registry, and it is the only exact join available today.
