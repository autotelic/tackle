# room

One durable place per scope: a git worktree plus the control-plane state that names it.

## Commands

```sh
room new --repo ~/code/app --scope dev-1575
room new --repo ~/code/app --scope dev-1575 --branch feature/existing-pr
room status [--id dev-1575] [--json]
room up --id dev-1575
room up --id dev-1575 --exec 'pnpm dev'
room up --id dev-1575 --exec 'pnpm dev' --health /healthz [--service web]
room pause --id dev-1575
room resume --id dev-1575
room down --id dev-1575
room use --id dev-1575
room run --id dev-1575 -- pnpm test
```

`new` creates `.room/<id>/worktree` and `.room/<id>/room.json`. `up` is
idempotent: an existing worktree is not re-added.

With `--branch`, the worktree checks out that existing branch instead of minting
`room/<base>`; use it for a PR branch so commits land where the pull request can
see them.

With `--exec`, `up` starts a detached supervisor (recorded in `run.json` and
logged to `.room/<id>/room.log`) that restarts the command with a crash budget.
The command is remembered in `room.json`, so a later `room up --id <id>` with no
`--exec` starts the same command again.
`pause` and `resume` send `SIGSTOP`/`SIGCONT` to the whole process group;
`down` sends `SIGTERM`. Without `--exec`, `pause` and `resume` change only the
recorded state.

`room use` labels the current Herdr terminal with `room=<id>`, using
`HC_TERMINAL_ID` (Herdr injects it). It refuses if the variable is absent, and
verifies the terminal through `hc get` before labeling. `room up` never stamps a
terminal: it is idempotent and may run in CI or another agent's shell.

`room run` starts a child with `hc run --label room=<id> --cwd <worktree> -- <command>`,
so the child is labeled at spawn rather than after the fact.

`up` also leases one port for the room, from 4400 to 4499, and records it in
`room.json` as `port: { number, leasedAt }`. The lease is idempotent; a second
`up` keeps the port. Allocation skips any port another room's file names, and
the exclusive claim file `.room/ports/<port>.json` makes the claim atomic, so
two `up`s cannot both win one port. A claim whose room no longer names that port
is debris and is reclaimed. `down` releases the lease — after the process it
protects has stopped, so a shutdown never hands its port to the next room;
`pause` and `resume` leave it alone, because a frozen room still owns its port. A
room that is up without a supervisor still leases its port, so `down` works on it
too.

A room may declare **one service**: `--health <path>` (with `--service <name>`,
default `web`) records `service: { name, command, healthPath }` in `room.json` and
starts that command the way `--exec` does. The service declares no port of its own —
the room's lease is the only owner of the number, and the supervisor hands it to the
command as `PORT` — so the process and the probe cannot answer on different ports. A
command without a health path stays a plain `exec` and contributes no service: there
would be nothing honest to observe.

Health is observed, never inferred. `observeService` (exported from the package)
asks `http://127.0.0.1:<leased port><healthPath>` once, following no redirect, and
reports one of three states: `healthy` only on the health path's own 2xx answer,
`unhealthy` with the evidence (`HTTP 503`, `ECONNREFUSED`, a timeout), and `stopped`
when the room has no live supervisor — checked before any socket is opened. There is no
`starting`: a grace window is a state nobody observed. `room status --id <id>` prints
the observation and `--json` carries it as `service`.

`move` is not implemented and refuses rather than recording a move that does not
copy the worktree.

The room store asks the `Room` aggregate for every transition; the CLI is not a
second state machine.
