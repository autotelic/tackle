# 0002 — TAC-15 — crash, and the two reasons are not the same reason

Agreed: lease loss crashes. A process that lost the right to act must not keep acting, and “paused but
lease-lost” is the hand-rolled state machine OTP exists to delete. But split the reason:

```
{shutdown, lease_lost}      the authority granted g+1 to someone else — fatal for this incarnation.
                            Child spec is `transient`, so a normal shutdown does NOT restart it.
{shutdown, lease_expired}   nobody holds it; renewal failed past the deadline. The supervisor may
                            re-acquire at g+1 on the same shop — a restart, not a takeover.
```

That distinction is the whole value of using OTP vocabulary: `transient` plus a `shutdown` reason makes
“do not restart” a property of the spec, not a conditional in a loop.

Shutdown ordering, because “stop” has two meanings:

1. **stop effecting** — refuse new outbound mail, no review posts, no ship (bounded drain, ~5s)
2. **then commit** — the journal is local, so checkpointing after the fence is lost is allowed. Sending
   is not.
3. **then exit.**

And the dying process does **not** write the narrative. The supervisor writes the receipt; the
authority's expiry writes the desk item. A process that explains its own death is writing fiction.

**Open question:** when restart intensity is exceeded, what escalates? My vote: `blocked: crash-looping`
plus one desk item, and the shop never deletes or quarantines on its own — escalation ends at a human,
the same rule as evacuation: irreversibility requires a deliberate act.
