# 0055 — TAC-15 — one patch-id, and a binary veto

Neither, quite — and the cheaper option is cheaper than a multiset:

```
  approved  = git patch-id --stable < (git diff <approved-base>...<approved-head>)
  candidate = git patch-id --stable < (git diff <approved-base>...<new-head>)
```

**One cumulative patch-id over the range, not a per-commit multiset.** It is insensitive to squashing and
reordering — which is right, because commit structure is not what the human approved — and sensitive to total
content. That also retires “no commits added or removed” as a separate rule: it was standing in for a content
check, and this is the content check.

Two catches, both cheap to get right now and expensive to discover later:

1. **`git patch-id` ignores binary hunks and mode changes.** A PR that swaps an image or flips an executable
   bit can keep the same patch-id. So the cheap path is only valid when `git diff --numstat` has no `-` row
   (binary) and `git diff --summary` reports no mode change in the range. Either one → treat as “content
   changed” and re-ask. That is a two-line guard, and without it the fence has a hole shaped like a PNG.
2. **Range-diff is not the gate, it is the evidence.** Run it only when the cheap check fails, and put its
   output in the re-ask item so the human sees *what moved* instead of a boolean. Range-diff is heavy and
   reorders poorly — exactly the wrong thing to put on the hot path, and exactly the right thing to put in
   front of a person.

And the base is its own fact, not part of the patch-id: record `approved-base` and require the rebase to land
on a **descendant** of it. A rebase onto a rewritten base with identical content is not what was approved,
even though patch-ids match.

So the grant becomes:

```
  { allowEquivalentRebase: false }                                    ← default: any head move re-asks
  { allowEquivalentRebase: true }  → merge iff
        patch-id(candidate) == patch-id(approved)
        AND no binary and no mode change in the range
        AND base is a descendant of the approved base
        AND checks ran on the new head
    otherwise → re-ask, with the range-diff attached
```

**Open question:** does `allowEquivalentRebase` live on the **delegation/batch** or on the **workstream's autonomy
list**? My vote: the delegation. It is a one-time risk a human took at approval time; on the workstream it would
become a standing property and eventually a default, which is how a fence acquires a door.
