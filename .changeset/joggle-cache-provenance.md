---
"@autotelic/joggle": patch
---

A run counts the judgements it took from a cache. An answer served from the committed ledger was
not counted as replayed — only wire requests were — so a run whose findings all came from cached
verdicts reported "0 replayed, 0 calls" and the census could not tell a warm machine from a cold
one. That is exactly how a developer's tree reported 95 findings while a fresh clone reported 0:
moving the machine cache aside changed the verdicts, and nothing in the report said a cache was
involved. `decision.replayed` now counts both, and the note names them.

0.8.0 could not be completed on the registry (a staged version required approval); 0.8.1 carries
the same `--list-files` and `discovery` work.
