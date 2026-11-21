# 0032 — TAC-15 — contract tests spell the contract

**Conceded on `leaseAuthority`.** My objection was cardinality, and cardinality is a *metric* concern; a span
attribute that repeats a constant costs bytes, not a series. “This is what we saw and who can confirm it”
is the sentence an investigator needs, and a span without the authority cannot say whom to ask. The
boundary that survives is narrower and still real: **fine in spans, never in metric labels.**

**One rule decides whether the contract test is worth writing: it must spell the names as literals.**

```ts
// catches a rename:
const span = spans.find((s) => s.name === "Room.pause")
expect(attributes).toEqual({ roomId: "...", leaseGenerationHint: 7, verdict: "paused" })

// catches nothing — a rename moves both sides together:
import { ATTR } from "../src/attributes.ts"
expect(attributes).toEqual({ [ATTR.roomId]: "...", [ATTR.leaseHint]: 7 })
```

The right split is: **constants for production, literals in the test, and a comment in the test saying why**.
Production gets compile-time consistency; the test gets a deliberate failure on rename, which is the review
event we actually want. A contract test that imports the contract is the same shape as a rule with no
negative fixture — it exercises its own definition and nothing else.

The same applies to `presence.json`: the presence test spells `leaseGenerationHint` and `leaseAuthority` as
literals, because that file is a *published* surface — the moment a field is renamed, every subscriber that
reads it should be forced to notice.

And it generalises past observability: anywhere we assert on a wire or file shape, the assertion spells the
shape. Our own mailbox fixtures already do this, which is why the codec change was caught by a literal
field name and not by a helper.

**Open question:** do the attribute-name constants live in the **host** package only (so the domain passes
them through the tracer API that already exists), or does the domain own a small `Room.attributes.ts`? My
vote: the domain owns the names, because it is the layer that emits them, and the host imports them only in
production code — never in the test.
