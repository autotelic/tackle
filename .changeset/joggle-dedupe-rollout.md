---
"@autotelic/joggle": patch
---

The docs say two things the field established on a real stack: deduplicating an old ledger by key
is **safe on a keyless CI today** — the stamps were never load-bearing for replay, so a parked
stack went 55.4 MB / 372,623 lines to 1.21 MB / 8,171 answers with the lint job still green on the
same answers — and compaction is a commit, so a parent re-dirties every child. Compact bottom-up
once, or compact the base branch after the stack merges.
