---
"@autotelic/jig-cli": patch
---

`--format github` annotates the findings the gate actually holds as `::error`, not by the
engine's own severity. `failOn: any-new` fails on novelty, so it can hold an `info` finding —
which printed as a notice and left the log with a red gate and no red finding in it.
