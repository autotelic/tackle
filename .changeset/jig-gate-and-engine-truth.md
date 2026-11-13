---
"@autotelic/jig-cli": patch
---

The gate a fresh repository gets by default is `all`, and an engine that dies is infrastructure.

`jig init` used to scaffold `gate.mode: "touched-files"`. That mode measures against HEAD, so
on a clean CI checkout the touched set is empty and `jig check` exits 0 whatever is in the tree:
the shipped config gated nothing, and only the opt-in pre-commit hook made the mode useful. Init
now defaults to `all` and prints the tradeoff, so `--gate touched-files` is a decision rather
than a surprise.

An engine that ran and produced output jig could not read was summarized `ran`, because the
provenance fallback answered `ran` for every document without a summary and won the branch that
was meant to mark it `errored`. The gate therefore saw no infrastructure and `--format github`
showed a green PR over a run that read nothing. `engineStatus` checks the unreadable finding
first; the same run now exits 3.

Also: `init` passes `--allow-unjudged-baseline` when it births joggle's ledger, notes a
wholesale `.joggle/` ignore with the narrowed block, documents `pnpm -s jig` for machine
output, and says that a judged run can grow the ledger before it shrinks it.
