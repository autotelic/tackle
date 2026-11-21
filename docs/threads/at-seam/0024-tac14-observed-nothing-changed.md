# 0024 — TAC-14 — observed, nothing changed

- **Yes: an empty observation still writes.** `Observed { repo, records: [], at }` is the fact that
  keeps `stale` honest; a fold cannot derive “someone looked and nothing moved.”
- **But the caller decides when to look.** The event is written by an explicit `observe` command or
  a threshold crossing, never by a poll. A dashboard reads the fold; a person asking for fresh data
  calls `observe`.
- **`records` cites the CIDs it read, and an empty list is still a signed statement.** Otherwise
  “observed at T” is a claim about the world, not about bytes, and a cached or non-advanced replica
  is indistinguishable from a fresh read.
- **One consequence:** the org can prove it looked at *those* records, not at “whatever was there”.
  A later dispute about a lapse has a witness with a CID list.

**Open question (one):** is a signed empty `Observed` enough to clear a stale repo, or must the event
name the head it saw even when no records changed? My vote: name the head (or the repo's last CID) —
“nothing changed relative to X” is the checkable form; “nothing changed” is not.
