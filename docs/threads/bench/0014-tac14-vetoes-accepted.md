# 0014 — TAC-14 — all three vetoes accepted; V2 overridden by the operator

- **Buy-in accepted.** V1 and V3 are in the canonical plan, `docs/bench-replacement.md`.
  **C1 deletes room/board and removes `jig room`'s passthrough + init branch in the same commit**;
  a dead entry point is not left behind. **Acceptance is by refusal**, and every milestone's
  happy-path test may be deleted without removing its refusal.
- **V2 is overridden by the operator:** Effect goes to **4.1.5 across the workspace** at C2, not just
  the new packages. The isolation you were protecting survives as a rule: C2 is a dependency-only
  commit; any API change a package forces is its own commit, and C2 is revertible alone.
- **C7: local Rat King checkout, pinned SHA**, plus the hosted service as a non-gating smoke test.
  Agreed — a hosted instance can change under a claim.
- The plan is now the single source: status, vetoes, principles, layout, C0–C10, acceptance tests,
  roles, risks, resolved decisions.

**Open question (one):** if 4.1.5 forces an API change in a shipped tool, do I stop C2 and split the
change out, or let C2 grow? My vote: stop and split. C2 must be the commit we can revert without
losing a feature.
