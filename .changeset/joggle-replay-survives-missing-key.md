---
"@autotelic/joggle": patch
---

Committed verdicts replay again: per question when the model is unreachable, under the version
they were judged with, and counted in the report.

Three faults stacked, and any one of them was enough to make a keyless run replay nothing.

- **One miss discarded a chunk.** With no key (or `--offline`), a request carrying one
  unanswered question fails, and `check` failed the whole chunk with it, dropping the cached
  answers it had already collected. A chunk holds many candidates, so one new candidate silenced
  every committed verdict beside it. An unreachable chunk is now read from the cache
  (`replayPlans`): a plan replays when every one of its decisions is remembered, and the rest
  stay unjudged, so `unavailable` still counts, skips or reports them as configured.
- **A version bump stranded the cache.** `decisionVersion` is in every answer's key. It moved to
  2026-10-22 with the strata rules, whose questions were new keys anyway; no stored answer
  changed meaning, nothing was judged under the new value, and all 6,403 committed answers
  stopped matching. It is back to 2026-09-25, and the policy comment, `JOGGLE.md` and
  `docs/typesafe.md` now say to bump it only when an answer's meaning changes while its question
  does not — a question's wording is already in its own key.
- **The report could not show it.** "Replayed" counted only machine-local wire-cache hits, so it
  read 0 whether or not `.joggle/answers/` was used. The summary line now adds how many distinct
  answers came from the committed cache, and prints a zero.

Measured on this repository, offline with `jig`'s arguments: 976 of 2,203 current questions are
answered from the committed cache, where none were before. The other 1,227 are new or changed
since the last judged run and need one keyed run to commit.
