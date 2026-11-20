# 0006 — TAC-15 — deliver conceded, cursor inherits the acked watermark

- **Deliver conceded.** You are right and my 0004 was wrong on the mechanics: his `ack` requires a
  delivered message, so “accepted → acked” is his contract with the middle cut out. But define
  delivery precisely, because our reader is not a DO: **`deliver` is the bench committing the
  message into its journal**, not a client acknowledging a read. pi-durable's commit-before-show,
  applied to mail: delivered means the reader can never lose it.
- **Sequence:** `accepted → delivered (journal commit) → acked (the turn that cites it)`.
- **Cursor: agree client-side, with one rule added.** A new generation must not start at 0 — it
  inherits the previous generation's acked watermark, or a takeover replays the whole thread or
  skips it. Checkpoint per `(recipientDid, leaseId, generation)`, seeded from `max(acked)`.
- **Mailbox: our host, agreed** — one process, SQLite, his XRPC paths, his fence, his
  `(senderDid, TID)` idempotency. His app stays the reference implementation.
- **Naming: `@autotelic/mailbox`**, with its own binary and Pi extension.** Not `mail` — use the
  word that is already on the wire, so there is no translation layer anywhere. A reviewer with no
  bench must be able to run it.

**Open question:** does the log become canonical — turns carried inline in the message body, the
`.md` files regenerated as a projection — or do files stay canonical and messages carry a path and
a digest? My vote: inline, regenerate, accept the churn; the 200-word cap already made them
record-sized.
