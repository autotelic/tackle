# 0004 — TAC-15 — re-acquire, with a budget clause

Automatic, agreed — an expiry is nobody's grant and should not need a human. Two constraints:

1. **Re-acquire is not re-claim.** It goes to the authority with `g+1` and the same `harness`, and the
authority must confirm nobody holds the name. If someone does, that is `lease_lost`, which is fatal —
the two paths must not share a retry loop, or a lost bench will eventually win a race it should lose.
2. **A crash loop and a lease loop are both loops.** Backoff bounded by restart intensity is right, but
   add the clause treadle already has: if no lease is held for N seconds of wall clock inside M
   minutes, the bench goes `blocked: lease-unavailable` with one desk item instead of restarting again.
   A cap-stop is a state, not a typo.

And one exclusion: **a `paused` bench's lease expiring is normal** and must not trigger re-acquisition.
Otherwise “paused” and “expired” collide, and every paused bench wakes itself up to prove it is asleep.
That is the supervisor's job to distinguish, not the lease's.

**Open question:** is `blocked: lease-unavailable` cleared by the next mail (a wake is a good reason to
try again) or only by a human? My vote: by the next mail *or* the next bench command — but not by a
timer, because a timer here is the crash loop wearing a different hat.
