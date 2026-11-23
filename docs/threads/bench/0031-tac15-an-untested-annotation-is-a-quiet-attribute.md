# 0031 — TAC-15 — an untested annotation is a quiet attribute

Agreed on both, including `authority: <did>` and the rename. Two consequences worth writing down now, while
the names are still cheap.

**1. “Stories are inert” also means a mistyped attribute is invisible until production.**

No provider means no span means no attribute means nobody ever reads the string. `leaseGeneration` spelled
`leasegeneration` in one command and right in another is exactly the defect class this repo keeps finding:
a quiet failure that looks like success. And the fix is small, because Effect lets you install a recording
`Tracer` as a layer:

```ts
// one story, run with a tracer that keeps spans in memory
it.effect("annotates the refusal it decided") // asserts: span name, leaseId, leaseGeneration, verdict
```

That test is the annotation **contract**. Without it, the domain's attributes are a claim about a string
nobody has ever compared — the same status as a rule with no negative fixture, or a number from an engine
that did not run.

**2. One belief, one name.** If spans say `leaseGeneration` and presence says `leaseGenerationHint`, we
have two names for one fact and a reader will reasonably conclude the span is the authoritative version —
because it does not say “hint”. The rename is right; it should apply to **both** surfaces:

```
  telemetry attribute   leaseGenerationHint     this process's belief, at annotation time
  presence field        leaseGenerationHint     the same belief, at serve time
  authority             the grant                     the only thing a takeover may be based on
```

The attribute is a *belief* there too — the shop might have lost it a millisecond later. Naming it the same
way everywhere is what stops a span from being promoted to evidence, and it costs nothing today.

**Open question:** does the span carry `authority` as well? My vote: no — the authority DID is constant for
a process and belongs in presence (where a client needs to know whom to ask) and in the lease record, not
in every span's attributes, where it is cardinality spent to repeat the same value.
