# 0027 — TAC-15 — both are exceptions, and the second costs no code at all

**(1) `deviation-has-a-shape` on `EngineRef` / `IgnoreRule`: exception — but not for the reason offered.**

“It is a breaking config schema change” is a *cost*, and the goal forbids a baseline, not a refactor. The
reason that actually holds is different: **an `at` or an authority field in authored config would be a
lie.** A repo's ignore list has an authority (the committer) and an instant (the commit) already; writing
them into the JSON invents a second, rottable copy of a fact git owns. The rule is right about *records*
and wrong about *config*, and the narrowing should say exactly that, in those words.

What the rule is actually missing is not in the config — it is in the run: **the report has no
`suppressed` field.**

```
report.json top level: lexicon · counts · files · diagnostics · generators · elapsedMs
```

So when an ignore fires, nothing in the evidence says so. That is the deviation without a shape: not the
config entry, the *use* of it. The fix is one additive field — `suppressed: [{ rule, path, reason }]` —
which our own lexicon rule permits, and which turns “3 ignores were used” into something a reviewer can
see. Do not do it in this pass: report schema means protocol, fixtures, renderers and every projection.
Narrow now with that as the reason; open the field as its own change.

**(2) `reversal` on `isTestPath` / `isTid`: exception, and no helper, no refactor, likely no diff.**

```
mailbox/src/tid.ts:9    export const isTid: Predicate.Predicate<string> = (value) => TID.test(value)
cutlist/src/crawl.ts    export const isTestPath: Predicate.Predicate<string> = …
```

Both are **already** instances of `Predicate.Predicate<string>` — the shared abstraction exists, is
explicitly declared, and comes from a dependency both packages already have. The rule is reading a shared
*type* as a shared *shape*, which is a false positive of the kind TUNING.md expects: the narrowing reason
is “the shared element is a type, and it is already written down.”

A `regexPredicate` helper in `protocol` would be worse on both axes: protocol is chartered as *no
dependencies and no runtime*, and a three-line util would couple cutlist and mailbox for nothing. **If a
helper is ever genuinely needed, it goes in the package that needs it first**, and is promoted later only
if a second package reaches for it — never the other way round.

**Cheaper path for the batch:** do not touch `protocol` anywhere in this sweep, including the narrower
rules themselves. Every one of the 31 gets a code fix inside its own package or a file-scoped narrowing
with a written reason. `protocol` is the seam — the one place where a compatibility promise lives — and a
conformance sweep is the wrong reason to edit it.

**Open question:** do the narrowing reasons live **in the plumb config** next to the pattern, or in one
page of prose? My vote: in the config, one line each — a reason that lives away from its rule is a reason
nobody reads when the rule changes, and jig already prints narrowings with their reasons.
