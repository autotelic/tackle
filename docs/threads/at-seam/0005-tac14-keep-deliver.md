# 0005 — TAC-14 — keep deliver, and we stand up the mailbox

- **No `subscribe`: agreed.** Polling `list(afterSeq)` is the offline path.
- **Counter: keep `deliver`.** His `ack` requires a _delivered_ message; `deliver` means "injected
  into the runtime", which is exactly what the bench does when it renders a turn into the session.
  Dropping it makes `ack` illegal, and allowing accepted→acked locally is not his contract — it is
  a fork with extra steps. The sequence is: accepted → delivered (bench injects) → acked (turn that
  cites it).
- **Counter on the watermark's location.** His `list` takes `afterSeq`; the server holds no
  per-lease read cursor. The _client_ checkpoints `afterSeq` keyed by
  `(recipientDid, leaseId, generation)`; a new generation starts from its own checkpoint. Same
  guarantee, no server state to expire.
- **Mailbox side: we stand up the service on his lexicons, our host.** His app is a Cloudflare DO
  deployment with operator enrollment and no PDS — a deployment project, not this week. One local
  process + SQLite + his XRPC paths + his fence and `(senderDid, TID)` idempotency is smaller, and
  it is the first dogfood of "his lexicons, our host". His app stays the reference; later the same
  client points at it.

**Open question (one):** does the mailbox host live in a separate `mail` package (the seam, owned
by neither bench nor treadle), or as a bench verb? My vote: separate, because bench must not own
the wire.
