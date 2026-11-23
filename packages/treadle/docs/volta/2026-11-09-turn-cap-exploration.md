# 2026-11-09: a good octave, killed one step into the deliverable

First pass of the first forestbuilder issue (`#1: project_contractor table`, markdown tracker, H2 SOW permissions stack). The session hit the 100-turn cap after 12.3 minutes having written exactly one file. This is the cleanest "global timeout kills a run that was landing" incident we have.

## Numbers

|                                |                                                                                                          |
| :----------------------------- | :------------------------------------------------------------------------------------------------------- |
| Duration                       | 12.3 min, 101 turns                                                                                      |
| Tool calls                     | 71 bash, 28 read, **1 write**                                                                            |
| Thinking vs text               | 102,764 thinking chars vs 2,307 text chars                                                               |
| Tokens / cost                  | 5,063,005 tokens / $2.50 (kimi-k3)                                                                       |
| The one write                  | `services/db/src/migrations/20261109000001_create_project_contractor.js` — the deliverable, at turn ~90+ |
| Bash cadence per session-third | 20 / 24 / 27 — steady, no thrash                                                                         |

## Evidence of convergence (not wandering)

Most-touched paths in the agent's bash commands, late-session:

- `project-stock-tracking/queries.ts`, `projects/queries.ts`, `superTableQuery.ts`, `project-delivery/queries.ts`, `tree-season.ts` — the ~10 hand-written "is this the contractor?" sites the issue names;
- `services/rest/test/projectContractor.test.js` — the existing test to preserve;
- seeds (`14-project-site`, `22-stock-tracking`, `32-project-site-associations`), `docker-compose.test-db.yaml` — fixture and harness reconnaissance.

Final thinking, cut off mid-synthesis at the cap: _"So `project.contractor_id` references `client.id`. The 'Company' in the glossary maps to the `client` table in the code (clients,"_ — it had just solved the glossary→schema mapping the issue's acceptance criteria turn on.

## Verdict

Volta's phase table, applied honestly:

- **Octave** ✓ — reading and searching, few edits, frontier flat. Steady cadence, narrowing file set, no repeated errors (it never got to run code).
- **Portal** ✗ — no confident plan plus fast edits failing to move the frontier.
- **Stall** ✗ — no churn, no repeated failure hashes, nothing rewritten twice.

A good octave, at steady pace, killed at a global cap one step into the deliverable. The cap did its _budget_ job; it did not do a _supervision_ job, because nothing was watching for the turn.

## What Volta would have done differently

1. **Calibrated budget, not a global cap.** A schema-discovery migration on a 63MB monorepo turns at ~120–150 turns; "add a coverage test" turns by ~15. One 100-turn cap prices them identically. Calibration needs per-repo/per-task-kind turn-at-volta data — this incident is the first forestbuilder data point.
2. **Nudge before the budget is spent.** The agent never knew the cap existed. At ~turn 70: _"70% of your turn budget is gone — get the migration written and checkpointed before exploring further."_ The prompt carries the Pass budget (`pass 1 of 4`) but nothing about turns; there is no in-session pressure gradient at all.
3. **Seconda volta.** The exploration was good: checkpoint the migration plus a distilled summary (the glossary→schema mapping, the check sites found, the plan), and retry _the ending_ — replace the check sites — instead of re-paying for discovery. What actually happened: pass 2 re-explored from near-zero.

## The compounding failures (why the retry was blind)

The turn cap alone would have cost ~$2.50 of rediscovery. What made it worse:

- The session aborted mid-thought (`lastAssistantText: null`), so pass 2's continuity note was empty.
- The checkpoint commit then failed on the repo's husky pre-commit hook (fixed: `--no-verify`), killing the pass loop **before the Checks ran** — so no Receipt and no failure-set either. Pass 2 got the "first pass ever" prompt with a leftover migration file on disk as its only inheritance.
- The durable nightly budget (added the same day) correctly recorded the $2.50 — the money survived the crash even though the knowledge didn't.

## Design candidates this feeds

1. **Turn-fraction nudge** (cheap, high value): session config gains a soft warning at 50% and 80% of maxTurns; wording matters — it should push for a _landable increment_, not "hurry".
2. **Seconda volta checkpoint + distill**: on a capped/failed Session, a tiny follow-up session reads `PROGRESS.md` + `git diff` + the session-log tail and writes the handoff note the retry actually gets. Distils 5M tokens into ~30 lines. This is the "fork" action, minus the multi-ending tournament (which can come later).
3. **Calibration data collection**: every pass already records turns, tokens, terminal in the Receipt; add the session's file-touch count and write-fraction (below), and the turn-at-volta percentile per repo emerges from the tracker logs over time.
4. **Octave-depth metric**: writes as a fraction of tool calls (pass 1: 1%). A cheap deterministic in-pass signal distinguishing "deep octave" from "converging" — alongside file-set growth/shrinkage and reads:writes ratio, all extractable from the session stream.
5. **In-pass frontier sampling** (harder, later): the agent's own check runs, read from the session stream, as the in-pass frontier. The loop only measures the frontier between passes today; Volta-in-Treadle needs it inside.

## Pointers

- Session log: `forestbuilder-loop/.treadle/sessions/issue-1-pass-1-2026-11-09T23-03-08-927Z.jsonl` (67MB — keep until distilled)
- Retry log: `.../issue-1-pass-1-2026-11-10T03-19-00-933Z.jsonl`
- Budget entry: `.treadle-nightly.json` in the tracker repo (1 pass, $2.50)
- The fixes already shipped in response: `--no-verify` checkpoint commits, `.treadle` exclusion from checkpoints, `.gitignore` PR (forestbuilder#1833)
