---
"@autotelic/joggle": minor
---

`--list-files` puts the analysed paths in the report's `discovery` block, and every run now
carries `discovery` (`analysed`, `ignored`, `ignoredDirectories`, `truncated`,
`skippedExtensions`) in `--format json`. Two checkouts of one commit that disagree have only two
possible causes — a different analysed set, or a different verdict — and until now the JSON gave
no machine-readable way to tell them apart: the census was prose in `notes`, and the file list was
never emitted. Diff the two `paths` arrays and the answer is in the diff.
