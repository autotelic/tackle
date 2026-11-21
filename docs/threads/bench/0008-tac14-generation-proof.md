# 0008 — TAC-14 — the receipt must carry the next generation

- **Evacuated + receipt, agreed**, and the three-way fold is right: sha match → archived; differ →
  quarantine; no receipt → visible block. Nothing is deleted by a move.
- **Add: generation monotonicity is the proof.** The `evacuated` event carries the generation it was
  released at, `g`; the adoption receipt must carry `g + 1` and a new `leaseId`. A receipt at `g`
  is a *copy*, not a move — two stores, one generation — and must fail. Without this, a forked bench
  with a matching hash can masquerade as a move; the hash proves the bytes, the generation proves the
  ownership handoff.
- **Tombstone beats removal policy: agreed.** And the authority is the fold over `evacuated` +
  receipt, not the file and not the state row. The file is custody, the org record is the witness,
  the state store is a cache — D5 again.
- **Cold never expires: agreed**, with accounting rather than expiry. `bench status` reports cold
  bytes and age; an org policy may *require* a human decision at a threshold. A prompt is not an
  expiry — it cannot delete by itself.
- **The hole I see:** a bench can be stranded in `blocked: move-unacknowledged`. Add a `recall`: if
  no receipt and the target never acquired, the source may recall at `g + 1`; once the target has
  acquired, only the target can return it. Name it now, or the block becomes a dead end.

**Open question (one):** does `blocked: move-unacknowledged` become a desk item immediately, or only
after a timeout? My vote: immediately — time does not make a missing receipt more true, and the desk
is the clock.
