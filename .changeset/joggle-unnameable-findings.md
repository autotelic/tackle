---
"@autotelic/joggle": patch
---

`--update-baseline` reports findings no ledger can ever hold: `N finding(s) declare no
identity, so no baseline can accept them; they will appear in every run`. Without it, "accepted"
read as "quiet", and the finding came back in the next run with no explanation.
