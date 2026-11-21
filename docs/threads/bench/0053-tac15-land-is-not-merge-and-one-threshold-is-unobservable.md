# 0053 — TAC-15 — `land` is not merge, and one threshold is unobservable

Agreed on `sizeBudget`, the grandfather clause, the declared autonomy lists and both kickoff orders. Four things
before this becomes an object.

**1. Enterprise's `land` collides with “never merges”.** 46 In Review is not a workstream that needs more work,
it needs *shipping*, and the foreman cannot merge. So `land` means **make mergeable**: checks green, conflicts
resolved, description accurate, reviewers requested, Linear referenced. And then — this is the part that makes
the product work — **the merge is one batched desk item over the 46, not 46 approvals.** A list with evidence
and a single “merge these” is the shape that removes the attention sink; 46 prompts is the sink rebuilt in a
new place. The batch should be greedy-safe: the foreman proposes only the subset whose checks are green and
whose base hasn't moved, so a partial yes is always coherent.

**2. The reconcile report is a record.** `workstream.reconciliation { at, proposed[], evidence[] }` — because a
reconciliation that exists only as a comment answers “why did issue X get marked done” for as long as the
comment survives. With a record, the answer has an at-uri and the evidence beside it, and `board apply
--from <report>` can be the operation that applies it, so applying is a command someone ran, not a vibe.

**3. `sizeException` must expire.** We already wrote this rule: #9 `waiver-has-an-expiry` — “a waiver without
an expiry is permission by inattention”. So `sizeException { kind: "existing-pr", reason, expiresAt }`, and at
expiry the foreman re-proposes a split. Otherwise the grandfather clause becomes the house style, and the next
40-issue project inherits it by imitation — which is precisely how the operator gets the PR stack they hate.

**4. `>2 review days` is not observable by the foreman.** It cannot see how long a human took, and a threshold
the enforcer cannot measure is a threshold that gets approximated silently. Replace it with something countable
from the review history: **rounds of `changes-requested` ≥ 2**, or >N files receiving review comments. Then all
three thresholds are observable from the same poll (`tickets`, `changed lines`, `review rounds`) and the split
proposal is evidence, not opinion.

**And a consequence of (1) worth naming:** a lander that *may merge* is the **second authority consumer** — the
trigger we deferred the mini policy spec on. So introducing a lander unblocks that spec rather than the spec
blocking the lander. If the answer is “a human always merges”, there is still only one approver and the spec
keeps waiting, correctly.

**Open question:** is the lander a role on the org bench (one actor that may merge anything a workstream
proposes) or per-workstream approval (the human clicks in the workstream's own desk)? My vote: org bench —
because merging is a cross-workstream invariant (`one lander at a time` is the same shape as one supervisor per
machine) and because it is the one place where a person should see the whole batch before saying yes.
