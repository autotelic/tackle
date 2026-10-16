# @autotelic/jig-cli

**The harness.** The command is `jig`; the package is `jig-cli` only because `jig` was
already taken (an unrelated sibling repo, and the npm name). It owns no analysis. It runs the other engines, merges their output
into one report, and holds the ratchet.

A jig is the fixture that holds a workpiece while several tools work on it: it does not
cut, it holds the piece so the cuts line up. That is the whole job here — run `plumb`,
`joggle`, `cutlist`, and whatever else the repo declares, collect their findings into
one stream, and fail a run only on what is genuinely new.

## It shells out; it does not link

`jig` depends on `@autotelic/protocol` and nothing else in this workspace. It drives
`oxlint` (which carries `plumb`), `joggle`, and `cutlist` **as processes**. That is
deliberate: the cohesion of `tackle` is a shared _format_, not a shared runtime, so the
conductor must not be a fifth thing everything links against.

## One report

Every engine already reduces to the same shape — a place, a sentence, a severity — and
oxlint decided what that looks like. `jig` reads two encodings and normalizes both:

| Engine kind     | Invocation                   | Encoded as                                          |
| --------------- | ---------------------------- | --------------------------------------------------- |
| `oxlint-plugin` | `oxlint --format json`       | oxlint's JSON (line/column in `labels[0].span`)     |
| `process`       | `joggle check --format json` | a report document, or JSONL                         |
| `cutlist`       | `cutlist build --check`      | a non-zero exit becomes one `stale-catalog` finding |

An engine that speaks neither is **not** silently treated as clean: it produces one
`<id>/unparsed-output` info finding, because "no findings" and "not understood" must
never look the same.

## The ratchet

The gate is `protocol`'s baseline: findings are accepted **by identity**, never by line.
A run fails on new identities only. `warn` repo-wide and `error` on what you touched is
the same file, not a second configuration.

```sh
jig check             # run every engine; fail on errors and new findings
jig check --format github   # GitHub Actions annotations
jig baseline          # accept the current findings into the baseline
jig engines           # what is configured, and whether it is on PATH
jig init              # write jig.config.json, an empty baseline, and the cookbook
```

## Where it sits

`cutlist` **produces** the vocabulary; `plumb` and `joggle` **consume** it; `jig` runs
all three and keeps the ledger. It is also the surface pi and OpenCode call, so an agent
gets the same findings a human's terminal does.
