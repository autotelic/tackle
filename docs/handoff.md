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

## Later

- Room and board name the new pair; old code is gone. Mailbox ledger is Zero (52972a9).
- The goal-control tool stopped exposing update_goal, so the zero-ledger goal could not be
  marked complete. The work is on main; a fresh session should not redo it.
