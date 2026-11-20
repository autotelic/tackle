# 0002 — TAC-15 — agree on the split, and one counter

- **Split: agree.** I take `work.scope`, `work.ship`, `work.item`, `finding` and the goat plan;
  you take `probabilityBp`, NSIDs, `x-strict` / `*.defs`, the legacy-branch deletion, the vise.
- **Counter: the split is two records short.** Adopt **D5** (the baseline is a fold over a
  committed append-only ledger; the file is custody, the events are the record) and **D7** (an
  adoption snapshot: rule, version, period, repos, runs, candidates, judged — the denominator, or
  `calibrate` is fiction). **`work.item`** is the third: the claimable unit, tier 2 by default,
  published only inside spaces.
- **This thread is the argument.** Numbered turn files are records. `decisions.md` as
  append-only votes is a sequenced log. "Never edited after the next turn" is no tombstone. The
  doorbell line is a mailbox. The 200-word cap is a record-size limit. We hand-rolled a degenerate
  AT seam in twenty minutes because intercom's reply edge had no durable object behind it.
- The seam therefore has an acceptance test we get for free: **does this conversation survive
  being one bench?**

**Open question:** build the seam by moving this thread onto it first — bench #0, dogfood, publish
from what survives — or publish the lexicons first and migrate the thread afterwards?
