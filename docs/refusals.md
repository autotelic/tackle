# Refusals: the assertion set

The catalog of what the factory refuses lives in `docs/workstream.md` §3, `docs/lander.md` and
`docs/reconcile.md`. **This file is the test matrix derived from them**: given a precondition, the exact code,
exit status and the substring the message must contain. A refusal that cannot be asserted is a refusal nobody
has seen fire.

---

## 1. Adoption (`factory adopt`)

Fixtures are a temporary store plus a throwaway git repo; `setup` names the precondition.

| #   | setup                                               | code           | exit | message must contain                                           |
| --- | --------------------------------------------------- | -------------- | ---- | -------------------------------------------------------------- |
| A1  | path is a plain directory                           | `NotAWorktree` | 1    | `not a git worktree: `                                         |
| A2  | store has `perms-1862` live on the same `worktree`  | `PathOwned`    | 1    | `path already owned by perms-1862`                             |
| A3  | store has `perms-1862` live on `pr: 1862`           | `PrOwned`      | 1    | `pr 1862 already owned by perms-1862`                          |
| A4  | store has `perms-1862` live on `project: P-AUT-128` | `ProjectBusy`  | 1    | `project P-AUT-128 already has a live workstream perms-1862`   |
| A5  | branch head ≠ PR `headRefOid`                       | `HeadMismatch` | 1    | `branch head 55aa5293a does not match PR 1862 head 6e4f4ffc8`  |
| A6  | dirty tree **and** `--no-checkpoint`                | `DirtyTree`    | 1    | `uncommitted changes (7 files) and --no-checkpoint was passed` |
| A7  | HEAD detached                                       | `DetachedHead` | 1    | `HEAD is detached at 55aa5293a`                                |

Three notes for the wiring:

- **A2 and A3 are different refusals for one bug.** Same path and same PR both mean two owners, but the message
  must name _which_ owner was found; a single “already owned” sends the operator looking in two places.
- **A6 is not the default.** A dirty tree is normally checkpointed and recorded, not refused — refusing it teaches
  people to stash before adopting, which loses the evidence of what they were doing. The refusal exists only for
  the explicit `--no-checkpoint`.
- **Every code is a value, not a sentence.** Tests assert on the code and the substring; the CLI prints the code
  in `--json` so a script never parses prose.

## 2. Adoption success (what must be captured)

| given                                          | recorded                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------ |
| clean tree                                     | `head`, `pr`, `branch`, `baseSha`, `label`, `dirtyFiles: []`       |
| dirty tree (default)                           | the same, plus `dirtyFiles: [{path, status}]` and a checkpoint ref |
| Linear and branch disagree                     | `phase: reconcile`                                                 |
| PR has requested reviews, no changes-requested | `phase: land`                                                      |
| PR has changes-requested, or no PR             | `phase: build`                                                     |

Phase inference is the only place adoption is allowed to guess, so it gets a table test: five inputs, five phases,
no “default”.

## 3. `board apply --from <report>`

The report's own refusals (`docs/reconcile.md` §4), asserted the same way.

| #   | setup                                                  | code          | exit | message must contain                                                          |
| --- | ------------------------------------------------------ | ------------- | ---- | ----------------------------------------------------------------------------- |
| R1  | report `observed.linear` older than the current cursor | `StaleReport` | 1    | `report is stale: observed 2026-11-21T22:39:41Z, cursor 2026-11-21T23:02:10Z` |
| R2  | a `done` proposal with `evidence: {}`                  | `NoEvidence`  | 1    | `no evidence for P-AUT-243`                                                   |
| R3  | two issues cite one commit with different proposals    | `Ambiguous`   | 1    | `commit 55aa5293a claimed by P-AUT-241 and P-AUT-244`                         |
| R4  | proposal touches the project description or SOW        | `SowEdit`     | 1    | `SOW edits are authored, not applied`                                         |
| R5  | `--only` names an `unknown` issue                      | `Unknown`     | 1    | `P-AUT-245 is unknown; nothing to apply`                                      |

Success assertions worth writing next to them:

- `--dry-run` prints one line per issue and **makes no calls** (assert on an empty request log);
- re-applying the same report writes no second receipt (idempotence by `(reportId, issue)`);
- applying three of twenty-six leaves twenty-three proposed as `remaining` on the next run, each quoting the
  earlier proposal.

## 4. The lander (summary; full contract in `docs/lander.md`)

| #   | setup                                                   | outcome                                                |
| --- | ------------------------------------------------------- | ------------------------------------------------------ |
| L1  | two live grants for one `(repo, pr)`                    | second refused at creation, naming the first `batchId` |
| L2  | patch-id differs from the grant                         | re-ask, range-diff attached                            |
| L3  | patch-id equal but a binary or mode change in the range | re-ask (equivalence unavailable)                       |
| L4  | patch-id equal, `check_suite.head_sha ≠ testedMergeSha` | refuse to merge; re-test                               |
| L5  | `parents(testedMergeSha) ≠ {baseSha, headSha}`          | refuse to merge (the pair was not the tested pair)     |
| L6  | base moved, content identical                           | re-test, then merge without a new approval             |
| L7  | checks cannot run on the new pair                       | `checksUnavailable`, a human decides                   |

L4–L5 are the two that a plausible implementation gets wrong: “the PR is green” and “the pair we approved was
tested” are different claims, and only the second may authorise a merge.

---

## 5. House rules for every refusal

1. **The code is a value.** `--json` carries it; prose is for humans only.
2. **The message names the thing that collided** — an id, a sha, a path, a count. “Already owned” is not a name.
3. **Exit 1 for a refusal the operator must resolve; 2 for usage; 3 for infrastructure.** Never 1 for a broken
   tool.
4. **A refusal is not a warning.** If the condition is recoverable without a decision, it is a documented
   behaviour with a note, not a refusal — and it gets a success-row test instead.
5. **Every row here has a test that fails when the guard is removed.** That is the whole file: these are the
   guards, spelled out so they can be deleted one at a time and watched.
