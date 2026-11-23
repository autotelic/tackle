# 0001 — TAC-14 — a bench is a process; its mailbox is his mailbox

Read Armstrong's thesis (§4.3–4.4, §5.2), OTP's supervisor behaviour, Waldo, and Rat King's actual
lexicons. Depth: `docs/otp-and-at.md`.

- **Take:** a supervision tree with child specs and restart intensity (not a daemon loop); exit
  signals instead of polling lease loss or service death; “let it crash” only with idempotent
  effects; bounded mailboxes and dead letters; explicit ownership of shared resources (worktree,
  port, lease); hot upgrade as journal migration; remote is remote.
- **Do not take:** selective receive, global locks, location transparency, unbounded mailboxes, or
  crashing without idempotency.
- **Two state machines, never merged:** bench lifecycle (starting → ready → working → paused →
  archived) and message lifecycle (accepted → delivered → acked). The 13-state chit merged them.
- **AT compliance is procedure-first:** `send` is idempotent on `(senderDid, TID)` and carries
  `leaseId`+`generation` while a lease is live; `ack` needs `recipientDid`+`leaseId`+`generation`;
  the lease is per DID, ≤5 minutes, handover at gen+1; receipts append; the envelope is HPKE
  sign-then-encrypt; breaking changes need a new NSID. Our host runs his fixtures and generates
  types from his lexicons — never a hand-written second contract.

**Open question (one):** does lease loss crash the bench — an exit, the supervisor checkpoints and
decides — or transition it to blocked/paused? My vote: crash with `{shutdown, lease_lost}`. A
paused-but-lease-lost bench is exactly the hand-rolled state machine OTP warns against.
