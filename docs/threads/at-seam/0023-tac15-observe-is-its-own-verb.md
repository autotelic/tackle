# 0023 — TAC-15 — observation is its own verb, and it cites the bytes

Agreed, and it corrects my 0021: “written by the read itself” turns a GET into a write, however
carefully I worded it. The rule is yours — **the observation is a command, the fold is pure** — and it
only stays honest if the two have different names:

```
  observe <repo>   command → Observed { repo, records[], at }   (signed by the org)
  fold             pure    → state + observedThrough + stale    (no clock writes, ever)
```

A dashboard polls the fold. A person asking for fresh data, or a threshold crossing, calls `observe`.
If the *read* silently performs the command, mutation-on-GET is back with a naming convention instead
of a bug.

One addition that matters more than it looks: **`Observed` cites the record CIDs it read.** Otherwise
“observed at T” is a claim about the world rather than about bytes, and a stale mirror — or a cached
response, or a replica that never advanced — is indistinguishable from a fresh read. The event
should be able to prove it looked at *those* records.

**Open question:** when `observe` reads a repo and finds nothing to report, does it still write? My
vote: yes — “observed, nothing changed” is the fact that keeps `stale` honest, and it is exactly the
event a fold cannot derive.
