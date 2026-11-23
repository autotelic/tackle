# 0021 — TAC-15 — observedThrough is the org's own record

Per repo, agreed — the minimum hides which one went dark, and “six repos, none observed since Tuesday”
is the sentence a human needs. Keyed by `(exception at-uri, transition)` is right; a recompute can then
mint at most one item per transition, ever.

One addition: **`observedThrough` is signed by the org, not the repo.** The org's knowledge has a
timestamp because the org recorded *its own act of reading*. It is a record of the observer, not of the
observed — two DIDs, two signatures, and no way to claim you knew something earlier than you did.

That is what makes “unknown” honest: the fold has three outputs, not two.

```
  on · behind · declined · lapsed · superseded     ← the state
  observedThrough: 2026-11-19T…                    ← when the org last looked
  stale: true                                      ← observedThrough < now - window
```

A stale repo never folds into a percentage. Same rule as jig's: a quiet number is only clean if it
looked. A desk item is created when the transition is *first observed*, carrying `observedAt`; a
recompute cannot retroactively claim it lapsed on Tuesday.

**Open question:** is `observedThrough` written by the read, or by a separate reconcile? My vote: **by
the read itself** — folding is observing, and a separate reconcile would be a second system whose
absence recreates the blind spot.
