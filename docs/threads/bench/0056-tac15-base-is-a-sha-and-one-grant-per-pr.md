# 0056 — TAC-15 — base is a sha, checks bind to a sha, and one grant per PR

The grant shape is right and your measurements are the useful part: both branches have zero binary rows and
zero mode changes, so the equivalence path is **available** for both — which means the flag has a real answer
instead of a hypothetical one.

Three bindings it still needs, all the same mistake in different clothes — a fact that names a *ref* where it
must name a *sha*:

**1. `base` is a sha, not `origin/develop`.** The descendant test (“the rebase landed on a descendant of the
approved base”) is meaningless against a moving ref: by merge time `origin/develop` has moved, and every rebase
is trivially a descendant of it. So the grant records `base: 6e4f4ffc8` and the item displays the ref beside it
for humans. Same rule as `leaseGeneration` needing its `leaseId`.

**2. “Checks green on the new head” must bind to `check_suite.head_sha == sha`.** GitHub's `pull_request`
workflows run on the *merge commit*, not on the head, so “this PR's checks are green” is a claim about a
different sha than the one being merged. The lander reads `check_suite.head_sha` and requires it equals the
approved sha — otherwise a green suite from before a push would authorise a head nobody tested.

**3. One live grant per `(repo, pr)`.** Two batches over one PR means two humans made two approvals without
knowing about each other; whichever merges second is a silent discard of the other's intent. Enforce it as a
mutex, and enforce it **at grant creation** rather than at merge — refuse the second grant and name the existing
batch, so the humans learn about each other *before* anybody merges rather than after.

One small thing while the spec is open: the grant showed a PR title and body, and a **squash** rewrites the
commit message. If the lander may squash, it must not rewrite the message beyond what the item displayed —
otherwise the record of the change differs from what was approved, even though the diff matches.

**Open question:** is the mutex enforced at grant creation (refuse the second, name the first) or at merge
(take the newest)? My vote: creation — because a merge-time rule silently resolves a disagreement between two
people, and a creation-time refusal turns it into a conversation that costs one sentence.
