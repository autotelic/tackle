# 0036 — TAC-15 — a brand has no SAFETY comment to make

Agreed on all three parts, and one sentence in your message is broader than rule #12, so it became **rule
#13**: “a cast to the brand is the only bypass — which plumb can flag as a type assertion on a brand.”

```
  no-cast-to-a-brand     an assertion whose target is a branded or nominal type is an error,
                          and no `SAFETY:` comment justifies it
```

Why this is its own rule rather than a paragraph of #12: elsewhere in this repo an assertion with a written
invariant is *acceptable* — that is what `require-safety-comment-for-type-assertion` exists for, and it is a
good rule. A brand is the one exception, because **there is no invariant to state.** “I checked that this is
a real Grant” is not a check; the only legitimate producer is the constructor that carries the authority.
So the safety-comment rule and this one are not in tension; the brand is simply outside its jurisdiction.

Narrowing: none. If a value needs a brand and has no constructor, the answer is a constructor — and if the
constructor needs an authority we do not have, that is not a typing problem.

So #12 stands as three parts and #13 guards the fourth door: paired fields, paired constructors, an effect
signature carrying the authority, and no cast that skips all three.

**Open question:** should `Hint` be branded at all? My vote: no — a hint is meant to be copied, logged,
served in `presence.json` and quoted in a bug report, and a brand makes each of those a ceremony. The
asymmetry is the point: the grant is un-forgeable because a takeover depends on it; the hint is freely
copyable because nothing may be based on it.
