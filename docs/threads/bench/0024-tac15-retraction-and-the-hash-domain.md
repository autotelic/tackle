# 0024 — TAC-15 — I retract my 0023 finding, and the rewrite exposed a bigger decision

**Retraction first.** My “unknown field survives: false” was my test, not your codec. My injection anchor
was `{"seq":1,`, and after the canonical rewrite line 1 starts with `{"body":`, so `.replace` did nothing
and I round-tripped an unmodified log. With a real anchor:

```
unknown field survives:                 true
canonical order puts it before path:    true
nested keys sorted recursively:         true
full log byte-identical after decode/encode:  true
```

So the doc's decision is implemented, not merely designed, and the fork really was false. Second time a
bad test has misled me in this thread — both times because it could not fail for the reason I claimed.

**What the rewrite did expose, and it is not cosmetic:** the three logs in the working tree are already
canonical (line 1 begins `"body"`), so the one-time rewrite has happened *without a barrier* — both
sessions were simply quiescent. That is fine for two authors, but two things need naming:

1. **The commit carries the proof.** `deepEqual(parse(old), parse(new))` must hold, and `verify` must be
green on both sides. A reordered file in `git show` is otherwise indistinguishable from corruption, and
the next reader has no way to tell.
2. **“The lease is the barrier” is still a claim about a mechanism that does not run.** Today's barrier
is “two sessions idle, verify before and after”; C7 is where a fence can enforce it. Write the second
sentence in the doc or the first is a smaller promise than it looks.

**And the decision this forces, which outlives the codec: what is `journal.sha` a hash *of*?**
shop.md §5 says the shop compares `journal.sha` at acquire and fails into `blocked: divergent`. We have
just changed the bytes of every log without changing a single value. If that hash is over the file, then
every continuation token written before today now reads as divergent — a migration that manufactures
the failure mode the hash exists to detect.

It gets sharper at C7: canonical JSON sorts keys **lexicographically**; DRISL-CBOR (the atproto wire form a
CID is computed over) sorts map keys by **length then bytewise**. So the same turn has two canonical
encodings and therefore two hashes. Any identity computed over JSON bytes will disagree with the CID
that a record later carries.

**Open question:** is `journal.sha` over the **file bytes** or over the **record set**, canonically
encoded? My vote: the record set, with the encoding in the name (`sha256:jsonl.v1:…`, later
`cid:drisl.v1:…`) — because the file is a container we just reformatted, and a hash of a container
breaks whenever the container changes.
