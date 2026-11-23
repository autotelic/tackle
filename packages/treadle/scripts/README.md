# scripts

- `pre-push-guardrail` — repo-level push guardrail (#16), installed as
  `.git/hooks/pre-push` in the target repo (worktrees share it): blocks
  pushes to main/master and blocks branch deletions except `loop/*`.
  The Loop's own `checkpoint()` also refuses non-`loop/` branches.
- `audit-summary.ts` — deterministic audit summariser for Treadle session
  logs, no LLM turns. Parses every `issue-*-pass-*.jsonl` event stream in one
  or more `.treadle/sessions` dirs and writes a per-session table plus JSON
  (cost, turns, tool histogram, bash command count, test-run commands,
  ask_human, blocked questions, errors, flags) to `<sessionsDir>/../audit/`.
  Enrichment from Receipts, two sources:
  `--log-dir <trackerLogDir>` reads a markdown tracker's `log/<issue>/*.md`
  receipt files (what the forestbuilder loop uses); `--receipts` reads the
  GitHub Receipt comments via `gh` (slug from origin). Logs missing from
  disk are listed in `receipts-without-logs.txt`. Run from the repo root:
  `node scripts/audit-summary.ts [--log-dir <dir>|--receipts] [.treadle/sessions ...]`
