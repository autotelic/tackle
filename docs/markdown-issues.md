# Markdown issues

When a target repo's `loop.config.ts` sets `issues.tracker: 'markdown'`, the
Loop reads its queue from markdown files in `issues.dir` instead of GitHub
issues. The directory is normally a git repo the Loop pulls before reading and
pushes after writing — e.g. a clone of a bare repo that a laptop (which may be
offline for long stretches) also pushes to. Pull requests still open on GitHub;
only issue tracking moves.

```ts
issues: {
  tracker: 'markdown',
  dir: '/Users/home/Projects/shakti/h2-permissions',
  ready: 'ready',
  working: 'working',
  parked: 'parked',
},
```

## Layout

```
<dir>/
├── issues/
│   ├── 001-relationship-view.md
│   └── 002-project-contractor-table.md
└── log/
    └── 001/
        ├── 2026-11-10T03-12-33-123Z-a1b2c3.md   ← one file per Receipt or note
        └── 2026-11-10T04-01-02-456Z-q7r8s9.md
```

## Issue file format

Filename: `<number>-<slug>.md`. The number is the issue's id: it names the
branch (`loop/<n>`) and the log directory (`log/<zero-padded-n>/`).

Frontmatter, all optional:

```yaml
---
state: ready # ready | working | parked | done. The queue label.
  # Absent = draft: invisible to the Loop.
base: 3 # Stacking: branch from loop/3. Or a ref: develop,
  # origin/x. Absent = the repo's default branch.
blocked_by: [1, 2] # Issue numbers. A blocker is open until its file says
  # state: done; a missing reference blocks (conservative).
title: ... # Else the first # heading, else the filename slug.
---
```

The body is the spec the Session works from, exactly like a GitHub issue body
(frontmatter is stripped before the Session sees it).

The frontmatter reader is deliberately small: `key: value` scalars and
`[a, b]` inline arrays. Unquoted values may end with a `# comment`.

## What the Loop writes

- **Receipts, park summaries, Q&A notes**: timestamped files in `log/<issue>/`,
  bodies verbatim (the hidden receipt JSON round-trips; budget resets use the
  same `<!-- treadle:budget-reset -->` marker).
- **State changes**: the `state:` frontmatter line only. Everything else in the
  file is yours.
- **After a PR opens**, the Loop clears the `state:` line (same as GitHub
  removing the working label). The issue leaves every queue but still blocks
  dependents; mark `state: done` when you merge.

Every write is committed and pushed immediately. Before each queue read the
Loop pulls: `merge --ff-only`, falling back to `rebase --autostash` if a laptop
push raced the Loop's commits. Because the Loop never edits your files, these
merges apply cleanly. If the fetch fails (laptop unreachable), the Loop works
the state it has — the local clone is the truth until the machines meet again.

## Steering the Loop

- **Reprioritize or reparent**: edit `state:`, `base:` or `blocked_by:` and
  push. The next queue read sees it.
- **Answer a question**: `/treadle` as usual — the answer lands as a log note
  and the issue goes back to ready if it was parked.
- **Hand a hint to a parked issue without Telegram**: write a log note
  containing `<!-- treadle:budget-reset -->` (restarts its budget) and set
  `state: ready`.

## Stacked PRs

- `base: 3` means: branch `loop/<this>` from `loop/3`'s tip, and open the PR
  with `--base loop/3`, so GitHub shows only this issue's increment.
- The issue joins the ready queue only once `loop/3` exists (locally or on
  origin) — i.e. once the base issue has started. Combine with `blocked_by:`
  when the later issue must wait for the base to actually merge.
- A named base (`base: develop`) skips the branch-existence gate and fails at
  branch creation if the ref is wrong — a loud, one-time error you fix in the
  file.
- With no `base:`, the base is the repo's own default branch (`origin/HEAD`,
  asking the remote when that is unset), not hard-coded `main`.

## GitHub issues can stack too

A `Base: <ref>` line (alone on its line) in a GitHub issue body is the same
field: `Base: 3` stacks on `loop/3`, `Base: develop` branches from develop.

## Limitations

- `run-issue.ts` (the one-shot script) stays GitHub-only; the Loop
  (`run-loop.ts`) is the supported entry point.
- Numbering is yours: the Loop never creates issues, so there is no counter to
  allocate. Pick the next number when you write the file.
