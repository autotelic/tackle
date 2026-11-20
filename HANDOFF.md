# Treadle handoff — 2026-11-19 ~07:00Z (overnight session); updated 2026-11-19 ~18:20 MST

Reader: a fresh pi session (or Ed). This is the live state; history lives in
commits, receipts, and `docs/2026-11-19-audit-triage.md`.

## 1. State in one paragraph

Two lines of work finished overnight, and the morning session landed the next
one. **Treadle (project-loop)**: run_checks + bash deny-pattern, provider
status-table classification, `checks.json` persistence, prompt branch-facts +
protected-path pre-answers, and the full budget recalibration ($ + wall-clock
per session, progress-extended issues, time-based nudges) — all committed,
pushed, and **running live** in the forestbuilder loop (empty queue, idle by
design). **Jig**: Phase 1 prep docs committed and Phase 2 **landed**
(`971ede88`, pushed): hermetic test stack — `.env.test.example` fixture env +
`loadTestEnv.js` mocha loader, standalone `docker-compose.test.yml` (project
`jig-test`, owned ports 5435/6382/8109/1082), doppler removed from
`validate_api.yaml`, `pnpm -F api test` green **with no doppler** (2391
passing / TCL 6). Rebuild shape called by Ed: **strangler-fig inside
`apps/admin-ui`**. The second operator's two note files were read and deleted
(their content is captured below and in section 4). Next: playwright-bdd
skeleton + `tier4-admin` catalog entry + Tier-A scenario authoring, then jig
`loop.config.ts` shake-out.

## 2. Machines and paths

- **This Mac mini** runs everything: loops (launchd), pi sessions, gh.
  **Estone's laptop** (`ssh estone@100.81.165.48`, key auth) holds the canonical
  Obsidian vault (`/Users/estone/vaults/main`). The mini has a readable mirror
  at `/Users/home/vaults/main` — reads fine; **write vault files via laptop
  ssh**; never touch `/Users/home/Documents/main-STALE-frozen-2026-07-21`.
- `/Users/home/Projects/project-loop` — treadle code; github `autotelic/project-loop`, main synced (`1e9df11`+).
- `/Users/home/Projects/shakti/forestbuilder-loop` — loop target (clone).
  Its tracker: `/Users/home/Projects/shakti/h2-permissions` (markdown; pushed to
  `~/backups/h2-permissions.git` at `71fd0ae`). `loop.config.ts` in the tracker
  clone carries the budgets.
- `/Users/home/Projects/jig` — github `autotelic/jig`; main clean and pushed
  through `971ede88` (Phase 1 prep docs + Phase 2 hermetic test stack). Pushes
  touching `.github/workflows/*` must go over SSH (`git push
  git@github.com:autotelic/jig.git main`) — the stored gh token lacks
  `workflow` scope. Deploys trigger on `develop` pushes / manual dispatch
  only, so main pushes are inert.
- `/Users/home/Projects/treadle-sandbox` — sandbox target; instance not running
  since Nov 15.
- plists: `~/Library/LaunchAgents/com.treadle-forestbuilder{,-maintenance}.plist`;
  logs in `~/Library/Logs/treadle/`.
- Second operator's leftovers: `project-loop/{REPLY-NOTE,WIND-DOWN-NOTE}-2026-11-19.md`
  (untracked), `/tmp/verify-runchecks/`.

## 3. Files of record (read these, don't re-derive)

- `project-loop/docs/2026-11-19-audit-triage.md` — the calibration numbers + the
  triage table (mistake → ladder rung → status). Update it when a rung lands.
- `project-loop/GLOSSARY.md` — event vocabulary incl. `session.checks_requested/result`.
- gh issues on `autotelic/project-loop`: **#17** run_checks (landed), **#18**
  calibration (landed), **#19** late-ask (open candidate, scoped to an audit line).
- `jig/docs/treadle-prep/2026-11-19-admin-surface-inventory.md` — the ratchet
  list (32 resources, worker seam, coverage baseline).
- `jig/docs/treadle-prep/2026-11-19-hermetic-test-stack.md` — the doppler seam
  audit + the exact fix order.
- `jig/docs/treadle-prep/2026-11-19-vision-and-scenario-skeleton.md` — VISION.md
  draft + two-tier gherkin skeleton + authoring order.
- `jig/docs/harness/catalog.md` + `scripts/harness/tier{0-3}.sh` — the EXISTING
  checks catalog (tier0 wired, tier1/2 stubs, 15 gardener todos); design:
  `jig/docs/superpowers/specs/2026-08-10-milk-run-deterministic-harness-design.md`.
- Vault: `Jig/PLAYWRIGHT_GHERKIN_PLAN.md` (playwright-bdd, Shop→Auth→Admin),
  `deterministic-harness/Testing for correctness from the outside.md` (the
  outside-in harness playbook, with a jig-specific "where to start"),
  `ideas/Rooms whiteboard.md` (Ed+Ted lanes, treadle debouncing).
- `/Users/home/Projects/tackle/packages/joggle` — the mature TypeSafe (Jev)
  integration: Effect `@effect/ai-typesafe` DecisionModel, **wire-level decision
  cache** (CI replays keyless), offline mode, token accounting, exists-vs-best
  ask pattern. Imitate for treadle triage.

## 4. Decision ledger (a fresh session would get these wrong)

- **run_checks**: the agent declares, the deterministic runner runs, the
  FailureSet returns as the tool result; capped at 2 runs/session; driver
  events feed the rules engine. *Why: ~30% of bash calls were hand-rolled test
  runs; one session used the shared `TEST_DB_PORT=5433`.*
- **The bash deny-pattern arms only when a runner is present** (refusing tests
  with no way out would strand the agent); the regex is segment-scoped —
  `pnpm install` survives, `pnpm install && pnpm test` is caught.
- **Provider classification** = leading `"NNN:"` status table (401/402/403/408/
  429 and 5xx = provider; 400/404/422 = honest budget burn) + exact pi APIError
  classes (`Connection error.`, `Request timed out.`) + narrow tokens. *Why:
  `Connection error.` ×200 was burning issue budget instead of Pausing.*
- **runChecks persists `checks.json`** beside its logs. *Why: every prompt
  named a file that never existed.*
- **Every prompt carries deterministic git branch-facts** (baseRef + integration
  drift) **and a protected-path standing-policy pre-answer** when the issue text
  names a protected path. *Why: two blocked-on-human classes (#14/#15 lineage,
  #13/2 contradiction) killed at the source.*
- **Budgets (Ed's go, `eef833c` + tracker `71fd0ae`)**: per-session $0.5 +
  60-min wall-clock; `maxTurnsPerSession` demoted to a **backstop** (reason
  string `turn backstop`); a failed pass whose frontier strictly shrank is
  **progress-exempt** (receipt field `progressExempt`; restart recovery counts
  the same); absolute ceiling `maxPassesPerIssue` (default 2× passesPerIssue);
  **nudges are time-based** (half / four-fifths of the session budget). *Why:
  37% of sessions died on the 100-turn cap ($12.43, zero completions); 75% of
  turn-nudges failed to prevent it.*
- **`audit-summary.ts --log-dir`** for markdown-tracker receipt files (the old
  `--receipts` is GitHub-only and was a silent no-op on the forestbuilder loop).
- **Jig**: Cypress dropped (verified absent on disk — the vault plan's
  "current state" table is stale); playwright-bdd, blank slate; **doppler is
  out of the test path** — landed: `.env.test.example` + `loadTestEnv.js`
  (mocha loads `.env.test` → `.env.test.example` → process-env wins),
  standalone `docker-compose.test.yml` (project `jig-test`, owned ports db
  5435 / redis 6382 / typesense 8109 / maildev 1082+1027, chosen to dodge the
  machine's occupied 5433/6380 + 5434/6381), CI `validate_api.yaml`
  doppler-free with services on the same ports, and the old
  `docker-compose.testdb.yml` + `docker:{support,all}:test` doppler scripts
  left as legacy aliases. `runTypesenseService.js` honors `sslmode=disable`
  (repo convention; fixture URL carries it) — it hard-coded SSL that no local
  postgres accepts. Fixture env discovered empirically beyond the audit table:
  `IETF_SIG_SECRET`/`IETF_SIG_KEY` (plugins/signRequest — their absence caused
  the keyId 500s). Gherkin describes **outcomes** in two tiers (Tier A API/DB
  seam = majority, survives the rewrite untouched; Tier B thin browser tier
  bound via data-testid contract); **harness work builds on the existing
  catalog + tier scripts** (add `tier4-admin`, fill tier1/tier2), not a new
  structure.
- **Jev/System One** (typesafe.ai): already the judgement engine in joggle; for
  treadle, treat it as how a *script* makes calibrated calls (wire-cache makes
  it replay-safe), not as a ladder rung.
- **The 23:04 collision**: Estone's second agent ran `git checkout -- .` on this
  repo and destroyed uncommitted work (restored ~23:07 by it; everything now
  committed so it can't recur). It self-scoped to verify/report-only. Its
  coordination notes (REPLY-NOTE / WIND-DOWN-NOTE) were read by the morning
  session and deleted per their own instruction; substance: run_checks
  verified live (5/5 real sessions blocked), issues #17/#18/#19 filed, its
  only open flag (running loop predated `eef833c`) was resolved by the
  ~23:54 kick.

**Resolved 2026-11-19 morning**: rebuild shape → **strangler-fig inside
`apps/admin-ui`** (Ed's call); second operator's note files → read + deleted.
**Open/pending** (the question that closes each): Ted chat specifics beyond
treadle+monitor+feedback → Ed exports into the vault. Feedback lane
(pi-intercom) + pi-goal-x install → interactive, needs Ed at a terminal.
Second agent's standing arrangement → Ed. Nightly cap tightening ($40→~$25) →
after a green week of Receipts (data, not opinion). #19 late-ask → audit line
at the next triage cadence.

## 5. Live systems

- **`com.treadle-forestbuilder`** (PID 6560 at handoff time, up since ~23:54 MST
  Nov 18): `node src/run-loop.ts --repo …/forestbuilder-loop` with cwd
  project-loop — **code changes here need a manual `launchctl kickstart -k
  gui/$(id -u)/com.treadle-forestbuilder`** (calendar start won't restart a
  running job). KeepAlive SuccessfulExit=false → crash-restarts every 60s.
  **Idles by design**: empty queue → 60s polls + hourly idle maintenance; a
  silent out-log is healthy. Caps: nightly $40 or 48 passes (persisted, rolls
  over local midnight); after a cap-stop it's dead until the 06:05 calendar
  start or a manual kickstart. `forestbuilder-loop.err.log` mtime Nov 14 — the
  ERR_INVALID_TYPESCRIPT_SYNTAX noise there is stale, not a live problem.
- **`com.treadle-forestbuilder-maintenance`**: hourly; last cycle auto-merged
  nothing (empty queue), logged in `forestbuilder-maintenance.out.log`.
- **`com.treadle`** (sandbox instance): not running since Nov 15; loads current
  code if ever started.
- **A second operator may be live** (Estone's verify agent): check `git status`
  and recent commits before editing either repo; never run destructive git ops
  in a shared tree.

## 6. Quirks and traps

- Use `/opt/homebrew/bin/node` (v26.12.1); node/gh are off the non-interactive
  ssh PATH. `tsc` strict + `biome check --write` must pass before committing.
- pi session logs: `~/.pi/agent/sessions/<cwd-slug>/*.jsonl`; session-spend
  one-liner: sum `"cost":{...,"total":N}` matches over the newest jsonl.
- `audit-summary.ts` runs from project-loop root; pass
  `--log-dir /Users/home/Projects/shakti/h2-permissions/log` for the
  forestbuilder loop.
- The loop's worktrees live under `<repo>/.treadle/worktrees/<issue>`. Two
  checkouts of the SAME repo cannot run the REST test stack concurrently
  (single-owner gap); different repos with owned ports are fine.
- glm-5.3-flash is free-catalog pricing: nightly dollars measure retries, not
  rates — judge work by progress, not dollars, on this model.
- This overnight session cost **$2.31** (443 calls, 96% cache re-reads; long
  sessions get expensive per turn — end-and-rehandoff keeps the curve flat).
- The vault mirror on the mini is read-only in practice; never write it directly.

## 7. Next actions, ordered

1. **Ed (morning)**: read + delete the two note files in project-loop root;
   call the rebuild shape (strangler default vs new repo); export the Ted chat
   into the vault if it carries more.
2. **Fresh session, jig Phase 2 (unattended)**: implement the hermetic test
   stack exactly as `jig/docs/treadle-prep/2026-11-19-hermetic-test-stack.md`
   orders it — checked-in test env, test compose without token minting, stub
   outbound world — and prove `pnpm -F api test` green with no doppler.
3. Then: playwright-bdd skeleton (shop-first to prove the pipeline), a
   `tier4-admin` catalog entry, and Tier-A scenario authoring from `jig/docs/*.md`
   domain docs; commit the prep docs alongside.
4. Then (Phase 3): jig `loop.config.ts` with checks = the tier scripts, manual
   `run-loop.ts --repo jig` shake-out until the fresh-branch baseline is green,
   then the plist pair.
5. With Ed at a terminal (Phase 4): stand up the monitoring session and the
   passive feedback session per the Ted-chat shape.
6. Optional: #19 audit line; borrow joggle's wire-cache/replay pattern for
   triage decisions when the triage cadence starts.
