# The feature-branch shift: the Loop merges its own PRs into an integration branch

The H2 permissions milk-run shipped 7 loop PRs in two days and then sat at the
wave cap (`maxOpenLoopPrs: 4`) waiting for a person to review them one at a
time. Per-PR review caught issues early, but the review pile was the
bottleneck: each review freed one pick slot, each merge triggered rebases, and
the loop's throughput was bounded by how often a human looked at GitHub. The
review pile also became rebase risk the longer it sat.

The shift: a long-lived **integration branch** (`integrationBranch` in
loop.config.ts) becomes the merge target for EVERYTHING in the SOW's world.
Loop PRs (`loop/<n>`) target it; a baseless issue branches from it (numeric
`base:` stacking unchanged); hand-authored work targets it too — no carve-out
for non-loop PRs (Ed's rule, 2026-11-14: "everything gets merged into the
feature branch — human review at the very end"). A maintenance step
**squash-merges every green PR into it** — GitHub CI green (`mergeable` +
`mergeStateStatus: CLEAN`), non-draft; tracker gates (the issue stateless, a
stacked child waits for its parent) apply only where a tracker linkage
exists. The existing cascade then runs for tracked issues in the same pass:
the issue goes `state: done`, dependents rebase onto the branch and retarget.
Humans review the branch into the default branch **once at the end**;
maintenance opens that review PR on the first auto-merge and never again
(closing or merging it is final).

The wave rule is gone: its job was bounding the review pile, and the pile is
now one branch that drains itself. The nightly caps still bound pace. The
lint/typecheck gates re-base onto the integration branch so they scope to the
PR's increment instead of the ever-growing whole stack; the review PR gets the
repo's full CI as the backstop.

## Considered options

- **`gh pr merge --auto --squash` at ready time.** Needs repo auto-merge
  settings and branch protection, and GitHub merges stacked children before
  their parents (it doesn't know the tracker's `base:` edges). The
  maintenance step knows them: a child PR keeps its parent as base until the
  parent merges, so ordering falls out of the retargeting.
- **Keep per-PR review, just raise the cap.** The pile still drains at human
  speed; the cap trades review debt for loop idle time either way.
- **Merge commits instead of squash.** Keeps the stacked commits for review,
  but the end-review diff then carries the whole tangle; squash keeps the
  integration branch linear and each merge one reviewable unit.

## Consequences

- With an integration branch, maintenance runs at every pick boundary,
  throttled to 60s — not only when the queue is idle: the Loop is the
  merger, its merges unblock the queue, and sessions otherwise bounce
  straight from one issue to the next without ever idling. A pass that
  finds nothing eligible costs one fetch + one PR list call.
- A stack lands one maintenance pass per level when children were green
  before their parent (their PRs get rebased + retargeted, then CI re-runs);
  green siblings merge in the same pass. Done-marking runs after the
  auto-merge step, so a child whose parent merged this pass goes on the
  next pass. Conflicts never touch a branch: they page a person once per
  conflict episode (a persisted conflict-state file dedupes the nags).
- Per-PR review moves to the end: errors surface later but in one place, and
  the review PR live-updates, so it can be reviewed incrementally anytime.
- The integration branch must not have branch protection requiring review —
  the Loop (eadmundo) must be able to self-merge. Repo-level "allow
  auto-merge" is unnecessary; maintenance merges directly when CLEAN.
- The merged/closed watermark filters use `>=`, not `>`: on a first-ever run
  the watermark initializes to the auto-merge moment, and a PR merged in that
  same step must still be processed that pass.
- `state: done` on the markdown tracker now means "merged into the
  integration branch". The review PR's merge to the default branch is the
  human's act and needs no tracker state.
