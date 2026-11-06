# Overnight run writeup — 2026-11-05/06

Volta input from the first unattended run of the Loop (ticket #16): launchd
LaunchAgent on the mini, target repo `autotelic/treadle-sandbox`, Telegram as
the only human surface. Covering the two runs (the overnight queue #11–#16 and
the adversarial pair #23/#24) and the following morning's live debugging.

## Headline numbers

- **8 issues reached ready PRs**: #11–#16 overnight, #24 (one pass), #23 (after a
  question). Total loop spend: **$3.89** (pi's own accounting, per Receipts).
- **5 of 6 overnight issues went in one pass each** (17–44 tests added per issue,
  all Checks green, Feature-done guard verified per issue).
- Zero wrong pushes, zero protected-path edits, zero budget overruns (post-fix).

## What the stalls and escalations actually were

### 1. The provider died at 03:51, and pre-fix code burned everything

The Anthropic account ran out of funds mid-issue (#23, pass 1). Every retry
failed `402`, and the pre-fix code counted each as an agent failure: **14
Receipts of pure provider failure**, the issue's budget gone, the nightly cap
(20) consumed, the Loop stopped. This was the #15 caveat ("provider failures
count as agent failures") coming true within hours of being written down.

**Fix:** `sessionWithPause` — Sessions get the same #9 treatment as Checks:
1/5/15 min backoff, then Pause with a cheap probe Session every 15 min,
Telegram on pause and resume, and infra outcomes never touch budgets. Proven
live the next morning when the same 402 burst happened mid-#24 and rode out
cleanly.

**Volta note:** infra classification is a classifier (`src/loop/provider.ts`)
over error text. It will drift. Watch its false negatives.

### 2. Your impossible spec (#23) got the designed answer

Issue #23 demanded 200 *and* 404 for the same request. The agent noticed the
contradiction *and* that existing tests pinned 200, and asked a structured
A/B/C question via `ask_human`. You answered "1" (keep 200, criterion 2 was a
mistake). It strengthened the tests (no behavior change, no weakened tests) and
shipped PR #26, tests-only. **The ask → park → resume → complete cycle works.**
This is the strongest evidence for the whole design.

### 3. Your scope-creep spec (#24) got built wholesale

The agent never judged scope: given a big-but-coherent spec, it implemented all
of it (search, saved searches, digest; 56 tests). **The Loop verifies Checks,
not judgement.** If "is this issue even a good idea" matters, that gate is
upstream (Wayfinder) or a review Session (seed rule 2), not the machine.

### 4. The stacked-PR problem (the run's biggest finding)

Six overnight branches were each created from the *same* unmerged main, so the
six PRs conflict with each other at merge time. Same shape as the #9/#10
closures earlier: loop/4 and loop/5 re-implemented the foundations of a main
that didn't have them yet, because their base never gained the earlier work.
**The Loop works the queue faster than the human merges.** Options to wayfind:
rebase/rework passes after merges, stacking branches on each other, or holding
dependent issues until merges land. This is a design problem, not a bug —
top Volta candidate.

## Bug list (all fixed on `main`, this is what the run cost the machine)

1. `readReceiptHistory` parsed `gh`'s response wrong (comments come wrapped).
2. pr-ready left the `working` label on (a restart would re-enter done work).
3. Blocked-on-human counted toward the 3-parks circuit breaker.
4. Resume routing: a re-entered issue was ignored by the machine's first
   queue poll.
5. Resume died on the leftover worktree (`already exists`); now reuses it.
6. The budget check at the pass-loop top was dropped in a rewrite.
7. Retry-with-hint had no budget reset — retried issues re-parked instantly.
   Now posts a hidden `treadle:budget-reset` marker; Receipt history truncates
   before it.
8. The answer watcher relabeled issues that weren't parked (labels are the
   truth; now it checks).
9. The watcher ate a live Session's answer (race, ~seconds); the `liveIds`
   registry now skips live questions. Bit in production with Ed's actual answer.
10. Re-picking a parked issue tried to create its existing branch; now
    continues it (parked work resumes from its Checkpoint, per #8).
11. pnpm refused to purge stale `node_modules` without a TTY; `CI=true` is now
    set for all spawned repo commands.

## Smaller gaps recorded (not yet fixed)

- The base-side unit test count for the work-present guard can be stale.
- Escalation answers for an issue the Loop has since re-picked are stale.
- An interrupted pass (killed Session) gets no Receipt of its own; its work is
  folded into the next pass's Checkpoint.
- `answeredFirst` is in-memory; a restart loses answer-first ordering (labels
  still drive the queue correctly).

## Cost footnote

$3.89 for 8 shipped features is roughly $0.49/issue, with the two adversarial
issues costing the most drama and the least money (#23: $0.07, #24: $0.77).
The expensive failure was free: the 14 provider-killed passes cost $0.07 total.
