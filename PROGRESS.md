# Progress — #6 phone-first factory view

## Works

- The view is one column at 390px: repo heading, phase lanes, one workstream per row. Every heading is a
  44px disclosure button with `aria-expanded` and a visible chevron, so a repo collapses and a workstream
  opens on a tap. Hover styling lives inside `@media (hover: hover)`, so no touch device depends on it.
- A workstream's detail holds its activity and its live sessions. Each session shows its attach command
  (`hc attach …` / `rex block focus …`) as selectable text beside `Open` / `Copy`.
- `Copy` tries `navigator.clipboard.writeText` through a guarded `Option`. When the API is missing, the
  write rejects, or it throws synchronously (iOS Safari outside a secure context), the command text is
  selected instead and the notice says so. The fallback is `src/copy.ts` (pure, injectable) driven by
  `CopyCommand` in `src/main.ts`.
- `packages/factory-view/README.md` documents `board up --port 4780` and `tailscale serve --bg 4780`, and
  why the tailnet URL matters: `tailscale serve` gives the page the secure origin the clipboard API needs.
- Tests run under **Vitest** (the loop's `unit` Check invokes `vitest run --root packages/factory-view` and
  reads `.treadle/reports/unit.json`). The package declares `vitest` from the workspace catalog, so
  `pnpm --filter @autotelic/factory-view test` and the loop's unit Check are the same runner.
  `test/{view,copy,mobile}.test.ts` cover: repo panel, workstream open/collapse, desk link, the copy-target
  id on the rendered command, rex and herdr attach commands, both notices, the presence error state,
  copied/selected/unavailable copy outcomes (including a synchronous clipboard throw), the 44px targets,
  hover-media containment, `user-select: all`, the 390px single column, wrapping rows, and
  `overflow-wrap` on identifiers. `board/test/cli.test.ts` fetches `/factory` and the JS asset it references.

## Left

- There is no browser harness in this repository (no Playwright), so "390×844 with no console errors" is
  covered structurally by the Scene and stylesheet tests, not by a real viewport. A browser run is still a
  manual step, and adding one is a separate change.
- `checkpoint` is still only the short SHA. Ages (`checkpoint 12m ago`) and per-source freshness belong to
  the ages/freshness issue; the `Presence` schema still requires a checkpoint.
- Disclosure state is in the Foldkit Model, not the URL, so an external `#<workstream>` link lands on a
  page with that card still collapsed. Desk and report links open the card they name because they send a
  message; a shared route per panel is the routing issue, not this one.

## Next session

- Run `pnpm --filter @autotelic/factory-view test` (Vitest) before merging; the loop's `unit` Check runs the
  same files and writes `.treadle/reports/unit.json`.
- `packages/factory-view/dist` is generated and untracked; the board serves it, so rebuild the view after
  changing `src/` (`pnpm --filter @autotelic/factory-view build`).
