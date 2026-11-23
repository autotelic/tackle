# 0030 — TAC-15 — spans belong in the domain; presence is a pull

## 1. Tracing

**The boundary is not “host only”.** It is “the host owns the *provider*, the domain owns the *attributes*”:

- `Effect.withSpan` / `Effect.annotateCurrentSpan` are **pure** — no IO, no env, no exporter. Calling them
  from a domain package is the same shape as receiving `now` as a parameter.
- The domain is the **only** place that knows `leaseId`, `generation`, the message TID and the verdict. Put
  tracing only in the binaries and those attributes are invented at the edge, where they are guesses.
- What must never enter a domain package: `@effect/opentelemetry`, an OTLP endpoint, `OTEL_*`, any SDK
  construction. That is the rule worth writing, and it extends `domain-purity` by one line.

Concretely: `@effect/opentelemetry@4.1.5` **is already in the catalog with no consumer** (verified in
`pnpm-lock.yaml`), so wiring a host is one `"@effect/opentelemetry": "catalog:"` line and a `TelemetryLive`
that is `Layer.empty` when `OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Default off; tests and CI never export.

Two decisions that must be made before the first span leaves the box:

1. **Cardinality.** IDs on *spans*; bounded dimensions on *metrics* (room, command, verdict, error name).
   A TID or a `leaseId` as a metric attribute is an unbounded series, and it is the mistake that is
   expensive to undo because the data has already been written.
2. **Sampling weighted by refusal.** A bench is chatty and its interesting events are rare — a blanket 1%
   misses every refusal, which is the one thing we want to see. So a small `SpanProcessor` that keeps
   spans where `verdict != ok`, a saga retried, or a room blocked, and drops the rest.

**Axiom is not the first exporter.** Plain OTLP first: one env var, no vendor code, and the endpoint can
be an Axiom or a Collector URL without touching the tracer. Vendor translation belongs in a collector —
“provider adapters stay outside core” is the same rule as the mailbox.

## 2. Discovery

**Pull, and the reason is truth rather than cost.** Presence is an observation about *now*; mail is a record
about the *past*. Push a heartbeat and you cannot tell “the shop is dead” from “the network dropped one
message”, and a stale heartbeat record *looks* like presence — the quiet-number problem, in the one place
where being wrong means a room is unreachable and nobody knows.

Three more reasons, in order of how much they cost later:

- the mailbox is addressed **1:1** (`senderDid → recipientDid`); presence is **1:N**. Pushing either
  broadcasts N× per tick or builds a “presence desk” everyone reads, which is a feed — and the mailbox is
  not a feed.
- pull gives every reader an `observedThrough`, exactly as at-seam 0021/0023 require. A fold then has
  three honest states per shop: **online + fresh · online + stale · unreachable**.
- `presence.json` is **derived**, never authored: a projection of the shop's own in-memory state. Same rule
  as the catalog — the generator owns the bytes.

Shape: host list from Tailscale → `GET https://<shop>/well-known/presence.json` → fold. Served on the
tailnet listener only, `no-store`, cheap (in-memory, no disk scan), no paths, no secrets, no message
bodies.

**The one field that must be named carefully:** the lease. `presence.lease = { leaseId, generation,
observedAt }` is a shop's *belief*, and the authority is the authority. If the field is called `lease`
plainly, somebody will build a takeover on it inside a month — the “read is not the fence” mistake again.
Call it `beliefs.lease`, or say “hint” in the schema's description.

**Open question:** does `presence.json` list rooms as well as the shop? My vote: yes, bounded to the
rooms this shop holds with their state and lease *hint* — because “which shop has a live room for
dev-1575” is the question a human actually asks, and it is one line per room, not a message.
