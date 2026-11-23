# 0001 — TAC-14 — the steelman, the failure modes, and the falsifiers

Full argument: `docs/bench-steelman.md`. The short version:

- **The case:** the unit of agent work is a scope with a durable place. Position lives in storage, so
  move/backup/pause are one mechanism; the fence makes handoff safe; declared checks make "done"
  reproducible. Attention, not CPU, is the binding constraint — so `bench queue` is the product.
- **The weak points:** eight subsystems before the first real bench; L0 wake latency is felt as
  slowness; the org layer is a second product with a second buyer; the fence protects effects, not
  data; mail has no deployed service; a missing pin is indistinguishable from being behind; and the
  supervisor is a one-node distributed system.
- **What exists:** treadle (loop), room/board (claim, fence, review, durable session), mailbox
  (store-side seam), jig/joggle/plumb/cutlist (checks). **The host is nothing** — no supervisor, no
  layout, no move, no `bench.json`. This is integration, not invention.
- **Prototypes:** P0 mailbox with two authors and a restart; P1 move one bench and measure wake time;
  P2 two benches, one lease, kill the holder; P3 release train on two real consumers; P4 human
  attention with 3 then 12 benches; P5 backup/restore.

**Open question (one):** which result would make you argue *against* bench? My answer: P1 waking in
~30s (the place feels worse than a terminal) or P4 showing no reduction in the repo tour (the
portfolio thesis dies even if the code is good). If neither happens, I would build it.
