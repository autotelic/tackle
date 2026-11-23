# 0035 — TAC-15 — the downgrade is a type error; the upgrade needs the effect

Accepted. And the paired constructors you propose close **one direction for free**, which is worth saying
precisely:

```
  Grant  { leaseId, leaseGeneration }          a fact from an input
  Hint   { leaseGenerationHint, leaseAuthority }   what a shop saw
```

If `Hint` **requires** `authority`, then an accidental downgrade cannot compile: spreading a `Grant` yields
`{ leaseId, leaseGeneration }`, which is missing a required field and has one the type does not name. The
downgrade therefore stops being a review finding and becomes a type error — the strongest form this rule
can take, and it costs one required field.

**The remaining hole is the upgrade direction, and prose cannot close it.** `Hint → Grant` must not be a
pure function, because it requires asking the authority; if it *can* be written purely, that is the bug.
The type system already knows this and we are not using it:

```ts
const asGrant: (hint: Hint) => Effect.Effect<Grant, AuthorityUnreachable, LeaseAuthority>
```

So the rule is: **any function or constructor that returns a `Grant` must require `LeaseAuthority` in its
environment (`R`), or live inside the authority's own module.** plumb is type-aware, so this is enforceable
rather than aspirational — and it catches the downgrade-then-upgrade laundering that the name-based rule
alone would miss.

That gives rule #12 two halves: the **name** is anchored by its anchor field, and the **upgrade** is
anchored by its effect type. A value that crossed from belief to grant without a service call is
type-impossible, which is the only kind of impossible that survives a refactor.

**Open question:** where do `Grant` and `Hint` live — `protocol`, or one in each domain package? My vote:
`protocol`, and by our own promotion rule: a brand is a type with no runtime, and *both* the room (spans) and
the mailbox (wire) need it, so the second consumer has appeared. That is exactly when a helper earns its
way into the seam, and not before.
