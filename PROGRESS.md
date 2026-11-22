# PROGRESS — factory view

## What works

`/presence` is now projected into **concentric repo panels** (`packages/factory-view`).

- `src/presence.ts` is the wire contract (`observedAt`, workstreams with `repo`,
  `cursors`, `createdAt`, nullable `checkpoint`, sessions). The view decodes it and
  keeps no local state.
- `src/repos.ts` is the only projection: `groupByRepo` returns one panel per repo,
  `unfiled` (sorted last) for workstreams the document names no repo for, with
  `live`, `unobserved`, `unobservedSince` and `pullRequests` counts.
- Each panel's header is a sentence, not a table:
  `acme/web · 3 workstreams (1 live, 1 unobserved since Tue) · 3 PRs`. The
  unobserved count is in that line — no hover, no drill-in — and reads
  `all observed` when the bucket is empty. `live` and `unobserved` partition the
  panel: a session attached is being looked at now, whatever the cursors say.
- **Unobserved** follows `docs/workstream.md`: no cursor advanced since adoption
  (`cursors.github|linear|reports` still the store's empty string), and no session
  is attached. The card says `not observed — no cursor advanced`, or `live now —
  no source read yet` when a session is; the header dates the bucket from the
  latest adoption in it (`since Tue`, or `last looked 3h ago` inside a day).
- **Ages** are measured from the document's own `observedAt`, never the browser
  clock, so two readers of one document read the same ages. Checkpoints render
  `checkpoint 9f1c2ab8 · 12m ago`, or `no checkpoint yet`; `0m` is never rendered.
- **The gate is named, not invented.** `/presence` carries no gate (baseline
  identity count, error/warning counts, newest accepted identity), so each panel
  says `gate: not in /presence · missing …` and the page repeats it under "Not in
  /presence". PR state is missing the same way (`PR_STATE_MISSING`): the header
  counts PR numbers and claims nothing about open vs merged.
- `jig check` is green. `pnpm --filter @autotelic/factory-view build` is green and is
  now **the tests plus the bundle** (`bundle` is `vite build` alone): the loop's
  Checks run only jig and this build, so making the build run the suite is what puts
  the tests under the Checks and lets the Feature-done guard count them.
- Tests: `test/repos.test.ts` (grouping as a partition over generated documents
  with fast-check, counts, unobserved, ages) and `test/view.test.ts` (the real
  view rendered through `foldkit/scene`, read as text — no browser). Vitest writes
  its JSON report to `.treadle/reports/unit.json` (see `vitest.config.ts`), the path
  the loop's guard reads; `.treadle/` is now in `.gitignore`, so it stays local.

## What is missing from `/presence`

Filed as factory reports (blocker):
`report-tackle-view-1795312137685.json`:

- **gate** — no baseline identity count, no error/warning counts, no newest
  accepted identity.
- **PR state** — a PR _number_ is served; open-versus-merged is not.

Adding these means a field in the seam (`board`'s `observe()`), not a new data
path in the view: the panel already renders whatever the document carries.

## What is left

- The `/factory/repo/:owner/:name` filter as a route. Panels are sections with
  `id="repo-<owner>-<name>"` anchors today; the hash route is a later issue.
- The time strip per workstream (passes as ticks, checkpoints as dots, ships as
  markers).
- Per-source freshness (`github: fresh · linear: never`) — the data is already
  on the wire as `cursors`, so this is a rendering decision, not a data one.
- The three closed flags (`phase: done`, `pr: merged`, `project: completed`):
  only `phase` is in the document.

## For the next session

- `jig check` reports 48 baselined identities that no longer fire. The ledger
  was **not** shrunk; that is a deliberate separate change.
- `loop.config.ts` (untracked, outside the tree) declares only `jig` and
  `view-build` as Checks. The view's build now runs the suite and writes the
  vitest report the Feature-done guard reads, so the guard sees a real test count
  without a harness change. If the config is ever regenerated, keep that contract
  in mind.
- The board's `/factory` serving of `dist/` is unchanged: run `build` before
  `board up`.
