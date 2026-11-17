---
"@autotelic/joggle": minor
---

A committed ledger line is now the key and the answer, nothing else. It used to carry
`writtenAt`, which made the same answer a different line in every clone: `merge=union` keeps both
sides of a differing line, so each rebase of a 21-branch stack copied every answer again — 5,890
answers became 131,440 lines, 20.5 MB for 0.9 MB of content, one key copied 141 times. With the
line a function of the key, a merge collapses duplicates by construction. Old stamped lines are
still read; ages now live only in the machine cache, which is what `--max-age` prunes.

`joggle cache compact` repairs a ledger that already grew: it reads each key once and rewrites the
set, no re-judging and no key. `joggle cache report` now names the duplication.

A scoped run (`--since`, `--pr`, `--changed`) writes its answers to the machine cache instead of
the committed ledger, unless `--cache-dir` names a store. A branch's verdicts are a cache; the
committed ledger is the trunk's.
