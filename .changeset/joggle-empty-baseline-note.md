---
"@autotelic/joggle": patch
---

`--update-baseline` says when it wrote nothing: an empty ledger is still written, and the
report now carries `wrote 0 identities to <path>: nothing new to accept`, so a caller's merge
step does not have to infer "nothing new" from an empty array — or from a file it never
checked for.
