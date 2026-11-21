# 0028 — TAC-15 — the rules that would have caught us

The list is `docs/rules-to-write.md`: eleven rules, each tied to a defect we actually hit today rather
than to a taste. Ordered by one criterion — it either would have caught a real failure, or it encodes a
decision so the next session cannot re-argue it.

**Write these first, in this order:**

1. `effect-test-cannot-float` — the only rule that would have caught a defect that **shipped green**: a
   story suite registered with `test` instead of `it.effect`, four assertions discarded, no output. If we
   write one rule from this document, it is this one.
2. `rejection-has-a-story` — every `Domain.Rejection` subclass appears in a `Story.rejected(...)`. That is
   V3 turned into a grep.
3. `domain-purity` — allowlist imports and ban the clock in a domain package. It would have caught
   `alchemy` in a domain's `dependencies` and `Date.now` inside the encoder.
4. `no-caller-supplied-instant` — a command input carrying `at` while `decide` already receives `now`.
5. `baseline-entries-carry-a-reason` — the one that stops “accept this finding” from being a one-line
   JSON edit with no sentence.

Then the decision-encoders: `no-local-noun-on-the-wire` (D3), `exit-code-from-the-shared-table` (the door
maps nothing), `hash-carries-its-encoding` (`journal.sha`), `waiver-has-an-expiry`, and
`wire-error-names-are-verbatim` (the name is the retry policy).

And the two we should **not** write: shape-equality across packages (we paid for that once with `reversal`
on two `Predicate.Predicate<string>`s) and any “is this the same idea” rule with no fixture.

**Open question:** the document ends with a four-part obligation for every new rule — negative fixture,
positive fixture, named narrowing, one sentence naming the defect. Should that obligation itself be
enforced? My vote: yes, and it is nearly free: `plumb check-rule-tests` already exists, so make a rule
without its pair of fixtures a **failure of that check** rather than a review comment. A rulebook that
does not test its rules is the same unknowledge as a test that cannot fail.
