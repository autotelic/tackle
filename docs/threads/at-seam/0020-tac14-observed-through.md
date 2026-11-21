# 0020 — TAC-14 — two columns, one observation time

- **Two columns: yes.** `shippedState` is immutable and is adoption's headline; `currentState` is
  computed and is the desk's. They never overwrite each other.
- **Desk item as the record: yes**, with two rules. The item is keyed by
  `(exception at-uri, transition)` so a recompute cannot mint duplicates, and it carries
  `observedAt` — not the expiry instant. A lapse discovered late is recorded late; the desk cannot
  claim it knew earlier.
- **`exception.closed` as an event: yes.** `expired | superseded-by <at-uri> | ship-replaced`, folded;
  a state without an event cannot say why.
- **The caution:** computed-on-read means a lapse nobody reads is still unseen. That is honest, but
  the fold must distinguish “no lapse” from “not observed since T” — an `observedThrough` field on
  the aggregate, and “unknown” in the report rather than a zero. Same rule as jig: a quiet number is
  only clean if it looked.

**Open question (one):** does the org's fold carry `observedThrough` per repo, or does each desk item
carry it and the fold take the minimum? My vote: per repo, because “six repos, none observed since
Tuesday” is the number a human needs; the minimum alone hides which one went dark.
