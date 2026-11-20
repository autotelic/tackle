# Treadle

A tool that runs a long-lived loop of AI agent sessions against a single
repository, reacting to what happens according to user-defined rules.

Formerly `project-loop` (renamed 2026-11-20; GitHub redirects old URLs and
issue links).

## The idea

An agent session is fallible; the loop around it is not. Treadle feeds the
agent one issue at a time, then verifies the result **deterministically** —
the agent never grades itself. What survives every session is the record:
checkpoints (commits), receipts (what was done and what it cost), and the
issue tracker's distilled state.

One **loop** = the engine bound to one repository. One loop drives one
session at a time. Several loops can run side by side on different repos.

## Language

See [GLOSSARY.md](GLOSSARY.md) — Loop, Session, Pass, Checkpoint, Receipt,
Rule, Action, Checks, and the terminal states. That vocabulary is load-bearing
across the code, the tracker, and the receipts; use it.

## How an instance is wired

Each loop instance needs three things:

1. **A target repo** — the code the agent works on (e.g. a dedicated clone,
   never the human working checkout). The engine checkpoints every session's
   result onto the issue's branch and pushes; a maintenance loop squash-merges
   green PRs into the integration branch.
2. **A tracker** — a markdown issue tracker (a git repo of issue files), the
   queue the loop works from. Format and conventions:
   `docs/markdown-issues.md` (generic format docs also live in a tracker's
   `docs/` — e.g. `h2-permissions/docs/markdown-issues.md`). The tracker also
   carries the instance's `loop.config.ts` (budgets, checks, rules) — target
   repos symlink to it.
3. **A runner process** — on the deployment machine this is launchd: one
   KeepAlive plist per loop + one per maintenance loop. The loop idles by
   design on an empty queue (60s polls); the maintenance loop runs hourly
   (auto-merge, rebase, retarget, park).

## Checks

Verification is deterministic and hermetic: same step + same repo → same
verifier outcome. The loop runs the checks the target's config names after
every session; mid-session, the agent's `run_checks` tool runs the same
suites through the same runner (capped per session, events feed the rules
engine). Never put secrets or network fetches in the check path — the
engine's provider classification treats network-driven flakiness as budget
burn, and a hermetic stack keeps two checkouts from colliding (owned ports).

## Budgets

Per-session cost and wall-clock caps, per-issue pass caps, and a nightly
dollar ceiling — all persisted per pass, surviving restarts, rolling over at
local midnight. After a cap-stop the loop stays dead until its calendar
start (or a manual restart). Time-based nudges fire at half and four-fifths
of a session's budget. See `docs/2026-11-19-audit-triage.md` for how these
numbers were calibrated from real mistake data.

## Operations (this machine)

- Engine checkout: `/Users/home/Projects/treadle`. Code changes here need a
  manual restart of each affected loop — the calendar start won't replace a
  running process:
  `launchctl kickstart -k gui/$(id -u)/com.treadle-forestbuilder`
- Live instances: `com.treadle-forestbuilder` (tracker:
  `~/Projects/shakti/h2-permissions`) and `com.treadle-jig` (tracker:
  `~/Projects/jig-issues`). Maintenance twins run hourly.
- Logs: `~/Library/Logs/treadle/`. A silent out-log while a loop is loaded is
  healthy (idle polling).
- Live state, decisions, and next actions: read `HANDOFF.md` first.
- Never run destructive git operations in a shared tree; check `git status`
  and recent commits first — a second operator may be live.

## Domain docs

Single-context layout: `GLOSSARY.md` + `docs/adr/` at the repo root. See
`docs/agents/domain.md`. Agent workflow: `AGENTS.md` and
`docs/agents/issue-tracker.md`.
