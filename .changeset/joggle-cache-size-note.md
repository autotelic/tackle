---
"@autotelic/joggle": patch
---

A run says when the judgement cache passes 8 MB, and names the cap: `joggle cache prune
--max-bytes 4000000`. A committed answer cache buys keyless replay and costs bytes in every
clone; GitHub warns above 50 MB per file and refuses above 100 MB, and a deep stack multiplies
it because each branch's scoped accept adds answers to the same committed file. JOGGLE.md and
docs/artifacts.md state the ceiling for the committed mode, and when a cache can stop being
committed at all (only with a key: without one the identities change).
