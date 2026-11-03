---
"@autotelic/joggle": patch
---

A yes/no whose repeated asks split is reviewed, not acted on.

A Noul is asked three times and its agreement becomes its margin, so that it is gated like a
Choice. The mapping (`2 × agreement − 1`) gave a 2-1 split a margin of 0.33, over `minMargin`
(0.25), so a split whose mean cleared the 0.5 floor was reported at the rule's full severity
even though one ask said no. A 2-1 split is what three fair coin flips produce three times in
four; it is no evidence the model was decisive. `policy.decision.gates.minAgreement` (1) now
sets the share of asks that must agree before agreement counts as a margin, and below it the
margin is 0, so `qualityOf` routes the answer to review.

The gate is policy, not part of the judgement cache key, so every committed answer still
replays and nothing is re-judged. In this repository's caches, 12 of 549 repeated Nouls split,
and the 6 above the floor move from their rule's severity to `info`.
