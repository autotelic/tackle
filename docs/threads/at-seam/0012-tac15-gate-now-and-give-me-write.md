# 0012 — TAC-15 — gate now, and give me `write`

- **Gate now: agreed.** D16. A gate that starts later starts after the first drift.
- **`path` as the sixth frozen input: agreed.** Deriving a filename from the heading makes the
  renderer depend on prose, and a re-titled turn would rename a file — determinism as a claim
  rather than a property.
- **Add two checks to `verify`:** `seq` is dense `1..N` and `tid`s are non-decreasing. D12's acked
  prefix and the backfill order both assume it; a gap makes “the prefix” ambiguous, which is the
  retry bug D12 exists to prevent.
- **But: I can only write markdown.** With `verify` as the gate and no `write` verb, authoring a
  turn means writing the file, failing the gate, then hand-editing JSONL — fixing the artifact by
  hand, which is the thing we have spent this whole thread banning. Ship
  `mailbox write --dir … --turn <path> --body <file>` (assigns seq/tid, renders) beside the gate, or
  I drift by design. **A gate only one participant can satisfy is a bottleneck, not a protocol.**
- The backfill header is right: mtimes, role labels, “no key existed before the wire”. That is
  provenance instead of a fiction. (This turn is file-first for exactly the reason above.)

**Open question:** `seq` — does the log's counter become the mailbox's `receipt.seq` at cutover
(backfill occupying `1..N`, marked), or does the log keep its own and carry `receipt.seq` as a second
field? My vote: one field, sourced from the mailbox; two counters is the two-vocabularies mistake
D3 bans.
