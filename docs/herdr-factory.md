# Herdr app: open sessions and a factory panel

The web view is the reading surface. Herdr is the machinery surface. This note is
the handoff for making the Open action land in the app and for a native factory
panel that shows attention, not a second copy of the repo table.

## What was wrong

`board` opened a Herdr session with `hc attach <address>` in Terminal. That is
the TUI/core client, not the Herdr app. Herdr exposes a control CLI over its
running window:

```sh
herdr-app do agent.focus --terminal t18
```

Tested against the running app: returns `{ "ok": true }` and brings the app
forward with that terminal focused. `herdr-app ls` lists the same spaces, tabs
and terminals that `/presence` serves.

## Open ladder (board)

The board's `POST /open` now does:

1. validate the address against the live `discoverSessions()` snapshot; an
   unknown address is a 400 and opens nothing;
2. `herdr-app do agent.focus --terminal <address>`;
3. on failure, `open -a Herdr`, wait 500 ms, retry once;
4. only then the former Terminal `hc attach` fallback.

The response carries `rung: "herdr-app" | "herdr-terminal" | "rex"`.

Constraints:

- The address must come from the snapshot. Do not accept a command or arbitrary
  argv from the request.
- There are two callers: the web view's POST and the future native mod. Both use
  the validated-id path; neither builds a shell string.
- Record the rung in the open receipt so the UI can say which client answered.

Acceptance:

- app running: Open focuses the app terminal; rung `herdr-app`;
- app closed: Open launches Herdr, retries, focuses; rung `herdr-app`;
- stale/unknown address: 400, nothing opened;
- app unavailable: Terminal fallback; rung `herdr-terminal`.

## What to borrow from the gallery

Surveyed the mods gallery and local `~/.config/herdr-app`. Relevant shapes:

| mod                          | take                                                         | do not copy                                           |
| ---------------------------- | ------------------------------------------------------------ | ----------------------------------------------------- |
| **Shepherdr**                | sidebar + task panel; one card per agent, decisions surfaced | its task/agent model                                  |
| **Coordinator**              | coordinator row with a question-count badge                  | its coordinator hierarchy                             |
| **Asks**                     | one side panel listing every waiting question                | answer routing unless it is the desk                  |
| **Desk**                     | answer affordance beside a decision                          | its separate desk store                               |
| **Branch Issue / Branch PR** | how to link out to Linear and GitHub                         | do not re-render Linear/PR state in the factory panel |
| **Mission Control**          | compact fleet/status layout                                  | its independent session inventory                     |
| **Open with**                | the picker pattern for “where should this open?”             | editor-specific logic                                 |

Mods are native GPUI JavaScript. They can `exec()`, `run()`, read `spaces()`,
`agents()`, `terminals()`, `focused()`, and share state. They cannot use HTML,
CSS, a web view, Node APIs, or `setTimeout`.

## Proposed factory panel

One native panel, reading the existing projection:

```sh
curl -s http://127.0.0.1:4780/presence
```

(Bind the board on loopback as well as the tailnet address, or make the URL a
single configured value. Do not duplicate the JSON shape.)

Fields:

- `factory.workstreams[]`: `id`, `label`, `repo`, `phase`, `pr`, `delivery`,
  `checkpoint.sha`
- `factory.activity[]`: `workstream`, `state`, `blockedBy`, `budget`,
  `pending[]`, `lastPass`, `ageMinutes`
- `factory.desk[]`, `factory.reports[]`
- `sessions.herdr.sessions[]`: `address`, `workstream`, `where`, `agent`,
  `state`, `status`

Missing field means render nothing. Do not invent a phase, state, or session.

Panel behavior:

- sort by attention: `blocked`, `working`, `queued`, `idle`, `done`;
- show repo + workstream label; state badge; queued count; last-pass age;
- a workstream with a matched Herdr session gets one action: **Focus**, which
  calls `run("agent.focus", { terminal: address })`;
- desk items are the only questions; show a count badge and link to the desk;
- do not show Linear or PR internals; link to Branch Issue / Branch PR.

Layout:

- add one `factory` block to the existing right `panel-body` stack (beside
  `files` and `changes`), or a third narrow panel;
- add a key to show it; do not replace the default layout;
- the web view stays: it is the only surface at phone width.

## Handoff

Build the panel in the repo (so it is reviewable and installable), not only in
`~/.config/herdr-app`: a `herdr/factory/` folder with `main.js`, `mod.json`,
`jsconfig.json`, and an install note that copies or symlinks it into
`~/.config/herdr-app/mods/factory`. Keep the JSON seam; the mod reads
`/presence` and never reads `~/.factory` directly.

Do not retire `packages/factory-view`. It is the reading sink and the mobile
surface. The mod is the live attention sink.

## Verified

- `herdr-app do agent.focus --terminal t18` → `{ ok: true }`
- `POST /open {source:"herdr",address:"t18"}` → `{ ok: true, rung: "herdr-app" }`
- `POST /open {source:"herdr",address:"bogus"}` → 400, no window/command.
