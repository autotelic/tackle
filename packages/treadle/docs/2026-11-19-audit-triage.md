# Treadle audit + triage — 2026-11-19 overnight session

All numbers from `scripts/audit-summary.ts --log-dir` over the 74 forestbuilder
session logs (enriched from the markdown tracker's receipt files), plus direct
extraction from the session JSONL. Deterministic, zero LLM turns.

## 1. What the audit measured

- 74 sessions, 4,879 turns. Raw log cost $21.25; receipt-recorded $16.42 (57 receipts).
- **Model mix is the real budget story**: kimi-k3 (retired) = 8 sessions, $13.10
  (62% of all spend, avg $1.64/session); glm-5.3-flash = 66 sessions, $8.15
  (~$0.12/session). The top-cost outliers in the raw table (#1: $2.50/$3.93,
  #3: $3.43) are all kimi-era.
- **Terminal distribution**: 28 failed ($12.58), 23 completed ($2.32), 6
  blocked-on-human ($1.52), 17 sessions with no receipt (crashes/402-storm era).
  **Failed sessions outspend completed ones 5.4:1.**
- **Turn cap: 27/74 sessions (37%) died mid-work** ("turn cap 100 reached"),
  costing $12.43 — 76% of receipt-recorded spend — with zero completions. Each
  cap-death discards the session's re-orientation and the next pass pays it again.
- **Nudges don't hold**: 40 sessions received the half/four-fifths budget nudges;
  30 of them (75%) still hit the cap. The prompt-text rung fails at exactly the
  rate predicted (it is the rung the agent can forget).
- **bash = 87% of 5,326 tool calls.** Agents hand-roll test-runner invocations:
  `TEST_DB_PORT`/`TEST_REDIS_PORT`/`NODE_ENV` ceremonies with inconsistent ports
  (one session used `TEST_DB_PORT=5433` — the shared port the coexistence gap
  warns about — another `eval "$(fnm env)"`, another `OPENAPI_COVERAGE_SILENT=1`).
- **ask_human: 8 sessions, 6 blocked-on-human.** Question classes: branch
  lineage ×2 (#14, #15), protected-paths contradiction ×1 (#13), stale issue
  premise ×2 (#6 rider-1, #2 Oso-registration note), design judgement with
  recommended answers ×2 (#4, #5), scope pacing ×1 (#6).

## 2. Budget recalibration (**LANDED** — Ed's go came the same night)

Implemented in `eef833c` + tracker `71fd0ae`; see treadle #18 for the
landed description. The runaway-train signature is **spend without verified
progress**, and the data confirms it: 76% of spend died on the cap; successful
sessions average ~$0.10.

| Today                         | Proposal                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| maxTurnsPerSession = 100      | wall-clock ~45 min + $ cap per session (~$0.50 glm-era; Checkpoints make long sessions safe)                                    |
| passesPerIssue = N fixed      | progress-extended: a pass with a green Checkpoint + green Checks extends the issue budget (+1); a pass that doesn't consumes it |
| nightly 12 passes / $40       | keep $40 protective; observed honest-day glm-era cost is ~$8–16, so tighten toward ~$25 once a full green week is measured      |
| 3-parks circuit breaker       | circuit-break on failure signature: same failing check, no frontier delta, rising cost-per-progress                             |
| blocked-on-human burns budget | already fixed for provider (402); stalled ≠ failed everywhere                                                                   |

Originally flagged for Estone's eyes first; the go arrived later the same
night, so the session-cap and progress-extension changes landed as described
above. The nightly $40 protective bound stays; tighten toward ~$25 after a
green week of Receipts.

## 3. Triage table — mistake → lowest deterministic rung

| #   | Mistake class                                                 | Evidence                                                                                    | Rung                                                                                                                                                        | Status                                      |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 1   | Agent executes test suites in bash with hand-rolled env/ports | 58/196 sandbox bash calls (~30%); forestbuilder ceremonies incl. shared-port 5433 collision | tool + deny-pattern (`run_checks`)                                                                                                                          | **DONE** `670d3a3`+`52d21bd`, live-verified |
| 2   | Agent pointed at a report file that never existed             | every checks-* dir in history contains only logs/; prompt names `<dir>/checks.json`         | harness (write the file)                                                                                                                                    | **DONE** `c2bf4bc`                          |
| 3   | blocked-on-human on branch lineage                            | #14 pass 3, #15 pass 1 questions                                                            | machine rule (deterministic prompt facts from git)                                                                                                          | **DONE** `f09ad2b`                          |
| 4   | Provider failures burned issue budget instead of Pausing      | "Connection error." ×200 and "Request timed out." ×5 unmatched by prose regexes             | machine rule (status table + exact APIError classes)                                                                                                        | **DONE** `8e9d397`                          |
| 5   | blocked-on-human when issue scope names protected paths       | #13 pass 2 question                                                                         | machine rule: when the issue body mentions a protected path, the prompt pre-answers with the standing policy (protected wins; the wiring is the loop's job) | **PROPOSED** (next, small)                  |
| 6   | Turn-cap churn                                                | 37% of sessions, $12.43, zero completions                                                   | budget recalibration (progress-extended budgets)                                                                                                            | **PROPOSED** (§2, needs go)                 |
| 7   | Nudge text ineffective                                        | 75% of nudged sessions still capped                                                         | superseded by #6 (structural, not textual)                                                                                                                  | —                                           |
| 8   | Opaque check failures ("exit code 1")                         | rest-gate failureSet details in receipts                                                    | addressed by #2 (logs + checks.json real) + FailureSetEntry detail now carries the last error-leaning output lines                                          | **DONE** `a70fe11`                          |
| 9   | Genuine judgement questions with recommended answers          | #4, #5, #6 questions                                                                        | keep ask_human (correct behavior); audit well-formedness at next triage cadence                                                                             | none — working as intended                  |

## 4. What landed tonight (commits)

- `670d3a3` run_checks + bash deny-pattern + prompt steering + audit `--log-dir`
  (markdown-tracker receipts — the old `--receipts` was a silent no-op on this
  loop) + test-run capture
- `52d21bd` defaultCreateSession forwards resourceLoader (live-verify bug)
- `8e9d397` provider classification by status table + APIError classes
- `c2bf4bc` runChecks persists checks.json
- `f09ad2b` deterministic branch-facts section in every prompt
- `0e67e11` protected-path standing-policy pre-answer
- `eef833c` budget recalibration (§2, Ed's go) + tracker `71fd0ae` config
- `a70fe11` failure-set details carry what broke

Verification: 143 unit tests green; live SDK session (glm-5.3-flash, 3 turns,
$0.0007) confirmed: bash `pnpm test` blocked with the run_checks way-out, the
runner returned the structured failure set, user extensions still load through
the custom loader (probe fired).

## 5. The 23:04 collision

At 23:04:54 MST the working tree reverted to HEAD while this session was
working (uncommitted ~90 min of edits); the tree self-restored by ~23:07 and
everything was re-applied and committed. Evidence of a second operator:
`/tmp/verify-runchecks/run.ts` (imports this repo's session.ts API, ran 23:03)
and `scratch-debug-loader.ts` in the repo root. No pi session other than this
one exists in the session dir. Note left at
`UNTRACKED-NOTE-2026-11-19.md` (untracked; delete after reading).

## 6. For Estone in the morning

1. §2 budget recalibration — go/no-go with the numbers above.
2. §5 — do you know what was operating in treadle at 23:03–23:07?
   If it was your second agent, it should be told to build on main.
3. Handoff items unchanged: feedback lane (pi-intercom, interactive) and the
   pi-goal-x-on-the-mini decision. Default stands: goal lives outside spawned
   sessions.
4. The `com.treadle` (sandbox) loop instance still runs the pre-tonight code;
   it picks up the new code at its next restart. The forestbuilder loop gets
   the kickstart tonight (see below) — after an empty-queue idle, so the
   restart risk is near zero.
