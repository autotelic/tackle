# @autotelic/room

One ledger per Linear project — or per GitHub label, when the workstream has no project — a
daemon on each machine, and a review job that runs `jig`, a Pi, and one fenced post.

```
jig room plan        read the repo, the token, and the rooms; print the init it would run
jig room init        write room.config.json, register the room
jig room dev         run the room locally with `celld dev`
jig room board       jobs, chits, and presence (the same JSON the Pi widget reads)
jig room doctor      prove the loop: config, identity, celld, forward, room
jig room webhook     print the `gh webhook forward` command for this room
jig room daemon      claim jobs, run reviews, deliver into the durable session
jig room session     the durable conversation: --json, --say <text>, --note <kind>, --watch
                     and the claim on it: --attach, --status, --release, --take-over
jig room review      run one review by hand
jig room list        rooms, most recently active first
```

## Shape

```
board/          the bytes: chit · claim · job · receipt · presence (no runtime)
room/
  src/ledger.ts   the SQL, over a `Sql` port
  src/api.ts      the HTTP surface, written against the ledger
  src/daemon.ts   roomd: presence, claim, review, finish (Effect)
  src/review.ts   worktree → jig → pi -p → one post
  worker/         the Durable Object bundle celld runs
```

The room is the listener. Webhooks land on `/r/<room>/ingest`; the daemon is a client that
claims jobs. That is why `roomd` has no HTTP server of its own.

The session is a **durable conversation** ([@earendil-works/pi-durable](https://www.npmjs.com/package/@earendil-works/pi-durable)),
not a process the room keeps alive: `src/session.ts` opens it over the room's own sqlite storage,
submits delivered items as inputs, and reads a view (busy, queue, why the last run ended). Resume,
single-writer admission, forking, and handoff are that library's job; the room must not grow a
second registry, heartbeat, or wake spawn to do them again. The first version did, and the
symptom was a room that accepted events and queued nothing until someone PUT a config by hand.

### Three things the durability buys, and where they live

| What                                                                                                                                      | Where                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Delivery** — an inbox turn becomes a conversation input; a running answer queues it, an idle one starts                                 | `daemon.ts` → `submitToRoom`                                                                                                   |
| **Broadcast** — facts a hook records (an edit ran, a session closed) without asking the model                                             | `noteToRoom` (a pi-durable _write_), `room session --note`, the Pi extension's `tool_execution_end` / `session_shutdown` hooks |
| **Multiplayer** — every surface opens the same storage: the daemon delivers, each person's Pi watches and submits, nobody owns a terminal | `room session --watch` (JSONL), `room session --say`, the editor-border badge                                                  |

`room webhook` wires the events: it prints `gh webhook forward` for a local room, and with
`--create` prints (or `--apply` runs) the `gh api` call that registers a real webhook on a
deployed one. Linear's delivery URL is printed beside it.

## The project session

The room can deliver events into the Pi session you are already using. On `session_start`
the extension registers its session id and polls `/inbox` every five seconds:

- a comment or review from someone else on a pull request is a **turn** — it becomes a
  follow-up message and starts a run;
- a labeled PR, a close, or a Linear state change is a **card** — a notification, not a turn;
- the session's own comments and reviews are receipts only.

Deliveries are deduped by the webhook delivery id. A sweep on one pull request is held for
30 seconds and delivered as one message, so four blockers read like one review. The
extension acknowledges after handing the message to Pi. If the session is closed, `roomd`
resumes it headlessly (`pi -p --session <id>`) and acknowledges the turn; reopening the
session shows the work that happened. The machine must be awake — a sleeping laptop is a
hosting problem, not an extension one.

## Worker sessions

`jig room work --pr 1709 --kind fix` creates a worktree at the PR head and starts an
attachable Pi session in it through [herdr-core](https://github.com/herdrdev/herdr-core):

```
worker room-1709-fix · t2
  attach: jig room attach --name room-1709-fix
```

`hc` owns the terminal: attach, read, send, wait, and the Program Status Protocol. The room
records the address in `workers` and shows it on the board. `worker.substrate` in the config
is `hc` today; `rex` is the named seam for the same runner later.

Review jobs use the same substrate: the worktree is prepared, `run.sh` writes Pi's JSONL to
the job directory, and `hc` runs it while the daemon polls the terminal. If `hc` is missing,
the review falls back to the direct `pi -p` child. A marked review on #1 was posted this way.

## Worker environments

A worker is not only a checkout. `room work` allocates a port, writes an env file, runs the
database command, starts the app in `hc`, and starts Pi in the same worktree:

```json
"worker": {
  "substrate": "hc",
  "app": {
    "setup": "pnpm install",
    "up": "pnpm dev --port $PORT",
    "health": "http://127.0.0.1:${PORT}/",
    "database": { "create": "createdb room_${WORKER}", "drop": "dropdb room_${WORKER}" },
    "env": { "DATABASE_URL": "postgres://localhost/room_${WORKER}" }
  }
}
```

`${PORT}`, `${WORKER}`, and `${WORKTREE}` expand into the env file and commands. The board
shows the worker and its URL (`room-1-fix t7 · http://127.0.0.1:53180/`). `room stop` runs
`down`, drops the database, kills both terminals, and removes the worktree. Without an
`app` block, `room work` still creates the worktree and the attachable Pi session.

## Local loop

```sh
curl -fsSL https://celld.dev/install.sh | sh      # once
jig room dev                                      # the room, at 127.0.0.1:9876
jig room init --room <name> --linear-project <id> --linear-name "<name>"
jig room webhook | sh                             # gh webhook forward
jig room daemon                                   # the hands
```

Building this workspace: `pnpm build` at the root builds every package in dependency order.
`pnpm --filter <one package>... build` does not cover `room`: `jig` shells out to it rather than
depending on it, so a filtered jig build leaves a stale `packages/room/dist`, and a stale `dist`
of `@autotelic/board` fails at import with a missing export that looks like a source bug.

A workstream addressed by a GitHub label and with no Linear project is a room too; the label is
then the address as well as the label a PR carries:

```sh
jig room init --room platform-upgrade --label maintenance
```

`--linear-project` and `--linear-name` go together, and a room needs one address or the other:
neither is `a room needs an address`, one of the pair is `go together`. A label room writes
`project.kind: "github"` and `ingress.linear: "none"` — there is no project to read, and a poller
pointed at some other one would pull unrelated issues into this ledger.

`celld dev` already watches: it rebuilds the Worker bundle when a file in the room changes, so
`src/api.ts`, `ingest.ts`, and `policy.ts` are live without a restart (`--no-watch` turns it
off). The daemon and the extension need a word to do the same:

```sh
jig room daemon --watch                            # node --watch: restarts on an imported source change
ROOM_DEV_WATCH=1 pi -e packages/room/extensions/pi.ts   # save pi.ts, the extension reloads itself
```

A daemon restart interrupts a job in flight; its claim expires and the queue takes it again. The
extension switch exists because `/reload` only re-reads auto-discovered extensions, and the room
extension is loaded with `-e` in development — and because a shipped extension must never restart
somebody's session on its own.

`celld dev` keeps its state in `packages/room/.celld/dev` and needs `esbuild` on PATH;
both are local-only. That store **is the ledger** — jobs, receipts, claims — and celld derives it
from the directory holding `wrangler.json`, with no flag or environment variable to relocate it.
So a `git clean -fdx` in this checkout deletes the room's board, and a second `celld dev` against
the same directory fights it for the store's lease (`node-lease CAS ambiguous`). A probe or a
second instance belongs in its own directory: copy `wrangler.json`, symlink `worker/` and
`node_modules/`, and run `celld dev <that dir>`. `jig room dev` prints the store path it uses, and
`--clean` is the only thing that deletes one. A room is addressed by `linear:<projectId>@<stage>`, or by
`github:<label>@<stage>` for a label-addressed room; `local/<login>` is the stage until the room
is shared. The prefix is the kind, so a label and a project id of the same string are two rooms. That address is the room's identity in every URL
(`/r/<address>/ingest`, `/r/<address>/board`) and it is what the CLI sends. The friendly `name` is a
label, never an address: a request to `/r/<name>/…` creates a second, unseeded ledger that accepts
events and queues nothing — a broken-looking room, not a typo the room can report. `room dev` prints
the address, and `room board --json` carries it as `address`.

The review is triggered by either address:

- a **review request** naming the room's actor, carrying the room's `--label` when one is set, or
- a **labeled PR** carrying the room's `--label`, authored by someone else.

A review request names a person, not a project. Without the label check every request in the
organisation landed in whichever room watched that person, so triage arrived inside a session that
might be mid-rebase; with `--label` set, a request for another workstream is counted, not queued.
`board` prints `unrouted N review event(s) were not this room's label` when any were — a filter
that dropped in silence would read exactly like an ingress that never arrived.

A push is not a request. The daemon checks the PR's reviews for its marker before posting,
so a re-delivered webhook cannot post twice, and a re-request after a push runs again.

## Who is driving

The durable conversation outlives every session, and until it was claimed, nothing on the board
said which session was on it: `here togmund@macbook-pro.local` is the daemon's presence, not the
Pi session doing the work.

```sh
jig room session --attach      # record this session and worktree as the room's driver
jig room session --status      # who is driving, and whether a run is working (reads only)
jig room session --release     # stop driving
```

The worktree recorded is the caller's, not the room's: git's top level from the directory the
command ran in, so two sessions in two linked worktrees of one repository read as two claims
rather than one. `--worktree <path>` overrides it, which is the case when the command runs from
the room's checkout while the work is in a sibling worktree.

`board` prints `driving 01a18442 · seed-stack · 2h ago` above `here`, and `board --json` and
`session --json` carry the same claim as `driver`. `--say` from a session that is not the driver
is refused, naming the one word that overrides it: `--take-over` (which also claims the room, so
the next sentence is yours). Notes and reads are not gated — a second session recording a fact or
reading the transcript is what the ledger is for.

The claim is a file, not a heartbeat: a session id cannot be probed for existence, so a liveness
guess would be wrong exactly when the process was killed. A stale claim costs one `--take-over`.

## Pi

`extensions/pi.ts` is the terminal surface: a badge in the editor's top border, a `/room` picker,
and a `room_board` tool. It shells out to the CLI, so it renders the same bytes a person sees.
Load it with `pi -e packages/room/extensions/pi.ts`, or install this package as a Pi package.

`/room` with no argument opens the machine's rooms: type to filter (`dmv` finds
`data-migration-v1`), up/down to move, enter to pick, esc to cancel. Picking one sets the badge,
the tools' default room and the message stream together; `/room use <name>` does the same
without the picker.

The surface is rendered, so it is checked in a terminal, not in a unit test.
`pnpm --filter @autotelic/room tui` boots Pi in tmux over a fixture room home and prints the
screen; `scripts/tui-repl.sh` documents the keys it can send. `ctx.ui.custom()` returns
`undefined` in RPC mode, so the picker is invisible over the wire and tmux is the cheapest
honest terminal.

## End to end, locally

```sh
CELLD_ESBUILD="$(pwd)/packages/room/node_modules/.bin/esbuild" celld dev
jig room init --room e2e --linear-project <id> --linear-name "E2E" --label multi-season
jig room webhook | sh
jig room board
```

A `review_requested` or labeled `pull_request` webhook is deduped by delivery id, queued as
`pr:<n>:<sha>`, claimed exactly once, and shown in the board. A labeled PR by the room's own
actor is ignored. The Pi widget refreshes every 15 seconds.

## Alchemy and celld

v0 runs the Worker bundle directly under `celld dev`. Alchemy v2 authors the same bundle
for the deployed hosts, but the Celld provider is still open PR
[alchemy-run/alchemy#1127](https://github.com/alchemy-run/alchemy/pull/1127) and is not in
`alchemy@2.0.0-beta.83`. Until it lands (or is pinned), `alchemy.run.ts` would be a second
authoring of the same room and a red typecheck. The bundle, `wrangler.json`, and the DO
class are the seam that makes that a small change.
