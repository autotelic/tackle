# Observability: spans in the domain, presence by pull

Two questions arrived together and turned out to share one rule: **every field we emit is a claim, and a
claim needs a test or it is decoration.**

---

## 1. Tracing

### The boundary

Not “telemetry lives in the host”. It is: **the host owns the provider; the domain owns the attributes.**

- `Effect.withSpan` and `Effect.annotateCurrentSpan` are **pure** — no IO, no environment, no exporter.
  Calling them from a domain package has the same shape as receiving `now` as a parameter.
- The domain is the **only** layer that knows `roomId`, `leaseId`, the message TID and the verdict. Move the
  annotations to the edge and they become guesses.
- What must never enter a domain package: `@effect/opentelemetry`, an OTLP endpoint, `OTEL_*`, any SDK
  construction. `effect` itself is already allowed, so `domain-purity` gains exactly one line: **the
  exporter is the only thing that stays out.**

`@effect/opentelemetry@4.1.5` is **in the catalog and consumed nowhere**, so wiring a host is one
`"@effect/opentelemetry": "catalog:"` line plus a layer that is `Layer.empty` when
`OTEL_EXPORTER_OTLP_ENDPOINT` is unset. Default off; tests and CI never export.

### Two decisions before the first span leaves the box

**Cardinality.** IDs on _spans_; bounded dimensions on _metrics_ (room, command, verdict, error name). A
`leaseId` or a TID as a metric attribute is an unbounded series, and it is expensive to undo because the
data is already written. A DID that repeats is fine in a span — that is bytes, not a series.

**Sampling weighted by refusal.** A room is chatty and its interesting events are rare. A blanket 1% misses
every refusal, which is the thing worth seeing. A small `SpanProcessor` keeps spans where `verdict != ok`,
where a saga retried, or where a room blocked; the rest are dropped.

### Exporter

Plain OTLP first: one environment variable, no vendor code, and the endpoint can later point at Axiom or a
Collector without touching the tracer. **Vendor translation belongs in a collector** — the same rule as “provider
adapters stay outside core”. Axiom can be provisioned by Alchemy without being the tracer's dependency.

### The attribute names, and the test that keeps them honest

```
  roomId            the room
  leaseId           the grant this command carried
  leaseGeneration   that grant's generation — anchored by leaseId, so it is a fact about the request
  messageId         the mailbox TID
  verdict           ok | refused:<Name> | blocked | divergent
  state             the aggregate state after the command
```

**Two beliefs, two names — and the anchor is what makes a generation meaningful.** The span records the
grant the command _carried_: `leaseId` + `leaseGeneration` is a pair taken from the input, so the number is
anchored and unambiguous. Calling it a hint would make a real grant look uncertain and weaken the trace.

Presence carries no `leaseId`, so a bare generation there is unanchored — it can only be what the shop last
saw. That field is `leaseGenerationHint` beside `leaseAuthority` ("what we saw, and who can confirm it"),

and takeover reads only the grant. Renaming presence to `leaseGeneration` invites a takeover on a hint;
renaming the span to `…Hint` throws away a fact.

The rule, stated once: **a generation without its `leaseId` is a hint; a generation with its `leaseId` is a
grant.** One name per belief, not one name per concept.

**The contract test spells these as literals and never imports the production constant:**

```ts
const span = spans.find((s) => s.name === "Room/PauseRoom")
expect(attributes).toEqual({ roomId: "…", leaseId: "3n2…", leaseGeneration: 7, verdict: "ok" })
```

A test that imports the contract moves with any rename and passes on the way to production. The literal
makes a rename a deliberate two-file change, which is exactly the point. It also means **the test is the
only place the names are duplicated on purpose, and the duplication is the check.**

That is a change-detector test — usually a smell, because it duplicates _implementation_. It is correct
here because it duplicates _contract_. Every such test carries one line saying so:

```ts
// Spelled literally on purpose: this name is telemetry surface. Renaming it is a migration.
```

Without that line, the next maintainer “fixes” the duplication by extracting a constant and deletes the
only check we have.

---

## 2. Presence

### Pull, and the reason is truth before cost

Presence is an observation about **now**; mail is a record about the **past**. Push a heartbeat and “the shop is
dead” becomes indistinguishable from “the network dropped one message” — and a stale heartbeat record
_looks_ like presence. That is the quiet-number problem in the one place where being wrong means a room is
unreachable and nobody knows.

Three more reasons, in order of how much they cost later:

- the mailbox is addressed **1:1** (`senderDid → recipientDid`); presence is **1:N**. Pushing is either N
  broadcasts per tick or a presence desk everyone reads, which is a feed — and the mailbox is not a feed.
- pull gives every reader an `observedThrough`, so the fold has three honest states per shop: **online +
  fresh · online + stale · unreachable**.
- `presence.json` is **derived**, never authored: a projection of the shop's own in-memory state. Same rule as
  the catalog — the generator owns the bytes.

### Shape

```
  GET https://<shop>/well-known/presence.json       Tailscale listener only, no-store

  {
    "shop": "mini",
    "observedAt": "2026-11-21T17:40:00Z",
    "rooms": [
      { "id": "acme-web~dev-1575", "state": "working",
        "leaseGenerationHint": 7, "leaseAuthority": "did:web:autotelic.dev" }
    ],
    "sessions": { "herdr": [...], "rex": [...] }
  }
```

Served from memory, cheap, no disk scan, no paths, no secrets, no message bodies. Served on the tailnet
listener only.

**The lease field is a belief.** `leaseGenerationHint` plus `leaseAuthority` says “this is what we saw and
who can confirm it”. Takeover reads only the grant. If the field were called `leaseGeneration`, somebody
would build a takeover on it inside a month — the “read is not the fence” mistake, in a new costume.

### What presence does not carry

Inventories are not messages, and the reverse is also true: the mailbox never carries a presence record.
A message that says “I am alive” is a heartbeat wearing mail, and it inherits every problem pull exists to
avoid.

---

## 3. The rule both halves share

| claim                                          | how it is checked                                        |
| ---------------------------------------------- | -------------------------------------------------------- |
| a span is named and annotated as documented    | a recording `Tracer` layer, literal names and attributes |
| a presence field exists and means what it says | a literal-asserting test on the rendered file            |
| the exporter never enters a domain package     | `domain-purity`, +1 line                                 |
| the hint is never promoted to authority        | the name, plus the schema description                    |

An annotation nobody reads is an assertion nobody ran; a field nobody renders is a shape nobody checked.
