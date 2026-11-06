# scripts

- `pre-push-guardrail` — repo-level push guardrail (#16), installed as
  `.git/hooks/pre-push` in the target repo (worktrees share it): blocks
  pushes to main/master and blocks branch deletions except `loop/*`.
  The Loop's own `checkpoint()` also refuses non-`loop/` branches.
