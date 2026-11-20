# @autotelic/treadle

## 0.1.0

### Minor Changes

- 05c0c7a: Treadle joins the workspace: the loop engine, with its history.

  Imported from `autotelic/treadle` at `93f3c78` with `git subtree`. It runs one long-lived loop of
  agent sessions against one repository: a markdown issue tracker as the queue, one session at a
  time, deterministic checks after every session, checkpoints on the issue's branch, receipts, and
  per-session, per-pass and nightly budgets. A maintenance twin merges green PRs.

  It is an **application**, not a library: there is no `bin` and no `exports` yet, so this release
  versions and tags it but does not publish it to npm. It keeps its own Biome gate for now; the
  conversion to the house rulebook, the two compiler-strictness flags, and a CLI surface are
  recorded in `MIGRATION.md`.

  Two fixes came with the move: checks run under the operator's `$SHELL` (then bash, then sh)
  instead of a hardcoded `zsh`, and never interactively, so a verifier cannot inherit a
  `.zshrc`; and the sandbox-config test skips when its sibling checkout is absent.
