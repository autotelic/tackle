---
"@autotelic/jig-cli": minor
---

`jig check` runs every engine read-only (`JIG_READ_ONLY=1`): a report that edits the tree it
reports on changes its own next answer. The gate's section also names where its failures are
(`file:line` samples per rule) instead of only counting them, so a run that re-opens dozens of
findings in one rule can be acted on from the log.
