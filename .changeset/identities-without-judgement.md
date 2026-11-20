---
"@autotelic/joggle": minor
"@autotelic/jig-cli": minor
---

A finding's identity no longer depends on whether a judgement reached it.

A cluster's identity included **the symbol the model chose to keep**, so the same duplicate had
one name when a keyed run judged it and another when CI ran keyless — and a ledger written in
either mode matched nothing in the other. That is why a developer with a key could not run the
gate unscoped and pass, and why "the engine ledger owns the bulk, the gate ledger stays short"
could not hold.

Identities are now the rule and the cluster's **members** (`file:name`, sorted, no line
numbers): membership is decided by the detector, before any question is asked, so keyed and
keyless runs agree. Verified on this workspace: the keyless identity set is a subset of the keyed
one, with zero renames (the keyed run adds findings; it no longer moves them).

**This renames the ledger, once.** Accepted identities written by joggle before this release will
not match; re-run `jig baseline` on the default branch (and the engine's `--update-baseline`)
after upgrading. The gate's report names the difference as new findings, so nothing is lost
silently.

Three related corrections:

- `jig baseline` refused any ledger containing a **deterministic** finding, because such findings
  are marked `judged: false` — an exact duplicate has no question to ask. It now refuses only when
  an engine actually skipped judgement (its census reports unjudged candidates), and says how many.
- The baseline refusal quotes the **per-rule ceilings** that dropped candidates, so a run that
  stopped at a constant no longer sends the operator to `--max-tokens`, which cannot raise it.
- `jig init --force` no longer replaces a repository's decisions: an existing layer's `include`
  set is kept (it is authored intent, not a draft), and a JIG.md/ONBOARD.md that differs from the
  generated text is left alone with the fresh copy beside it as `.new`.
