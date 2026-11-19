---
"@autotelic/jig-cli": minor
---

`jig check` answers for a change, not only for the repository.

`--changed`, `--since <rev>`, and `--pr` / `--pr-number <n>` narrow a run to a change set —
the report and the gate together. This was the one thing joggle could do and its harness could
not, so "did this pull request introduce anything" had to be assembled from three tools by hand.

What is narrowed is the REPORT, not the engines. They still read the whole tree: a cross-file
rule cannot answer from three files, and a scoped oxlint invocation cannot see an import it
never loaded. Afterwards each engine's counts are recounted over the change set, and
everything an engine said about HOW it ran — replayed, skipped, candidates not judged — is
carried through untouched, because a scoped run must still be able to say what it did not look
at.

Three rules keep the smaller report from becoming a bigger claim:

- The text report prints the scope and the number of files read. "0 findings" over three
  changed files and over the repository are different sentences.
- A scope that cannot be resolved — a revision git does not know, no `gh`, no pull request for
  the branch — exits 3 and says so. It never falls back to the whole tree, which would answer
  "is the repository clean" to a question about one change.
- The stale-ledger line is absent in a scoped run. A scoped diff compared the ledger to a
  handful of files, so every identity outside that slice would read as stale; only a
  whole-tree run can say an entry stopped firing.
