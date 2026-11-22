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
  `acme/web · 2 workstreams (1 live, 1 unobserved since Tue) · 2 PRs`. The
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
- `pnpm --filter @autotelic/factory-view build` is green and `jig check` is green.
- Tests: `test/repos.test.ts` (grouping as a partition over generated documents
  with fast-check, counts, unobserved, ages) and `test/view.test.ts` (the real
  view rendered through `foldkit/scene`, read as text — no browser).

## What is missing from `/presence`

Filed as a factory report (`tackle-view`, kind `blocker`,
`report-tackle-view-1795312137685`):

- **gate** — no baseline identity count, no error/warning counts, no newest
  accepted identity. Each repo panel names this instead of inventing a gate
  (`GATE_MISSING` in `src/repos.ts`).
- **PR state** — a PR _number_ is served; open-versus-merged is not
  (`PR_STATE_MISSING`). The header therefore counts PRs and claims nothing more.

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
- `VISION.md` was missing its trailing newline on this branch's base; fixed in
  passing, so `pnpm format:check` is green.
- The loop's `loop.config.ts` declares no `vitest-json` report step, so the
  Feature-done guard looks for `.treadle/reports/unit.json`, which nothing
  writes. The new tests run under `pnpm --filter @autotelic/factory-view test`
  and the repo's `pnpm check`, but **not** under the loop's Checks.
