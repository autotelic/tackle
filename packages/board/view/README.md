# @autotelic/board-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed. `/tackle` is the same application's
workspace atlas: every package, its README summary, and its internal dependency
edges, read from `/atlas`. `/vision` is a static map of the factory's process.

It is an **Effect UI** application (`@effect/ui`). The factory route arrives as
one `/presence` read and the tackle route as one `/atlas` read; every transition
is a message, and the UI has no local source of truth.

## Shape

`src/main.ts` is the component: a `Model` and a message union declared with
`Schema` and `UiSchema.TaggedEnum`, a pure `update` whose every transition is one
entry of the record, and a `view` assembled from `h.div.class(...).children(...)`.
The four side effects are declared, not performed by the view:

| Effect          | Kind           | What it does                                              |
| --------------- | -------------- | --------------------------------------------------------- |
| `FetchPresence` | `Command`      | reads `/presence`, decodes it, updates the Model          |
| `FetchAtlas`    | `Command`      | reads `/atlas`, decodes it, updates the Model             |
| `OpenSession`   | `Command`      | `POST /open`, so the board focuses Herdr or Rex           |
| `AnswerDesk`    | `Command`      | `POST /desk/answer`, recording a human choice             |
| `presenceTicks` | `Subscription` | refreshes presence every 20 seconds, off the vision route |

`src/entry.ts` mounts the component with `BrowserHost.mount` and launches the
Layer. The page keeps its own plain CSS (`src/style.css`): a repo is a section
and a phase is a lane, not a widget with its own state.

```
/presence  ──decode──▶  Presence
                         ├─ factory.workstreams  id, repo, project, phase, pr, checkpoint
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual
                         └─ sessions             herdr / rex addresses + workstream
```

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

## The cutlist catalog

`cutlist.config.json` points cutlist at `src/`, and `pnpm cutlist build --cwd packages/board/view`
regenerates `cutlist/` — the catalog, menu, manifest, and vocabularies. The catalog is the answer
to "what is this view made of" for an Effect UI tree: `BoardView` is named by its definition
rather than by `main.ts`, its signature is the helper views and child components it composes,
and the host elements (`h.div`, `h.button`) are deliberately not facts. The generated tree is in
`oxfmt`'s `ignorePatterns`: the generator owns its bytes.

## Install

`@effect/ui` is experimental and is not on npm. The workspace catalog pins it to
a pkg.pr.new snapshot by commit, and the URL is the whole identity — an upgrade
is a new SHA, never a floating range:

```yaml
# pnpm-workspace.yaml
"@effect/ui": "https://pkg.pr.new/Effect-TS/ui/@effect/ui@87a704b"
```

The snapshot is commit `87a704bef41b40de8fa7bced97cae5d69c4233a0` of
[Effect-TS/ui](https://github.com/Effect-TS/ui). Its peer is `effect ^4.1.4`,
which this workspace's `effect 4.1.5` satisfies. `pnpm install` fetches it like
any other dependency; nothing else is needed.

## Run it

The board serves the built view at `/factory`:

```sh
pnpm --filter @autotelic/board-view build
board up --root .room --host 127.0.0.1 --port 4780
open http://127.0.0.1:4780/
```

For UI work, run Vite with the board already up:

```sh
pnpm --filter @autotelic/board-view dev
# http://127.0.0.1:4782/ — proxies /presence to 4780
```

Tests render the component with `Scene` from `@effect/ui/testing`: the served
document is decoded, `given` seeds the Model, and the assertions read the text
the card actually draws.

```sh
pnpm --filter @autotelic/board-view test
pnpm --filter @autotelic/board-view typecheck
```

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
- **Environment** — each card also carries the parts of `factory.environments` the board
  sent: the machine, the worktree, the room's leased port, each declared service with the status a
  probe observed, and the preview route. A missing field draws nothing; a preview is drawn only
  when the board advertised one, and the link resolves against this view's own origin.
- **Phase vs state** — `phase` is the workstream's lifecycle (`reconcile`,
  `build`, `land`, `done`). `state` is what is happening now: `working`,
  `queued`, `blocked`, `idle`, or `done`. A build with no queued work is
  `build · idle`, not budget-blocked; a build with queued work and no passes
  left is `build · blocked` with `budget:passes 10/10`.
- **Activity** — each card says when its last pass ran, whether it is stale,
  what that pass quality was, and what events are queued with their own
  summary. A build that has not passed for two hours is visibly stale instead
  of looking identical to one that just ran. When the phase's pass budget is
  exhausted, the card says so and names the `factory budget` command that
  raises it; a capped queue is not left looking like an idle one.
- **Desk** — questions waiting for a human. The view does not answer them; it
  shows which workstream asked.
- **Sessions** — Herdr and Rex addresses. `Open` asks the board to focus the
  session in its app: a Rex block is focused by block id, and a Herdr terminal
  is attached in Terminal with `hc attach …`. Sessions with no evidence of a
  workstream are listed separately, never assigned by guesswork.
- **Reports** — structured feedback the factory consumed, with expected and
  actual text side by side.

The refresh button is deliberate: this is an observation surface, not a
controller. The only writes are `POST /open`, which validates the address and
runs `rex block focus` or `hc attach`, and `POST /desk/answer`, which records a
human choice; factory state is never written by the renderer.
