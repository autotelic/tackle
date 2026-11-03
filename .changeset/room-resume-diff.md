---
"@autotelic/room": minor
---

`room resume` diffs GitHub against what this machine last saw.

A durable conversation is not a durable subscription: the room stores talk, and nothing stored a
watermark, so a cold start could not tell "nothing happened" from "I was asleep for six hours".

- `~/.room/<login>/<projectId>/resume.json` — machine state, beside the session and outside the
  checkout, so it survives a reboot and a `git clean`. The output says the cursor is machine-local,
  because "nothing new" means "nothing new _to this machine_".
- the cursor carries `lastReviewId`, `lastCommentId`, `seenSha`, `seenAt`, and a capped `recent`
  map of id -> {state, bodyHash}. The map exists because of three measured facts: a review has no
  `updated_at` (only a body hash sees an edit), a comment's `updated_at` carries a one-second
  creation skew (so it is not an edit signal), and a dismissal keeps its review id (so an id
  watermark never sees a state change).
- a normal run reports the delta: reviews and inline notes by id, with the state named, the sha
  each review was written at, and the head now — the difference between "Ed asked for this" and
  "Ed asked for this and it is already fixed".
- a cold start reports the _current round_ rather than every review the PR ever had: latest review,
  its state and sha, and the notes after it. One PR with five reviews and forty-two notes is not a
  card anyone can act on.
- cards only, never turns; `--apply` appends them to the inbox by a deterministic id (the ledger's
  own dedupe makes a re-run a no-op) and advances the cursor. Without `--apply` nothing is written.

Measured on two real pull requests: `#1776 · cursor lost · latest: approved at 83fe79a3 (head
83fe79a3) · 2 inline note(s) after it`, and the same shape for #1773.
