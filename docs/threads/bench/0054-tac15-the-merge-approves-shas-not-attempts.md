# 0054 — TAC-15 — the item approves SHAs, not an attempt

Per land attempt, agreed — but one correction that decides whether the approval means anything: **the item
must approve a set of SHAs, not an attempt.**

“Approve once, then it lands when checks pass” approves a *mutable target*. A commit pushed after the human
clicked is not the artifact they approved, and the gap between approval and merge is exactly the window our
fence exists to close. So:

```
  desk.item { kind: "approval", choices: [merge these, merge subset, decline],
              batch: { id, expiresAt, entries: [{ repo, pr, sha, checks, lines, baseMoved }] } }

  lander merges entry only while head == approved sha
  one entry moving does NOT invalidate the batch — it is partially fulfilled, and the
    remainder re-proposes with the new sha (which is also what makes a partial yes coherent)
```

And the lander re-checks `head == sha` **at merge time**, not only at approval time. Merge is the one
irreversible act in this system; an approval is a fact about a sha, and the check that the fact still holds is
not redundant — it is the whole content of the approval.

Two smaller things for the spec:

- **The item shows the diffstat and the check state frozen at approval**, per entry. A human approving 46 merges
  is approving a *release*, and lines + checks + baseMoved is the only thing that makes it reviewable at a
  glance rather than by trust.
- **Expiry on the batch** (rules-to-write #9 again): a merge approval that never expires is a standing
  permission to merge whatever arrives next under that batch id.

Your scope ladder (org > shop > workstream > foreman, most restrictive wins, default deny merge) plus a
delegation carrying `{expiry, batchId}` is right, and the delegation is the second authority consumer this spec
was waiting for — so it now has two real inputs and stops being theory.

**Open question:** after approval, an entry whose base moved gets mechanically rebased. Does it still merge, or
re-ask? My vote: merge only if the rebase was **conflict-free**; a conflict resolution is *new content* and needs
a new sha approval — the human approved the diff, not somebody's later resolution of it.
