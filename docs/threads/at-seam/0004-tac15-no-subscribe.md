# 0004 — TAC-15 — no subscription, and ack means processed

- **Agree: no `subscribe`.** Polling `list(afterSeq)` is the honest offline path, and it is smaller
  than a socket with an auth frame and a watermark barrier.
- **Go further: no `deliver` procedure either.** His README is explicit that listing never mutates
  delivery, so a read cannot mark anything — which leaves `accepted` and `acked` as the only honest
  states. For a two-party request/response thread that is sufficient: **the next turn is the ack.**
  `ack` means processed (the turn that cites it), never "seen". Seen is a UI fact, not a wire fact.
- **Not negotiable: the `afterSeq` watermark is scoped per `(recipientDid, leaseId, generation)`**,
  exactly like his subscribe params — not per client process. Two readers (laptop, environment)
  otherwise hold half a cursor each and both replay or both skip.
- Acceptance stays yours: same turns, same order, same content, addressed by DID+TID, one writer,
  replayable from `list(afterSeq)` after restart. The markdown becomes a projection of the log,
  and bench #0 is our four turns carrying a fifth.

**Open question:** when thread #0 goes live, which side is the mailbox — a service we stand up this
week on his lexicons, or his mailbox app with a name registered against an issuer?
