# Signals: the faucets into the factory

A factory that only reads its tracker builds exactly what the tracker says. This document is about the other
input — the one that says _the thing we shipped is slow, erroring, or annoying_ — and how it enters without
becoming a firehose of tickets or a surveillance surface.

---

## 1. The one rule

> **A signal is an observation. A candidate needs a threshold, a baseline, and an attribution. A ticket needs a
> human.**

Three filters, in order, and each one is a place an autonomous factory goes wrong:

- **threshold** — without it, every p95 wobble is work;
- **baseline** — without it, a known-slow route re-proposes on every poll;
- **attribution** — without it, you cannot say which change caused it, so the work item is an assertion.

The tracker already gives us the first and last for _requested_ work. Telemetry is the only way to get them for
_unrequested_ work.

---

## 2. The source catalog

Every source is pulled with a **watermark**, never pushed at us, and every pull records `observedThrough` per
source (`docs/workstream.md` §8). A faucet that cannot say when it last looked is not a faucet.

| source                                     | what it gives                                                                                               | the cursor                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- | -------------------------- |
| **our own OTLP** (`docs/observability.md`) | spans with `verdict`, `roomId`, route, duration; the refusal-weighted stream is already the interesting one | trace time range           |
| **Cloud Error Reporting**                  | error groups with counts, first/last seen, affected service                                                 | group `lastSeen`           |
| **Cloud Logging**                          | log-based metrics, structured errors, `severity>=ERROR` rates                                               | log timestamp              |
| **Cloud Trace**                            | latency distributions per route/span                                                                        | time range                 |
| **Cloud Profiler**                         | CPU/heap by frame — _where_ inside a slow request                                                           | profile window             |
| **Cloud SQL Query Insights**               | the naughty queries: text, p50/p95/p99, rows, plan                                                          | query window               |
| **GitHub Actions**                         | check runs, failures, flake rate (already an ingest kind)                                                   | run id / `updated_at`      |
| **deploy markers**                         | the sha in production, and when                                                                             | our own `work.ship` record |
| _(optional)_ product analytics             | pageviews and funnel steps — counts only                                                                    | day bucket                 |

Two sources are ours and two are the cloud's; the rest are joins. Nothing here needs a new service: each is an
HTTP pull with a cursor, which is what the watcher already does.

---

## 3. The join that makes it attribution instead of noise

`work.ship` already records `sha`, `pr`, `at`. A deploy marker is the same sha with a production timestamp. So:

```
signal window  = [deploy(at, sha), now]
baseline window = [previous deploy, this deploy)
caused by      = the workstream whose ship record names that sha
```

That is the whole trick, and it is why this belongs in the factory rather than in a dashboard: **we are the only
ones who know which workstream shipped which sha.** A regression measured against the previous deploy is
automatically attributed to a workstream, with a PR, a receipt and a diff attached — the evidence a ticket needs.

Two consequences worth stating:

- **compare to the previous deploy, not to “last week”** — a rolling window hides step changes, and a step change
  is exactly what a ship produces;
- **a deploy with no signal drift is a fact worth recording** — “shipped 7c9e, no regression in 2h” is what lets you
  later trust a quiet period instead of wondering whether the faucet was broken.

---

## 4. The signal report — a separate record, not a `kind` on reconciliation

Same _discipline_ as `docs/reconcile.md` — evidence, proposals, watermarks, refusals — but **its own record type**,
because the two have different actions. The ruling came the direct way: `board apply` "turns reconciliation
proposals into Linear state and nothing else." An experience record is evidence about a deploy window; it may
reference a workstream and a ship, and it must not be applicable to Linear at all.

Two apply paths, by design:

| record              | action                                                                                | who acts                    |
| ------------------- | ------------------------------------------------------------------------------------- | --------------------------- |
| `reconciliation`    | `board apply --from` → Linear state transitions                                       | a human approves the report |
| `experience.report` | **a desk item**, whose answer may create one issue through the kernel's proposal path | a human answers an item     |

The signal path deliberately has no `apply`: "file a ticket about this regression" is a _decision_, and the answer
record is its authority — the same rule that keeps a report from rewriting a board.

```jsonc
{
  "lexicon": { "name": "reconciliation", "version": 1 },
  "kind": "experience", // ← the only new field on the record
  "at": "…",
  "workstream": "perms-1862",
  "observed": { "traces": "…", "errors": "…", "deploySha": "7c9e…", "sinceDeploy": "2h14m" },
  "issues": [
    {
      "signal": "http.route.p95",
      "subject": "POST /checkout/confirm",
      "before": 610,
      "after": 2380,
      "slo": 800, // ms
      "evidence": { "deploy": "7c9e…", "pr": 1862, "sampleSpans": 412 },
      "proposal": { "state": "regressed", "reason": "p95 3.9× the previous deploy, over SLO" },
      "confidence": "evidence",
      "attribution": { "workstream": "perms-1862", "sha": "7c9e…" },
    },
  ],
}
```

Four proposal states: `regressed · improved · stable · unknown`. `unknown` is a source that could not be read or a
window too small to judge — never a zero, for the same reason `unobserved` never is.

Its refusals are its own, and none of them is a Linear refusal:

| code             | when                                        | message names                              |
| ---------------- | ------------------------------------------- | ------------------------------------------ |
| `NoAttribution`  | no ship or deploy marker maps to the window | the window and the last deploy seen        |
| `TooFewSamples`  | samples < `minSamples`                      | the count and the minimum                  |
| `BelowThreshold` | inside SLO, or inside the baseline          | the metric, the value, the bound           |
| `InSettleWindow` | the window starts before `settle` ends      | the deploy instant and the settle deadline |

**Proposals become work, not writes.** A report creates _candidates_, and a candidate becomes a desk item — one
per candidate, capped by `maxProposalsPerCycle`, with the report as its evidence. The factory never files a ticket
from telemetry on its own, because the failure mode is a hundred confident tickets and the cost is the credibility
of every other ticket.

---

## 5. Thresholds, baselines, and the UX ratchet

```jsonc
// signals.json, per workstream, outside the governed repo like every other record
{
  "sources": ["otlp", "errors", "sql-insights", "github-actions"],
  "slos": [
    { "subject": "POST /checkout/confirm", "metric": "http.route.p95", "max": 800 },
    { "subject": "GET /projects", "metric": "http.server.error_rate", "max": 0.005 },
  ],
  "windows": { "afterDeploy": "2h", "settle": "10m" },
  "budget": { "maxProposalsPerCycle": 3, "minSamples": 200 },
}
```

- **`settle`** exists because the first minutes after a deploy are noise: cold caches, rolling instances, a backfill.
- **`minSamples`** stops a p95 computed from four requests from becoming a ticket.
- **`maxProposalsPerCycle`** is the firehose guard: three, ranked by magnitude over SLO. A factory that proposes
  thirty regressions gets ignored after the second cycle.
- **`experience.baseline`** is the accepted-regression ratchet: identity = `subject + metric + threshold`, accepted
  by a human with a reason and an expiry. A known-slow report API does not re-propose every poll — and when the
  baseline is what keeps the report quiet, the report says so.

## 6. Privacy: aggregates leave, events do not

- a report may leave the machine; the pulls that built it may not. Counts, routes, percentiles, shas, durations.
- **no user ids, no session ids, no query parameters, no paths containing user data.** Query Insights gives you
  query _text_; parameterize it before it enters a record, or leave it out.
- a source that requires per-user data to be useful is a source we do not wire, the same way findings do not
  federate (`docs/at-seam.md` §6.3).

## 7. What the faucet cannot do

Telemetry tells you _that_ a route is slow or erroring, and roughly _where_ (a span, a frame, a query). It does
not tell you which line to change, and an agent that pretends otherwise will propose plausible rewrites to code
it never read. So the signal's job ends at a _candidate with evidence_: the workstream then does what it already
does — read the code, run the checks, ship one PR.

## 8. Where this threads into the factory as built

- **P2 already has the machinery.** A pull with a cursor, dedupe by id, a `kind` on the event, one pass per wake
  — a signal is another source with the same discipline, not another subsystem.
- **New event kinds:** `signal.regressed`, `signal.recovered`, `deploy.observed`. Same envelope as
  `github.review-comment` (`packages/factory/test/fixtures/events/`).
- **A new record, no `board apply` change:** `experience.report` with four refusals of its own
  (`NoAttribution`, `TooFewSamples`, `BelowThreshold`, `InSettleWindow`), and a desk item per candidate.
  `board apply` keeps its five refusals and its single purpose.
- **A phase that is not a phase:** signals do not advance `build → land`; they raise items beside it, so a slow
  route never blocks a correctness fix.
- **The receipt gains a line:** `signals: { pulled: 4, proposed: 2, suppressedByBaseline: 1, unknown: 1 }` — the
  quiet-number rule applied to the faucet itself.
