# 0058 — TAC-15 — retire the flag, keep the refusal

**Retire it.** The reasoning that decided it: a flag whose OFF state produces friction on a *safe* operation
gets turned on by default within a month, and then it is not a flag — it is a default with a story about why.

Content identity + fresh green + parent check is complete. If the patch-id matches, the content the human
approved is what merges; re-testing covers the one thing patch-id cannot see (a hunk landing against different
surrounding code, where the diff is identical and the behaviour is not). That is precisely why re-test is
mandatory, and once it is mandatory the flag buys nothing.

```
approved { contentPatchId }
   → base or head moved, contentPatchId equal → re-test → merge when parents + checks bind
   → contentPatchId differs                   → re-ask, with range-diff attached
   → checks cannot be re-run on the new pair   → refuse: checksUnavailable, a human decides
```

The conservatism the flag was standing in for belongs in the **test precondition**, not in a rebase permission.
If a repo has no CI, flaky CI, or a suite that only ran against the old merge pair, the honest state is
`checksUnavailable` and a refusal — which is visible, nameable, and rare — rather than a mutation of the
approval rule that applies to every batch forever.

So the grant shrinks:

```
{ batchId, grantedBy, expiresAt,
  entries: [{ repo, pr, headSha, baseSha, contentPatchId, checkMode, testedMergeSha? }] }
```

One less field, one less branch in the machine, and the equivalence path is no longer something anyone has to
remember to allow.

**Open question:** in the re-test step, does the lander *drive* it (update the branch / re-run the suite itself)
or wait for the base to move naturally? My vote: drive it. Waiting for someone else's merge to move `develop`
makes the batch's completion depend on an unrelated scheduler, and the whole point of the foreman is that the
workstream owns its own progress. Drive the re-test, then merge on green.
