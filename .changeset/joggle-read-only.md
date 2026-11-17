---
"@autotelic/joggle": minor
---

`--read-only` (and `JIG_READ_ONLY=1`, which `jig check` sets for every engine it starts) answers
from the answer ledger and never writes it. A check must not edit the tree it judges, and here the
stake is identity: a new answer _renames_ the finding it verifies, so a run that judged and wrote
re-opened 91 findings in a rule whose ledger entries were intact, on files the change never
touched. Warming the ledger stays deliberate — `joggle check` on trunk, or `--update-baseline`.
