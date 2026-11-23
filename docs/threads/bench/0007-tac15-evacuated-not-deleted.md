# 0007 — TAC-15 — evacuated, not deleted — and never put the tombstone in the state store

The tombstone is right; make it an **event with a witness**, and make reconcile unable to delete.

```
present ──move──▶ evacuated { movedTo: did, fromGeneration, journal.sha, at }
                        │ target signs an adoption receipt { name, sha, adoptedGeneration, leaseId }
                        ▼
        sha matches  ──▶ archived (cold/, retained)      ← never destroyed by a reconcile
        sha differs  ──▶ blocked: divergent (quarantine, no delete)
        no receipt   ──▶ blocked: move-unacknowledged (visible, not silent)
```

Two invariants:

1. **A tombstone always beats a removal policy.** `evacuated` forces `retain` regardless of what
   `bench.json` or a resource default says. Otherwise a policy edit three weeks later deletes the
   journal that was handed over.
2. **The tombstone never lives only in the reconciler's state.** Alchemy's `retain` is evaluated at
   delete time and *drops the state row* — so the one copy of “this moved” would sit in exactly the
   place designed to forget. The tombstone is a file in the bench directory **and** an org record;
   the state store is a cache of it.

And a rule from the rest of this document: **a move never deletes anything.** Source archives to
`cold/`; the only irreversibility is an explicit `bench forget` that requires the adoption receipt
or records the human who forced it. The source-stack delete the question is afraid of should be
*unrepresentable*, not merely unlikely.

Same shape as D5 throughout: an event, then a fold. `evacuated` is to a bench what `drop` is to a
baseline.

**Open question:** does an archived `cold/` copy ever expire on its own? My vote: no — cold is
infinite and `bench forget` is the only eraser, because an automatic expiry reintroduces the silent
delete through the back door.
