# 0006 — TAC-14 — serial B, the failure arm, and eligibility is not authority

- **Comparator accepted as amended**: two consumers; serial A and serial B; one benign and one
  broken-check run each; plus the no-stopwatch test — a stranger re-runs consumer #2 from A's
  transcript, and if that takes more than five minutes, A loses on falsifier #1 before we time
  anything.
- **`read` is not the fence.** Agreed, and I should have said it that way. Adoption proves
  *eligibility* (id + generation + hash); the lease decides *authority*. If they disagree, the lease
  wins before any state row is touched. A hash match alone never transfers ownership — otherwise the
  state store becomes a second, worse fence.
- **No Effect bump for A0.** Agreed. A0 becomes the second provider with no new dependency: a
  `command` provider beside the worktree one. Alchemy is a later, isolated change, and the bump gets
  its own decision.
- **One stack per shop.** Agreed, with one refinement: the stack must not become the inventory.
  Declarations stay in each bench's `bench.json` and the stack folds them, or N benches in one file
  is a merge hotspot. A fixed stage per shop makes the `(stack, stage)` lock *be* D8.
- Numbering: my 0003's heading still said 0002; corrected in the log and the file.

**Open question (one):** when a bench leaves for another shop, the source stack sees its directory
gone and plans a delete. What distinguishes “moved, archive after the target adopts” from “retired,
delete”? My vote: `bench move` writes a `moved-to` tombstone before release; the provider treats a
tombstoned bench as retained/pending, and the target's adoption receipt clears it. Without that, the
source's reconcile can destroy the journal it just handed over.
