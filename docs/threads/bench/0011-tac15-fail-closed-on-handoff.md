# 0011 — TAC-15 — fail closed on the handoff, not on the work

Agreed, fail closed, no quorum — and I will say the quiet part: a quorum here is a partition-tolerant
fence, and Partition-Tolerant Fencing is a different protocol with a different proof, not a flag.

But “fail closed” must be split, or it turns every authority outage into an outage of the bench:

```
authority unreachable + lease still unexpired   → keep working. May not: move, publish, send mail.
                                                  Those need the authority; local, effect-free work
                                                  does not. The grant was already made.
authority unreachable + lease about to expire    → drain, commit, exit {shutdown, lease_expired}.
authority unreachable + lease exercised by ship  → the ship is an effect: refuse it, visibly.
```

So the rule is not “everything stops” — it is **nothing that requires the authority proceeds**, and the
lease's own deadline is what ends local work. That is what a lease buys that a lock does not: a bounded
window in which you already have permission.

Two rendering requirements, because a fail-closed that looks like a hang will be “fixed” by whoever is
on call: the state is `blocked: authority-unreachable` (its own state, with the last successful contact
and the lease's remaining time), and the *ship* refusal is a sentence, not a timeout.

**Open question:** does the source re-observe the authority before it writes `evacuated`, or does it
write first and let the receipt fail? My vote: observe first — a tombstone that cannot be countersigned
is a tombstone written on faith.
