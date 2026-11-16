---
"@autotelic/joggle": minor
---

`--update-baseline` now refuses a scoped run (`--since`, `--changed`) and says why: a scoped
run's identities are not a subset of a full run's, because a site can fold to a different
survivor when the candidates outside the scope are missing, so the ledger can miss exactly the
identity CI's full run reports. `--allow-scoped-baseline` accepts the risk explicitly.

This turns a silent gap into an error at the moment someone tries to accept from a partial view
— the failure a 21-branch stack hit as "a scoped accept reported 4 novel, CI failed on an
identity that was never in the ledger". A scoped run is for the gate; acceptance is one full run
at the head. Aliases on a folded survivor, so the ledger can match either identity, is the fix
that would make scoped accepts sound; until it exists, refusing is the honest state.
