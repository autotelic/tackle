---
"@autotelic/protocol": minor
"@autotelic/jig-cli": minor
---

The gate honors its config, and `jig check` publishes an exit-code contract.

`report.format`, `gate.failOn`, and `gate.mode` were decoded and then ignored — knobs that
lied. `jig check` now reads all three: `report.format` is the default when `--format` is
absent; `failOn` chooses whether the gate fails on errors, errors-and-warnings, or (the
default) any identity not in the baseline; and `gate.mode: "touched-files"` gates only on
findings in files the working tree touches, widening to `all` when git cannot say rather than
narrowing to an empty set that would pass everything. `report.maxWarnings` remains the
second, severity-blind ceiling.

The exit codes are now a documented contract: `0` clean, `1` findings, `2` usage/config (a
command line that did not parse; `--help` stays `0`), and `3` infrastructure (an engine that
could not run — an unread run is not a dirty one, the report-level twin of the `replayed`
and `unjudged` census fields). The gate is one pure function, `gateVerdict`, and the human
text renders its verdict so the report and the exit code can never disagree. The `Gate`
config's `report.format` also accepts the projections `sarif`, `lsp`, and `codeclimate`.
