---
"@autotelic/treadle": minor
---

Resolve a repo's declared generated artifacts on rebase, and diagnose conflicts.

- `generatedPaths` (new, optional config): a conflicted path under one of them takes the integration side and the branch's own Checks regenerate it. A generated catalog producing two different compilations is the normal case, not a disagreement about code; it escalated three times in one evening's run.
- Conflict notes now name the files and classify each as `scratch`, `ledger`, `generated` or `source` (`describeConflicts`), instead of "outside the engine's own files — a person needs to rebase it by hand", which named neither the files nor the reason.
- `budgets.passesPerNight` is now optional. A Pass is a proxy; with `maxCostPerNightUsd` set the dollar cap is the real bound. An observed run stopped at 24 passes having spent $2.53 of a $40 budget.
