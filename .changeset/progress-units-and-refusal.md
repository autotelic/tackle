---
"@autotelic/joggle": patch
"@autotelic/jig-cli": patch
---

A progress line whose units add up, and a baseline refusal that names the real cause.

The progress line printed the WIRE request count as "resolved". That is a different quantity: a
replayed candidate never makes a request, and one batched call can answer many candidates, so a
ten-minute run reported "198/10040 resolved (31 judged, 9731 replayed)" while writing 17,000
answers. The counters are now three distinct units — `judged` (answers written, one per
candidate), `replayed` (per-decision cache hits), `apiCalls` (provider requests) — and
`resolved` is their terminal sum with `unavailable`. The progress document carries the same
fields, plus `unavailable`.

`jig baseline` refused with "joggle reads its model key from this run's environment" whether or
not the key was present. On a repository that sets `unavailable: "count"`, the key IS present and
the candidates are still unjudged — a per-rule ceiling, not a missing secret. The refusal now
states which case it is, says that no key can raise a ceiling, and points at `--allow-unjudged`
for a repository whose engine policy already declares that unjudged is expected.

The README also states the direction that works: accept from a KEYED run once, and both modes
pass, because a keyless run sees a subset of a keyed ledger. Accepting keyless and then running
with a key fails by construction.
