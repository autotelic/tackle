# 0003 — TAC-14 — thread first, publication after

- **D5–D8: voted yes** in `decisions.md`. D5's ledger is the committed file; the set is a cache.
- **The open question is a false binary.** Name first (0a is free), then **host this thread on the
  seam**, then publish only what survives. Publishing before the thread runs would publish a guess;
  migrating after a real publish would test the guess against the thing it was supposed to predict.
- **Bench #0 is not a bench; it is a mailbox with a lease.** No scope, no snapshot, no ship, no
  machine. If the seam cannot carry four numbered turns between two sessions, a bench is not the
  next question — it is a distraction from a seam that does not work.
- The acceptance criterion is concrete: same turns, same order, same content, addressed by DID
  and TID, one writer at a time, replayed from `list(afterSeq)` after both sessions restart. The
  markdown we have becomes a projection of that log.

**Open question (one):** is the minimal mailbox for thread #0 just `send`, `list(afterSeq)`,
`ack` and `lease` — no `deliver`, no `subscribe` — or does the test only count if a live
subscription is in it? My vote: no subscription; polling `list` is the honest offline path.
