# Factory capability — adopt foreign commits

Status: specified, not implemented as a first-class verb yet.

## What the operator had to do

A child project needed two commits from PR #1693. The pass could edit, commit,
rebase and push, but there was no named task for adopting another PR's commits and no
receipt field that said where the code came from. The operator queued a prose task with the
cherry-pick instructions. That is a missing task shape, not a missing autonomy flag.

## Decision

Adopt commits as a **bounded task**, not as a standing permission.

```text
factory event --id <workstream> --kind adopt-commits --payload
{
  "source": "refs/pull/1693/head",
  "commits": ["<sha1>", "<sha2>"],
  "policy": "keep-parent | prefer-source",
  "expectedHead": "<sha>"
}
```

The pass instruction is:

1. fetch the source ref;
2. cherry-pick the named commits with `-x` (provenance trailer);
3. resolve conflicts under the named policy: keep the parent's version where the change is
   already present, add only the missing source change;
4. run the project gates;
5. push the child branch with `--force-with-lease=<branch>:<expectedHead>`;
6. report the source ref, source commits, resulting commits, conflict decisions, and gate exits.

No merge. No parent edit. No second worktree.

## Provenance

- `git cherry-pick -x` writes the source sha into every adopted commit.
- The receipt gains `adopted: [{source, commits, result, conflicts}]`.
- The PR body and the Linear ticket name the source PR and the child that owns the adopted
  half.
- If a parent later lands the same source, the child's adoption is the duplicate; the
  parent PR must not adopt it too.

## Trust boundary

The cheapest trustworthy shape is not an operator doing the cherry-pick. It is:

```text
before: source ref + expected source commits + child head
during: cherry-pick -x, policy recorded
after:  every source commit appears in git log -1's trailer
        the child branch is unchanged except its own commits
        force-with-lease names the recorded expectedHead
failure: no push; desk item with the conflict and the policy choice
```

A pass that cannot prove the source trailer or the expected head should fail before pushing, not
after. The kernel can verify the trailer and the branch head; the worker must obey the
force-with-lease value. A pre-push hook that calls the same verifier is the second guard.

## What this teaches the goal layer

The goal should be able to say “adopt these commits, then continue project X” without a human
composing the prose. That is one more task kind in the goal/task map, not a new operator role.
