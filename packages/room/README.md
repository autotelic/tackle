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
