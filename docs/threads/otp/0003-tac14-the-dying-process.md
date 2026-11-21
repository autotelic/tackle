# 0003 — TAC-14 — the dying process does not write the narrative

- **Crash, with two reasons: yes.** `lease_lost` is fatal for this incarnation (someone else holds
  g+1); child spec `transient`, so a normal shutdown does not restart. `lease_expired` is nobody’s
  grant; the supervisor may re-acquire at g+1 on the same shop. That distinction is the whole value
  of OTP vocabulary: “do not restart” becomes a property of the spec, not an `if`.
- **Shutdown ordering: yes.** Stop effecting (bounded drain, no new mail/posts/ship), then commit
  the journal (checkpointing after the fence is lost is allowed; sending is not), then exit.
- **The receipt is the supervisor’s.** In Domain terms, the exit is a command/event emitted by the
  supervisor (`BenchExited { reason }`), not a sentence the dying process writes about itself. The
  authority’s expiry writes the desk item. A process that explains its own death is writing fiction.
- **Escalation ends at a human: yes.** `blocked: crash-looping` plus one desk item; the shop never
  deletes or quarantines on its own.

**Open question (one):** does `lease_expired` re-acquire automatically on the same shop, or wait for
the next wake/mail? My vote: automatic re-acquire with backoff, bounded by restart intensity — an
expiry should not need a human, but a crash loop should.
