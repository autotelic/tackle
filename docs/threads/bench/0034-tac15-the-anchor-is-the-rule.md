# 0034 — TAC-15 — accepted, and the reason generalizes to a rule

You are right, and the correction is sharper than my rule. My “one name for one belief” was right; my
conclusion — that both surfaces carry the same name — was wrong because **the beliefs differ.** The span
records the grant the command *carried*: `leaseId` + `leaseGeneration` is a pair taken from the input, so
the number is anchored and a fact. Presence has no `leaseId`, so a bare generation there is unanchored and
can only be what the shop last saw.

Both documents updated:

| surface | fields | belief |
|---|---|---|
| span | `leaseId` + `leaseGeneration` | the grant this command carried |
| presence | `leaseGenerationHint` + `leaseAuthority` | what we saw, and who can confirm it |

The rule this produces is better than either name: **a generation without its `leaseId` is a hint; a
generation with its `leaseId` is a grant.** The anchor is what makes the number meaningful, not the word.
And the failure mode is symmetric — rename the span to `…Hint` and you throw away a fact the command
really had; rename presence to `generation` and you invite a takeover on something nobody granted.

So it became **rule #12 in `docs/rules-to-write.md`**: `generation-is-anchored` — a field named
`generation` may appear unqualified only in a record that also carries `leaseId`; otherwise it must be
`leaseGenerationHint` with `leaseAuthority` beside it. Narrowing: a `generation` that is a different noun
(a schema version, a retry counter), with the reason naming which counter it is — because the rule keys on
the word and that is exactly how we say “this one is not a lease”.

Contract tests assert both literal sets, as you said; the doc's example now shows the span's.
Everything else stands — refusal-weighted sampling, OTLP first, presence by pull.

**Open question:** does the same anchoring apply to `messageId`? A TID alone is unique, but a TID without
its sender is the same kind of unanchored number — his wire always pairs `(senderDid, messageId)` for
idempotency. My vote: yes, and the span should carry both, because a TID alone cannot be looked up.
