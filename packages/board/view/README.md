# @autotelic/board-view

The software factory's view: one page that shows every open workstream, its
phase, its checkpoint, the pending desk item, the sessions that can open it, and
the reports the factory has consumed. `/tackle` is the same application's
workspace atlas: every package, its README summary, and its internal dependency
edges, read from `/atlas`. `/vision` is a static map of the factory's process,
including Alchemy's room inventory: what the stack declares, what the room owns,
and what agentOS runs. `/rooms` is the room front door: create one, read the control
plane's list, and move a room through its lifecycle.

It is an **Effect UI** application (`@effect/ui`). The factory route arrives as one
`/presence` read, the tackle route as one `/atlas` read, and `/rooms` as one room control
document read; every transition is a message, and the UI has no local source of truth.

## Shape

`src/main.ts` is the component: a `Model` and a message union declared with
`Schema` and `UiSchema.TaggedEnum`, a pure `update` whose every transition is one
entry of the record, and a `view` assembled from `h.div.class(...).children(...)`.
The side effects are declared, not performed by the view:

| Effect          | Kind           | What it does                                     |
| --------------- | -------------- | ------------------------------------------------ |
| `FetchPresence` | `Command`      | reads `/presence`, decodes it, updates the Model |
| `FetchAtlas`    | `Command`      | reads `/atlas`, decodes it, updates the Model    |
| `FetchRooms`    | `Command`      | reads `/rooms`, decodes it, updates the Model    |
| `CreateRoom`    | `Command`      | `POST /rooms`; the board runs `room new`         |
| `RoomLifecycle` | `Command`      | `POST /rooms/:id/<verb>`, then re-reads the list |
| `OpenRoom`      | `Command`      | `POST /rooms/:id/open`; Herdr focuses or starts  |
| `OpenSession`   | `Command`      | `POST /open`, so the board focuses Herdr or Rex  |
| `AnswerDesk`    | `Command`      | `POST /desk/answer`, recording a human choice    |
| `routeTicks`    | `Subscription` | refreshes the route's document every 20 seconds  |

`src/entry.ts` mounts the component with `BrowserHost.mount` and launches the
Layer. The page keeps its own plain CSS (`src/style.css`): a repo is a section
and a phase is a lane, not a widget with its own state.

```
/presence  ──decode──▶  Presence
                         ├─ factory.workstreams  id, repo, project, phase, pr, checkpoint
                         ├─ rooms                id, state, runtime, process, vm
                         ├─ factory.desk         id, title, workstream
                         ├─ factory.reports      kind, workstream, expected, actual
                         └─ sessions             herdr / rex addresses + workstream
```

The view never imports `board` or `factory`. The JSON is the seam; the local
schema is the wire contract.

## Change impact: two pages, two questions

When a change lands, evaluate both pages before deciding it needs UI work:

1. **/factory** — is there a new live fact a person can observe? If yes, it belongs in a
   board document first (`/presence`, `/atlas`, or `/fleet`) and then in a row. A fact the
   board does not serve does not become a view claim.
2. **/vision** — did the explanation of the system change? If yes, update the scene and its
   `WORKS` / `NOT BUILT` badge. If the change is internal to an existing box, leave the map
   alone; a new box is not a status update.

If neither answer is yes, do not add a panel. The view is an observation surface, not a
changelog.

## The room front door

`/rooms` is the first vertical slice of the room flow: create a room, read the rooms the
board serves, and move one through its lifecycle. It is a client of the board's room control
plane, not a second one.

- **New room** — the form posts the board's own `RoomCreateRequest`: id, repo, scope, an
  optional base, and an optional software declaration. The board runs `room new`, so the
  worktree, the journal, and the state are the room tool's to make; the page predicts none of
  them.
- **The list** — one row per room from `GET /rooms`: state, runtime, branch, worktree, port,
  the journal's path and whether its bytes are there, the VM's state and pid, the supervisor
  socket, and a preview route only when the board can answer one. A field the board did not
  send draws nothing.
- **Lifecycle** — `start`, `up`, `pause`, `resume`, `down` post to
  `/rooms/:id/<verb>` and re-read the list. `start` starts the room's VM and `up` starts its
  service; the board keeps both verbs because they are different machines of work.
- **Errors and pending** — a refusal the board wrote is drawn as its own sentence, and the
  request in flight is named (`pause alpha…`) until it settles.
- **Open in Herdr** — the room's terminal surface is Herdr's, never an xterm in the page.
  `POST /rooms/:id/open` focuses a live terminal labeled `room=<id>`; when none exists it
  starts the user's shell in the room worktree with that label and focuses what `hc run`
  answered. The response names the rung and the address, or the reason it could not open.
  Creating a room starts nothing: the human action is the only trigger.

The seam is the JSON, exactly as on the other routes: the form is input state the Model holds
while it is typed, and every fact about a room comes back from `/rooms`.

**Next, deliberately not in this slice:** the changes the worktree accumulated and
ship/archive. Each is a new read on the board (or a room verb that already exists) before it
is a panel; neither changes this page's seam. The board's
loopback rule stays as it is: only the board's own listener may mutate a room, and the view
reaches it from the same origin.

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
# http://127.0.0.1:4782/ — proxies /presence and /rooms to 4780
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
- **Room inventory** — the rooms the board serves under `/presence.rooms`: each
  `room.json` state and the process the room owns. It is the observation surface for the rooms
  Alchemy can declare; a room with no process says `no process` rather than implying a machine.
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
