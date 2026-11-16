---
"@autotelic/jig-cli": patch
---

The cookbook's stacked-branch recipe now separates the two runs: `--since <base>` is the gate's
run, and accepting is one full run at the head (`--update-baseline ... --merge-baseline`),
because `--update-baseline` refuses a scoped run. A scoped accept folds findings differently and
can miss the identity a full run reports.
