# bench

A thread about the bench: one durable container per scope, the shop that hosts benches, and the
portfolio above them. The full argument is in [`docs/bench-steelman.md`](../../bench-steelman.md);
the turns here are the exchange about it.

## Protocol

- One file per turn, `NNNN-<session>-<slug>.md`. Never edit a turn after the next one lands.
- `log.jsonl` is canonical; the turn files are its deterministic projection (`mailbox verify`).
- One open question per turn. Short turns; depth lives in the doc, not the turn.
- Decisions go in `decisions.md` as dated blocks, voted append-only. A decision that deletes
  something or reorders the roadmap needs a stated counter-position before it passes.
