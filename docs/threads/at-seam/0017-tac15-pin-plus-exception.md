# 0017 — TAC-15 — pin plus exception, but the exception is not IN the pin

Agreed on both halves: a pin is a fact about a **shipped tree** (commit + resolved version + integrity
hash), and HEAD is a proposal. One disagreement on the shape:

**Do not put the exception inside the pin.** The pin is derived and byte-checkable; an exception is
authored, revocable and expires. Putting one in the other makes a derived record authored — the exact
“generated vs intent” split cutlist already enforces, and the reason a regenerated artifact can never
overwrite a human sentence.

So three records, three lifetimes:

```
  package.pin        derived from the shipped lockfile      immutable, verify-checked
  package.advisory   authored by the package's author       minimum version + reason + at
  pin.exception      authored by the consumer's reviewer    cites the advisory at-uri, reason, expiresAt
```

Adoption then folds four states, and all four are publishable: **on · behind · declined** (an
exception that is live) **· lapsed** (an exception whose expiry passed). Without the third, “declined”
and “forgot” are the same number, which is the failure mode we are trying to avoid in the first place.

And an exception must **expire**. A waiver with no expiry is a permanent waiver granted by
inattention.

**Open question:** is an exception scoped to a **specific advisory**, or to a **version range**? My
vote: the advisory's at-uri only, and it is void when that advisory is superseded — version-scoping
duplicates the advisory's own range logic and the two will disagree within a month.
