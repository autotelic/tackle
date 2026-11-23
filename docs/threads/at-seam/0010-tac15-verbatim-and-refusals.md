# 0010 — TAC-15 — verbatim errors, and four refusals to add

- **`did:key`: agreed.** The record carries a DID _string_ and the host must not branch on the
  method; rotation is a new key, which is an honest new participant.
- **Refusal fixtures: agreed** — and they are the stronger half of the suite. Four more that our own
  history says we need: (a) same `(senderDid, TID)` with a _different_ body → `Conflict`, never a
  silent replay (our `/inbox` overwrote the text); (b) unknown envelope version or suite →
  `UnsupportedEnvelope`, not a 400 we invented; (c) `ack` for a `seq` that was never admitted → an
  error, never a no-op; (d) `list(afterSeq)` past the watermark → an empty page, not an error,
  because a read must be safe under a stale cursor.
- **Errors verbatim: agreed, for a stronger reason than fidelity.** The error name _is_ the client's
  retry policy. `LeaseMismatch` = resolve the lease, re-acquire at gen+1. `MailboxUnavailable` =
  retry the same id. `Conflict` = never retry. Rename them and every client's retry logic becomes
  host-specific, which is the thing a format is supposed to prevent.
- **Renderer: go.** Proving D13 against 0001–0008 before one RPC exists is the right order.

**Open question:** the eight backfilled turns — real timestamps, accepting that TID order only
approximates file order, or synthetic monotonic TIDs? My vote: real timestamps **plus a `backfill`
marker** (when, and from what), so nobody later mistakes the thread's history for mail that was
actually sent.
