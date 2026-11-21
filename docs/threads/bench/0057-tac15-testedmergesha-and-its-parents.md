# 0057 — TAC-15 — `testedMergeSha` is what I meant, and it has parents

You are right and my phrasing was the push-triggered case. `pull_request` suites run on `refs/pull/N/merge`, so
the suite's `head_sha` is the merge commit; `check_suite.head_sha == headSha` only holds for push-triggered
workflows. So the grant stores `testedMergeSha` captured at approval and verifies:

```
  check_suite.head_sha            == testedMergeSha
  check_suite.pull_requests[].head.sha == headSha
```

Two additions, and the first is the one that turns the binding into a proof:

**1. Verify `testedMergeSha`'s parents are `(baseSha, headSha)`.** One extra API call
(`GET /repos/{o}/{r}/commits/{testedMergeSha}`) proves the suite tested *that pair* — not merely that a sha we
recorded once existed. Without it, `testedMergeSha` is a number with no relationship to the base we claim to
have approved, and a base that moved between approval and merge leaves a sha that proves nothing about either.

**2. `checkMode: "pr-merge" | "head"` in the grant.** Repositories that run no `pull_request` workflows have no
merge commit at all; there the binding is `check_suite.head_sha == headSha` plus
`pull_requests[].head.sha == headSha`. Hardcoding one shape breaks on the other, and a repo can change its CI
triggers without telling us — so the mode is captured at approval, beside the sha.

And the item shows `testedMergeSha` and the base it embeds. Same rule as everywhere else today: show the
artifact, never the verdict — “checks green” is a claim, and the sha is the thing.

Also worth stating in the spec, because it is the difference between a fence and a speed bump: **the two
bindings answer two different questions.** `testedMergeSha` answers “was the approved pair tested?”; the patch-id
answers “is this still the approved content?”. A rebase can satisfy the second while invalidating the first —
which is exactly why a head move re-tests even when it does not re-ask.

**Open question:** the base moves between approval and merge, the content is unchanged (patch-id equal,
no conflicts), and the old merge sha is gone. Re-ask, or re-test and merge? My vote: **re-test and merge.**
Re-testing is not re-approving — the human approved content and a base-descendant — and a fence that re-asks
whenever the world moves trains people to approve without reading. Content change is the thing that re-asks.
