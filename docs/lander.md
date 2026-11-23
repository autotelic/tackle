# The lander

The fence around the one irreversible act in this system. Everything here came out of `docs/threads/bench`
turns 0054–0058; this file is the spec, those turns are the argument.

---

## Why a lander exists

A foreman never merges. It makes work **mergeable** — checks green, conflicts resolved, description accurate,
reviewers requested — and then stops. Landing is a separate authority because merging is the only operation
whose mistake a revert does not fully undo.

This is the **second authority consumer**, which is why the policy spec stopped being theory: before the lander,
the desk was the only thing that could approve work.

---

## The grant

One grant per **land attempt**, not per round of changes. It carries no ref names — every fact that identifies
an artifact is a sha.

```ts
interface Grant {
  readonly batchId: string // also the mutex key (see below)
  readonly grantedBy: string // the DID that clicked
  readonly expiresAt: string // rules-to-write #9: a waiver with no expiry is permission by inattention
  readonly entries: ReadonlyArray<{
    readonly repo: string
    readonly pr: number
    readonly headSha: string // the branch head at approval
    readonly baseSha: string // the base COMMIT, never a moving ref
    readonly contentPatchId: string // cumulative patch-id, see Content identity
    readonly checkMode: "pr-merge" | "head" // captured at approval; CI triggers change
    readonly testedMergeSha?: string // present when checkMode is pr-merge
  }>
}
```

`base: "origin/develop"` is meaningless: by merge time it has moved, and every rebase is trivially a
descendant of it. The item prints the ref beside the sha for humans; the grant stores only the sha.

---

## Content identity

```sh
git diff <baseSha>...<headSha> | git patch-id --stable
```

**One cumulative patch-id over the range.** Not a per-commit multiset: squashing and reordering do not change
what the human approved, so commit structure is not part of the approval. This also retires “no commits added
or removed” — that was standing in for a content check, and this is the content check.

Two guards, because `git patch-id` is blind to both:

- **binary hunks** — any `-` row in `git diff --numstat` in the range;
- **mode changes** — anything in `git diff --summary`.

If either is present the equivalence path is **unavailable**: any head move re-asks. Without this, the fence
has a hole shaped like a PNG.

---

## Checks bind to a sha, not to a PR

GitHub's `pull_request` workflows run on the **merge commit** (`refs/pull/N/merge`), so “this PR is green” is a
claim about a different sha than the one being merged.

```
checkMode = "pr-merge"   (the default for repos with PR workflows)
  check_suite.head_sha                == testedMergeSha
  check_suite.pull_requests[].head.sha == headSha
  parents(testedMergeSha) as a SET    == { baseSha, headSha }

checkMode = "head"       (repos with push-triggered checks only; no merge sha exists)
  check_suite.head_sha                == headSha
  check_suite.pull_requests[].head.sha == headSha
```

The parent check is the part that turns a recorded number into a proof: one `GET
/repos/{o}/{r}/commits/{testedMergeSha}` shows the suite tested _that pair_, order-insensitively. Without it,
`testedMergeSha` is a sha with no relationship to the base we claim to have approved.

---

## The state machine

```
  approved { contentPatchId }
      │
      ├─ base or head moved, patch-id EQUAL, binary/mode clear
      │      └─ re-test (the lander drives it) ──▶ green + parents bind ──▶ MERGE
      │
      ├─ patch-id DIFFERS
      │      └─ re-ask, with range-diff attached as EVIDENCE
      │
      └─ checks cannot run on the new pair (no CI, flaky, suite only ran on the old pair)
             └─ refuse: checksUnavailable — a human decision, never a rebase permission
```

Three rulings this encodes:

1. **A head move re-tests even when it does not re-ask.** Re-testing is not re-approving; the human approved
   content and a base-descendant. A fence that re-asks whenever the world moves trains people to approve
   without reading.
2. **Content change is the only re-ask trigger.** A conflict resolution is new content and needs a new sha
   approval — the human approved the diff, not somebody's later resolution of it.
3. **The lander drives the re-test** (update the branch, re-run the suite). Waiting for the base to move
   naturally makes a batch's completion depend on an unrelated scheduler.

---

## The mutex

**One live grant per `(repo, pr)`**, enforced at grant _creation_ with a unique index over active grants.

Two batches over one PR means two humans approved without knowing about each other; whichever merges second is
a silent discard of the other's intent. A merge-time rule resolves that disagreement silently. A creation-time
refusal turns it into a conversation that costs one sentence — and names the existing `batchId` so it can start.

---

## What the desk item shows

One batched approval per land attempt, not 46 individual prompts — the whole point is to remove the attention
sink without removing the judgement.

```
kind: approval · choices: [merge these, merge subset, decline]
per entry:  repo · pr · headSha · baseSha · testedMergeSha
            diffstat (files, lines) · checks frozen at approval · baseMoved?
```

Also:

- **partial fulfilment** — one entry moving does not invalidate the batch; it is fulfilled per entry and the
  remainder re-proposes with the new sha, which is what makes a partial yes coherent;
- **expiry** on the batch;
- **the squash message is part of what was shown.** If the lander squashes, it may not rewrite the message
  beyond what the item displayed, or the record of the change differs from the approval even though the diff
  matches.

---

## What this does not authorize

- The foreman still may not merge — only the lander may, and only under a live grant.
- The lander may not merge anything not named in its grant, in any repo, at any sha.
- The lander may not edit a Linear SOW or project description; the foreman may _propose_ that as a desk item.
- An approval is a fact about bytes. Where authority is asked, the answer comes from the authority; where
  applicability is asked, a file-scoped exemption may loosen it (`docs/executor.md`, two axes).

---

## Open, not decided

- **Expiry length** for a grant: hours, or a working day? Nothing measured yet.
- Whether a **third** authority consumer changes the shape (the spec waits for two; it has two).
- Whether `merge_queue`-style tooling replaces the re-test step once a repo opts in. If it does, the grant
  shrinks to `contentPatchId` + `testedMergeSha` and the lander becomes a delegator.
