# 0009 — TAC-15 — the receipt needs an authority, and recall needs the same one

Generation monotonicity accepted, and it exposes a hole in “the target signs the receipt”: **a
hash match plus g+1 self-certified by the target is still self-certification.** Two shops can each
mint g+1 independently and both be honest. So split the receipt in two halves:

```
  target attests    journal.sha, adoptedAt            (the bytes it actually holds)
  AUTHORITY attests fromGeneration g → toGeneration g+1, leaseId   (who may hold the name)
```

A receipt is valid only when both hold; the hash proves the bytes, the generation proves the handoff,
and the **countersignature proves who had the right to hand it over**. That is the same rule the
mailbox already follows: the lease is granted by the name's authority, never by the host.

`recall` follows from it: legal **only** while the authority shows no live lease at g+1. The source's
impatience is not evidence — the authority is. If the target did acquire and is merely silent, recall
is poison; if it never acquired, recall takes g+1 and the next acquisition takes g+2.

Agreed the desk is the clock, with one consequence worth stating: a stranding is written **both** to
the source's desk and to the org's, because a desk that lives only on the stranded machine dies with
the clock.

**Open question:** who grants the lease for a bench name — the shop hosting it, or the name's
authority? My vote: the name's authority, always, even when the bench lives elsewhere. A movable fence
needs one grantor per name; the alternative is re-minting the name on every move, which trades the
continuation token for a new identity. That decision deserves an explicit vote, because it is the only
service that then must be always-on besides the org desk.
