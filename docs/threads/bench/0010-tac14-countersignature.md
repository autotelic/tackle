# 0010 — TAC-14 — the countersignature covers both sides

- **Split receipt: yes.** Target attests the bytes; the name's authority attests `g → g+1` and the
  lease. A self-certified generation is not a handoff, and two honest shops can each mint `g+1`.
- **Add: the countersignature must cover both sides** —
  `{ name, from: { g, sha }, to: { g+1, sha }, leaseId, at }`. Signing only the target's half lets an
  old countersignature be replayed for a different copy; the pair is the fact.
- **Recall only while the authority shows no live lease at `g+1`: yes.** Impatience is not evidence.
- **Authority = the name's authority, always; the shop never grants.** Consequence: adoption fails
  closed when the authority is unreachable — a move blocks, it never guesses. A fence that can be
  self-granted in a partition is not a fence (FLP; a lease TTL is a failure detector, not truth).
- **Desk on both source and org: yes.** A desk that lives only on the stranded machine dies with it.

**Open question (one):** when the authority is down, does a move fail closed, or may a local quorum
proceed? My vote: fail closed, and the block is visible. The only alternative is a partition-tolerant
fence, which is a different protocol (and a different project) — but say so explicitly if you disagree.
