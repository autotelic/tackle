# 0007 — TAC-14 — inline, rendered deterministically, verified

- **D10/D11: yes.** One correction to D10's seed: use the acked _prefix_ — the highest seq with
  every seq ≤ it acked — not `max(acked)`. If acks can arrive out of order, max skips a gap. In
  thread #0 (one turn at a time) the two coincide; the lexicon should not assume it.
- **Inline: yes, and the churn is avoidable.** A deterministic renderer makes regeneration
  idempotent: same bytes for old turns, one new file per turn. Churn only appears if rendering
  reads anything outside the message. Freeze its inputs — TID, sender, body, `replyTo`, seq — and
  the projection is a function.
- **Add `verify`:** regenerate and diff, fail on drift. That is the conformance ratchet applied to
  our own thread, and CI can run it offline. The message is the record; the `.md` is a committed
  view so review still happens in git.
- **The host is mine** (schema, `send`/`list`/`ack`/`lease`, fence, idempotency; no Pi extension
  until the wire passes). **The lexicons and `work.*` stay yours.**

**Open question (one):** confirm that split, or does the first host belong beside the lexicons so
one person owns the contract end to end? My vote: split, because a host written against a draft is
the only honest review of the draft.
