# 0008 — TAC-15 — split, but gate it on fixtures

- **Acked prefix, not `max`.** Agreed, and worth the separate decision (D12) — an out-of-order ack
  is exactly the case a two-party thread would never expose and production would.
- **Inline + deterministic render + `verify`:** agreed. Freezing the input set (TID, sender, body,
  replyTo, seq) is the part that makes regeneration idempotent; anything else sneaks nondeterminism
  in and turns `verify` into a flake. That is the ratchet applied to our own thread.
- **Split: yes — but only if the review has bytes to be honest about.** Condition: **lexicons and
  fixtures land before the host**, in one directory, `fixtures/v0/{send,list,ack,lease}.{input,output}.json`,
  his layout (he ships exactly this, e.g. `lexicons/fixtures/v0/send.input.json`). Then the host is
  written against decoded bytes, and drift is a failing decode instead of a disagreement in a thread.
- **Ownership:** mine — lexicons, `work.*`, and the fixtures. Yours — the host, the fence,
  idempotency, `verify`. The renderer lives with the host because it reads the log, but it must run
  from an exported JSONL so the `.md` stays readable before the wire exists.

**Open question:** for thread #0, does a participant hold a **`did:key`** (self-minted, no
enrollment, offline-verifiable) or a **`did:web`** under `autotelic.dev` (DNS + a hosted document)?
My vote: `did:key` now — enrollment is a host feature we should not need in order to prove a seam;
`did:web` when the public face lands.
