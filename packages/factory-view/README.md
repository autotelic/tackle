# @autotelic/factory-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed.

It is a Foldkit application. State arrives as one `/presence` read; every
transition is a message, and the UI has no local source of truth.

It is assembled from **primitives**, not a component kit: `ticks` from
`foldkit-primitives/time` refreshes presence every 20 seconds, and `copyText`
from `foldkit-primitives/dom` is a Command whose `Copied`/`CopyFailed` result
is reduced by `update`. The layout is plain Foldkit HTML and CSS, so a repo is
a section and a phase is a lane rather than a widget with its own state.

## Shape

```
/presence  ──decode──▶  Presence
                         ├─ factory.workstreams  id, repo, project, phase, pr, checkpoint
                         │                       observed, freshness, freshnessBySource,
                         │                       budget, blockedBy, prState, projectState
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual
                         └─ sessions             herdr / rex addresses + workstream
```

The board computes `observed`, `freshness`, `freshnessBySource`, `budget` and
`blockedBy` from the workstream record and its receipts, so the view renders one
document instead of recomputing a second source. `prState` and `projectState` are
the owners' flags (GitHub, Linear); when the record does not carry one the panel
says `unknown` and names the missing comparison rather than guessing.

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

## Run it

The board serves the built view at `/factory`:

```sh
pnpm --filter @autotelic/factory-view build
board up --root .room --host 127.0.0.1 --port 4780
open http://127.0.0.1:4780/
```

For UI work, run Vite with the board already up:

```sh
pnpm --filter @autotelic/factory-view dev
# http://127.0.0.1:4782/ — proxies /presence to 4780
```

## Panels

The overview links each workstream to `/factory/workstream/<id>`. That path is a
filter over the same `/presence` document: the panel renders one workstream's
phase, checkpoint age, per-source freshness, budget, `blockedBy` ids, the PR and
Linear project links, its sessions, desk items and reports.

The three closed flags stay separate, because their disagreement is the useful
state:

```
phase done · PR 1862 open · project started
phase done · PR 1862 open — ready for a person, not finished
```

`no checkpoint yet` and `observed: never` are words, not zeros; a budget always
carries its denominator (`3/5 passes`) or a reason (`cap stop: passes 5/5`).

## What each row means

The page starts with the kernel's state machine and the current count in each
phase. Below it, workstreams are grouped by **repository**, then by **phase**,
so a repo is a section and its lanes are the states it currently occupies.

- **Workstreams** — one card per adopted workstream, in phase order. `phase` is
  the kernel's state; `checkpoint` is the commit the last pass stopped at. The
  matching live sessions sit inside the card, so the jump to the conversation
  is on the workstream itself. A session joins by an explicit
  `workstream=<id>` label, by cwd inside the workstream path, or by the words in
  its tab title; an unmatched session stays in the bottom list rather than
  being guessed onto a workstream.
- **Desk** — questions waiting for a human. The view does not answer them; it
  shows which workstream asked.
- **Sessions** — Herdr and Rex addresses. `Open` asks the board to focus the
  session in its app: a Rex block is focused by block id, and a Herdr terminal
  is attached in Terminal with `hc attach …`. `Copy` gives the command instead.
  Sessions with no evidence of a workstream are listed separately, never
  assigned by guesswork.
- **Reports** — structured feedback the factory consumed, with expected and
  actual text side by side.

The refresh button is deliberate: this is an observation surface, not a
controller. The only action is `POST /open`, which validates the address and
runs `rex block focus` or `hc attach`; factory state is never written here.
