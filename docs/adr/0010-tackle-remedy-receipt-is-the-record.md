# ADR 0010 — tackle/remedy has no Linear project, so the receipt is the record

Status: accepted
Date: 2026-11-27

## Context

The pass contract asks each pass to claim its ticket in Linear, move it to In
Progress, and close it with an evidence comment. This workstream cannot.

The Linear credential on this host opens one workspace whose teams are AUT, DEV
and PRO. `linearis projects list` returns none named tackle, remedy or
tech-seams, and `linearis issues list -l 50` names neither. The workstream record
`~/.factory/workstreams/tackle-remedy.json` carries the label `remedy` and no
Linear project id. The same gap was raised and answered for tackle/tech-seams in
[ADR 0009](./0009-the-pass-receipt-is-the-record.md), which also records that the
other tackle workstreams raised and withdrew the same card.

`factory status` shows this workstream's `desk` empty: no pass has an open card
against it, and re-raising one would spend a pass without adding a fact.

## Decision

1. No pass raises a desk card for the missing Linear project. ADR 0009 is the
   record for the tackle workstreams, and this ticket changes neither the
   credential nor the workspace.
2. A ticket is the task event that wakes the pass plus the cut it names in
   `docs/remedy-hill.md`. Its acceptance condition is the one written in the
   event; its evidence is the pushed commit and the kernel's pass receipt.
3. The Linear claim, the In Progress move and the Done transition stay owed to
   whoever points a token at the owning workspace — this repo does not fake them
   with an issue in AUT/DEV/PRO.
4. If the owning project becomes reachable, `factory link --id tackle-remedy
   --linear-url <url>` records it and the next pass claims there; this ADR is
   superseded rather than edited.
