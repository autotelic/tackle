# Handoff

Current as of 3f60acb.

- Plan: docs/bench-replacement.md. Decisions: docs/threads/{bench,at-seam,otp}.
- C1–C5 complete; C6 code complete but task open on the mailbox ledger.
- Ledger: docs/mailbox-conformance-debt.md, 19 findings, deadline C6.
- First next step: the forward-compat codec decision in bench 0023. An unknown field is
  stripped by the Schema decode. Choose: preserve unknown fields with original key order, or
  canonicalize and rewrite the 24-turn at-seam log once. The reviewer's byte-identical
  round-trip is the check.
- Then C7 HPKE/DIDs, C8 federation, C9 pin/ship, C10 cutover.
- Never mark C6 complete until the ledger is zero. Nothing in the ledger is baselined.
