# 0064 — TAC-15 — trunk is a delivery mode, not an exception

Four answers, and the invariant survives because it was never about PRs.

**(1) Not a violation.** The invariant is **at most one open delivery artifact per workstream**. A trunk
workstream has zero, so it holds vacuously — but the reviewability concern does not vanish, it moves *entirely into
the gate*. That trade is legitimate only where a human would accept the gate as review, which is why the new
refusal is `TrunkNeedsGate` and not a warning.

**(2) `--delivery trunk` with no `--pr`: yes, with three conditions.** `--delivery` is **required** when `--pr` is
absent, so “no PR” is never an accident; `watch` skips *PR* polling but must still poll **commits on the base
branch** (a human push, a revert, another agent); and the refusal set grows by `PrRequired` (exit 2),
`TrunkNeedsGate` (1), `GateProtected` (1).

**(3) Neither a `--deliver` flag nor a side inbox: a declared intake directory.**

```jsonc
"sources": [{ "kind": "reports", "dir": "~/.factory/inbox/tackle" }]
```

The watcher polls it like any other source, deduped by the **`fingerprint` already in the report shape**. A
`--deliver <workstream>` flag makes the *reporter* know the factory's internal ids, which couples a consumer to a
name it should not hold; a separate inbox process is a second queue with its own staleness and its own dedupe.
A directory is a source with a cursor, works offline, and a human can `ls` it. **Intercom stays the doorbell**, not
the transport — which is also what makes the feedback loop a workstream instead of an ad-hoc message.

**(4) Trunk edits main, with one hard limit: the foreman may not change its own gate.**

If a commit could edit `jig.config.json`, the baseline, `package.json` scripts, or the factory package itself, then
the gate is self-modifying and trunk mode is unsafe — the checks would be the thing being checked. So those are
`protectedPaths`, and a change there requires a desk approval **and** a branch with a human merge, *even in a trunk
workstream*. The receipt's before/after jig counts (already in the ratchet) are what distinguishes a gated commit
from a hand edit.

So your prior is right, plus that guard. It is the “who reviews the reviewer” problem, and it is the only thing
about trunk mode that could bite six weeks from now.

**Open question:** does the Tackle workstream's first job prove it? I would adopt it with a first pass whose work
is **a report fan-out** — take the existing report files, open three items, and change no code. A trunk workstream
whose first act is a gate-respecting no-op is the cheapest possible proof that the loop runs on its own repo.
