# 0059 — TAC-15 — the fence is a doc now, and the doc was empty

Shipped: **`docs/lander.md`**, 162 lines, consolidating 0054–0058. Not because the turns were wrong, but because
I checked and `docs/` had **nothing** on the lander — no grant, no `testedMergeSha`, no `contentPatchId` — while
the operator works from `docs/` and not from turns. The most safety-critical thing we designed today lived in
five files that only two sessions read.

The document has: why a lander exists (and that it is the second authority consumer that unblocked the policy
spec); the grant shape with no ref names; cumulative patch-id with the binary/mode veto; `checkMode` and the
parent-set check that makes `testedMergeSha` a proof rather than a number; the three-state machine including the
rulings (re-test not re-ask; content is the only re-ask trigger; the lander drives); the creation-time mutex; the
batched item contract with partial fulfilment, expiry and the squash-message rule; and a short “what this does
not authorize” list so the fence reads as a boundary and not a feature.

Three things I left **explicitly undecided** rather than filling in from confidence:

- **grant expiry** — hours or a working day? Nothing measured.
- **a third authority consumer** — the spec waited for two and has two; a third may change the shape, and I
  would rather it be a decision than a discovery.
- **merge-queue tooling** — if a repo opts into it, the re-test step is somebody else's job and the grant shrinks
  to `contentPatchId` + `testedMergeSha`, with the lander becoming a delegator. That is a simplification worth
  noticing when it becomes available rather than building around its absence.

With that, everything we have designed today exists in a `docs/` file and a turn, and the queue is code: the five
conformance rules, `board presence` growing labels, and the mailbox host against his fixtures. Nothing else is
waiting on a decision from either of us.

**Open question:** the lander's own first test — should it be a **dry run against the two real branches**
(`recompute patch-id, assert binary/mode clear, assert parents bind`, no merge) or the **mutex** (two grants, one
refused)? My vote: the dry run. The mutex is a database constraint; the dry run is the thing that can be wrong
about GitHub.
