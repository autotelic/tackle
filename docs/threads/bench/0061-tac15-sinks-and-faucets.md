# 0061 — TAC-15 — two faucets, one sink, and neither changes your kernel

Two docs, both written to *slot into* what you are building rather than beside it.

**`docs/signals.md` — the faucets.** Runtime telemetry entering the factory to hill-climb experience. The rule is
three filters: **a signal is an observation; a candidate needs a threshold, a baseline and an attribution; a ticket
needs a human.** Sources are pulls with watermarks (our OTLP, Cloud Error Reporting, Cloud Logging, Cloud Trace,
Cloud Profiler, Cloud SQL Query Insights, Actions, deploy markers).

The one piece of leverage only we have: `work.ship.sha` ↔ deploy marker ↔ telemetry window, so **a regression is
attributed to the workstream that shipped it**, with PR and receipt attached. Compare against the *previous deploy*,
never “last week” — a step change is exactly what a ship produces — and record the boring case too (“shipped 7c9e,
no drift in 2h”), because that is what lets a quiet period be trusted.

It reuses the reconciliation record with `kind: "experience"` and four states (`regressed · improved · stable ·
unknown`), a `signals.json` per workstream with SLOs, a `settle` window, `minSamples`, `maxProposalsPerCycle: 3`,
and an `experience.baseline` ratchet so a known-slow route stops re-proposing. Privacy is aggregates-only: routes,
percentiles, durations, shas; no user ids, no parameters, no query text unparameterized.

**`docs/slack.md` — the sink.** One bot per factory, **channel per area, thread per workstream, persona per message**
(`username`/`icon_emoji` with `chat:write.customize`). Three surfaces with three cadences: digest ≤1/area/hour, one
message per item, thread on demand. Inbound: button → `desk.answer`, prose → a note, `@factory <id>` → steer,
reaction → nothing.

And the three things I would take from Amp's Spaces, plus three I would not: their “comments are human-only until
someone mentions the agent” is worth copying literally; their all-or-nothing public-channel-only routing is wrong
for a workstream that needs review comments to reach it; their multiplayer security note — **the agent refuses to
change account settings, secrets or configuration in a multiplayer thread** — is the sharpest rule in their docs,
and it generalizes to: the more humans can watch, the narrower the autonomy.

**Neither touches your event shape, your report shape or your apply path** beyond one new `kind` and one new refusal.
That is deliberate: a faucet and a sink are transports, and a transport that changes the ledger is not a transport.

**Open question:** does `kind: "experience"` on the reconciliation record survive your apply path, or do you want a
separate record type so `board apply` stays single-purpose? My vote: one record type with a `kind` discriminator,
because the apply semantics are identical — proposal, evidence, refusal, receipt — and two record types means two
apply paths that drift.
