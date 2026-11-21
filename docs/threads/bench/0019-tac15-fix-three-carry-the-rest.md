# 0019 — TAC-15 — fix three, narrow one, carry the rest (and the count is 41, not 30)

I ran it: **41 mailbox findings across 18 rules**, not 30.

```
  6 no-runtime-typeof          4 require-jsdoc-on-exported     4 no-unsafe-dictionary-type
  4 no-conditional-empty-object-spread  3 require-sort-comparator  3 plumb-effect/no-try-catch
  2 no-nondeterministic-core   2 no-reinterpret-cast           2 require-safety-comment-*
  2 prefer-effect-predicate    2 no-unknown-parameters         + 9 singletons
```

My vote is not “before” or “after”. It is **split by kind**, because two of those rules are not debt
they are the design, and one is not a mailbox finding at all.

**Fix now — 3.** `no-nondeterministic-core` ×2 (`append.ts:41`, `Date.now`). The plan says the domain
packages are pure and the server owns the clock; a `Date.now` in `append.ts` is exactly the fact that
will *survive* the domain split without anyone noticing, because it sits in a file that gets moved
rather than rewritten. Inject the clock now, in the old shape, so the split moves a pure function.

**Narrow the rule — 1, and it is not ours to fix.** `no-sql-string-interpolation` fires on
`log.ts:55`, which is:

```ts
throw new LogError(`${where}: backfill.from must be string[]`)
```

There is no SQL in this package. That is a **false positive of the plumb rule**, and the response to a
false positive is the TUNING.md ladder — narrow the question, don't work around it in the caller.

**Carry the other 37 in a ledger with a deadline — C6.** Inside `no-runtime-typeof` (6),
`no-unsafe-dictionary-type` (4), `no-unknown-parameters` (2) and
`guarded-op-must-return-option` sit the actual answer: decode with Schema, don't narrow with `typeof`.
That is *what C6 rewrites*. Fixing them now is writing the code twice, and the second version is the
one that ships.

But the ledger must be checkable, and it must not be a baseline. Baseline = accepted, forever, by
identity. Ledger = **tolerated until a milestone, and shrinking** — `{ milestone: "C6", identities[] }`
with a `pnpm debt:check` that fails when the set **grows**, and fails when an identity in the ledger
no longer appears (so it can only shrink deliberately, never rot in place). Two mechanisms, two
meanings; refusing one and relying on memory for the other is how the second becomes the first.

**Open question:** is C6's acceptance “mailbox findings = 0”, or does that wait for C11? My vote: C6 —
the rewrite is the cheapest moment to reach zero, and a cleanup commit after the wire always gets
dropped.
