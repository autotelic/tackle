---
"@autotelic/joggle": minor
---

Discovery follows the root through symlinks, and the committed ledger is reviewable.

`tsgo --listFilesOnly` prints the path it resolved, so a cwd of `/tmp/x` (where `/tmp` is a
symlink) listed `/private/tmp/x/...` and the lexical root comparison rejected every file: the
run reported "tsgo listed no source files" and analysed nothing. Roots are compared and returned
through their real paths now, in the caller's spelling of the tree.

`--update-baseline` refuses while any candidate was not judged (`unreadable`, `no_evidence`,
or past a budget), because a baseline records what a person reviewed. `--allow-unjudged-baseline`
is the explicit override, and the run always says how many candidates nobody looked at.
`decision.maxInputTokens` puts the token budget in `joggle.config.json`; `--max-tokens` still
wins.

The answer ledger is now text-diffable and merges without per-machine setup: the generated
`.joggle/.gitattributes` names git's built-in `merge=union` instead of a custom driver that only
worked where somebody had registered it by hand, and drops `-diff`/`linguist-generated` so a
verdict change is one visible line. The older banner is migrated in place. `joggle cache report`
renders entry and shard counts, verdict distribution, labels and the date range beside the diff.
