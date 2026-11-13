---
"@autotelic/joggle": minor
---

The committed ledger is one file by default; sharding is the opt-in.

A shard per key prefix turned a 182-entry ledger into 130 files, and `git
cannot ship a merge driver in `.gitattributes`, so the merge granularity it
bought was unavailable on most clones anyway. `answers.jsonl`— one sorted line
per answer — is now what joggle writes: a verdict change is one visible line, and
git's built-in`merge=union` merges concurrent judging.

- `cache.layout: "sharded"` (or `joggle cache migrate --layout sharded`) keeps
  the sharded form for a store big enough that a whole-file rewrite or a merge is
  a real cost. Both layouts are read; `cache migrate` now defaults to `single`
  and moves between them in either direction.
- `joggle cache report` names the layout and the file count.
- The older `answers.json` object and both earlier `.joggle/.gitattributes`
  banners are migrated in place on the next write.
