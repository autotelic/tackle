# PROGRESS — workstream panel (#2)

## What works

- `/factory/workstream/:id` renders one workstream from the same `/presence`
  document; the overview links each card there and `board up` serves the path as
  the SPA shell. A path the document does not carry says so instead of inventing a
  row.
- The panel renders phase, checkpoint age (`no checkpoint yet`, never `0m`),
  overall and per-source freshness, `blockedBy` ids, observed ages, and budget
  with its denominator (`3/5 passes`) or reason (`cap stop: passes 5/5`).
- The three closed flags stay separate (`phase`, `PR`, `project`); disagreements
  render as a warning, e.g. `phase done · PR 1862 open — ready for a person, not
  finished`.
- `/presence` now carries the fields the panel reads: `observed`, `freshness`,
  `freshnessBySource`, `budget`, `blockedBy`, plus pass-through `prState` /
  `projectState` / `projectUrl` when the workstream record has them.
- The view suite renders through `foldkit/scene`; pure status and route suites
  cover the three freshness values, the null checkpoint and the closed flags, and
  a board CLI suite reads a record and its receipts from a temporary factory home.
  `jig check`, lint, typecheck, format and the view build pass.

## What is left

- Nothing in the factory writes `prState` or `projectState` yet. The panel shows
  `unknown` and names the missing comparison; a source poll should persist those
  fields when it learns them.
- The Linear project link is built from `linearProjectId` as
  `https://linear.app/project/<id>` when the record has no `projectUrl`. Prefer a
  source-supplied URL once the poller stores one.
- The time strip (passes as ticks, checkpoints as dots, ships as markers) is still
  a later issue.
