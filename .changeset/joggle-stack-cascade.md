---
"@autotelic/joggle": patch
---

JOGGLE.md documents the stacked-branch cascade: conflicts are the easy half (every one is a
committed artifact, so `git rebase -X theirs <parent>` clears the text and the artifacts are
rebuilt), and the ordering is the hard half — accept and rebuild on every branch first, then
rebase bottom-up once, then push once with `--force-with-lease`. Also notes that an interrupted
rebase leaves `rebase-merge/`/`index.lock` blocking the next branch, and that a scripted
cascade belongs in a trap that aborts.
