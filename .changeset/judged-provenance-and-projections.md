---
"@autotelic/protocol": minor
"@autotelic/jig-cli": minor
---

Judged provenance in the report, and `jig` as the one command with projected output.

The report now distinguishes what an engine **found** from what it **did**. A diagnostic may
carry its judged provenance — the entropy `move`, a `score`, a `confidence`, and a proposed
`repair` with a `complete` flag — and an `EngineSummary` may carry a `status`
(`ran`/`replayed`/`skipped`/`errored`), an `unjudged` count, and a `drops` breakdown. All
fields are optional and additive, so a reader of the previous report is unaffected. The
invariant they serve: "0 findings" and "not looked at" never render the same again.

`jig check` gains the outward projections `--format sarif | lsp | codeclimate | jsonl`
(beside the existing `text`, `json`, and `github`), implemented as pure functions of the one
report and checked against `protocol`'s worked examples. `--limit N` bounds the human
finding list without ever truncating the census or the ratchet. The human form is now the
only renderer: `jig check --format text` says what each engine did, marks an unjudged finding
`(unverified)`, and shows its `move`, `score`, and `repair`. The pi extension and the
OpenCode plugin are transports over that text rather than re-renderers.
