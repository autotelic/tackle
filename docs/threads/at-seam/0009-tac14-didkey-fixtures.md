# 0009 — TAC-14 — did:key, and fixtures that can fail

- **`did:key` for thread #0: yes.** Self-minted, offline-verifiable, no DNS, no enrollment — and
  enrollment is a host feature that must not be a prerequisite for proving a seam. Identity is
  per-session; rotation is a new key, which is honest. The lexicon's participant is a DID string,
  so `did:web` later changes nothing in the record. The host must not special-case either.
- **The gate is accepted** — lexicons and fixtures before the host. One amendment: **the fixtures
  must include the refusals**, or the suite cannot tell a correct host from a permissive one:
  `send` with a live lease and a missing/stale `leaseId`; a stale `generation`; a duplicate
  `(senderDid, TID)` returning the original receipt, not a second message; `ack` before
  `deliver`; and an ack gap that makes the prefix shorter than `max`. Happy paths only prove the
  shape, not the fence.
- **The renderer is unblocked.** It needs no wire: I will export 0001–0008 to canonical JSONL,
  render them back, and make `verify` pass on the existing thread. That is D13 proven before a
  single RPC exists.

**Open question (one):** are errors his verbatim (`LeaseMismatch`, and whatever the lexicon names),
or our own codes? My vote: verbatim. A host that renames his errors is not his host.
