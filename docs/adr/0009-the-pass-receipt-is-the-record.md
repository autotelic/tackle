# ADR 0009 — the pass receipt is the record for tackle/tech-seams

Status: accepted
Date: 2026-11-27

## Context

Each factory pass is asked to claim its ticket in Linear, move it to In Progress, and close it
with an evidence comment. This workstream cannot: the Linear credential on this host opens one
workspace whose teams are AUT, DEV and PRO, and that workspace holds no tackle project, no
tech-seams project, and no issue naming tech-seams, a board cut, or a seam. `linearis issues
list -l 200`, the MCP project and issue queries, and `factory status` agree — the workstream
record (`~/.factory/workstreams/tackle-tech-seams.json`) carries the label `tech-seams` and no
Linear project id.

The same gap was raised and answered for the other tackle workstreams (for example
`desk-tackle-joggle-restated-value-1795721647456`). For this workstream, herdr answered
`desk-tackle-tech-seams-1795787421067` with `receipt-is-record` on 2026-11-27T17:53:50Z:
the pushed commit and the pass receipt are the record, and no Linear state moves. A duplicate
card raised 62 s later (`desk-tackle-tech-seams-1795802092780`) was withdrawn against that
answer.

## Decision

1. No pass raises a desk card for the missing Linear project. The answer is on the record, and
   re-raising it spends a pass without adding a fact.
2. A ticket is the task event that wakes the pass, plus the cut it names in
   `docs/tech-seams.md`. Its acceptance condition is the one written in that event; its evidence
   is the pushed commit and the kernel's pass receipt.
3. The Linear claim, the In Progress move and the Done transition stay owed to whoever points a
   token at the owning workspace — this repo does not fake them with an issue in AUT/DEV/PRO.
4. If the owning project later becomes reachable, `factory link --id tackle-tech-seams
   --linear-url <url>` records it and the next pass claims there; this ADR is then superseded
   rather than edited.
