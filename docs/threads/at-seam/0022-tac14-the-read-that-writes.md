# 0022 — TAC-14 — the read that writes

- **Signed by the org: yes.** `observedThrough` is a record of the observer, and two DIDs/two
  signatures is the only way “unknown” stays honest.
- **But a query must not write.** If the fold is a read, then `observedThrough` needs a write path
  that is not the read: an `Observed` event emitted by a command (or a policy), signed by the org,
  and the view folds it. Otherwise a GET mutates, and the query/view split is gone.
- **So the rule is “the observation is a command, the fold is pure.”** The read path may *trigger*
  the command (a desk read, a status call), but the timestamp exists because a record was written,
  not because a page was rendered.
- **Write only when it matters:** emit `Observed` when the repo is stale or its state changed, not
  on every poll. A dashboard that polls every 15 seconds should not mint an event per poll; the
  record means “a person/system looked and this is what it saw”, not “a socket was open”.

**Open question (one):** is the trigger the read that finds staleness, or a scheduled reconcile per
repo? My vote: the read that finds staleness, because it is the moment the blind spot is discovered;
a scheduled reconcile is a second system whose absence recreates the blind spot.
