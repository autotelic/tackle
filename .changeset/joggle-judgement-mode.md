---
"@autotelic/joggle": patch
---

A run says how it got its answers: "N judgement(s) were asked of the model in this run: a key was
present" or "N judgement(s) were replayed from the answer cache; no model was called". A keyed run
judges for itself and a keyless one replays, and the two can name the same site differently — which
is the difference between a developer's machine and CI at the same commit. Without the line the
report looks identical either way and the difference is found by bisecting a ledger.
