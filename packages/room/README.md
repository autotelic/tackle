# @autotelic/room

One ledger per Linear project, a daemon on each machine, and a review job that runs `jig`, a
Pi, and one fenced post.

```
jig room plan        read the repo, the token, and the rooms; print the init it would run
jig room init        write .room/config.json, register the room
jig room dev         run the room locally with `celld dev`
jig room board       jobs, chits, and presence (the same JSON the Pi widget reads)
jig room doctor      prove the loop: config, identity, celld, forward, room
jig room webhook     print the `gh webhook forward` command for this room
jig room daemon      claim jobs and run reviews
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

`celld dev` keeps its state in `packages/room/.celld/dev` and needs `esbuild` on PATH;
both are local-only. A room is addressed by `linear:<projectId>@<stage>`; `local/<login>`
is the stage until the room is shared.

The review is triggered by either address:

- a **review request** naming the room's actor, or
- a **labeled PR** carrying the room's `--label`, authored by someone else.

A push is not a request. The daemon checks the PR's reviews for its marker before posting,
so a re-delivered webhook cannot post twice, and a re-request after a push runs again.

## Pi

`extensions/pi.ts` is the terminal surface: a widget above the editor, a `/room` picker, and a
`room_board` tool. It shells out to the CLI, so it renders the same bytes a person sees. Load
it with `pi -e packages/room/extensions/pi.ts`, or install this package as a Pi package.

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
