---
"@autotelic/joggle": minor
---

`--merge-baseline` unions a run's identities with the ones already in `--update-baseline`'s
target instead of replacing them. A scoped run (`--since`) judges every file it reads, so its
identities are a pull request's worth: merging grows the committed ledger by one change rather
than re-judging the repository, which on a stacked branch is a 25-minute run that still refuses
to write.

A `.json` ledger is written as a set, so re-accepting an identity cannot duplicate a row. The
`--update-baseline` refusal now names the model key, the token budget, and the scoped recipe
rather than "judge the run first".
