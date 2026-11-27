# room

One durable place per scope: a git worktree plus the control-plane state that names it,
and the room's side of the Rat King mail seam.

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
room vm --id dev-1575 -- sh -c 'pwd'
room vm --id dev-1575 --json -- cat package.json
room vm start|stop|status --id dev-1575 [--json]
room vm serve --id dev-1575 --port 4800 --exec 'node server.js'
room vm serve --id dev-1575 --port 4800 --command node --arg server.js
room vm preview --id dev-1575 --port 4800 --path /health
room vm --id dev-1575 --executor-lease .room/lease.json -- pnpm test
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
`pause` sends `SIGSTOP` to the whole process group and `resume` sends `SIGCONT`;
`down` sends `SIGTERM`. Without `--exec`, `pause` and `resume` change only the
recorded state.

A room placed in a VM pauses as a **snapshot**, not a frozen process. `room pause` asks the
room's VM for `filesystem.export({ maxBytes })`, writes the exact bytes beside the room record
as `.room/<id>/vm-snapshot-<n>.json`, records `runtime.snapshot = { path, sha256, bytes,
entries, generation, at }` in `room.json`, and stops the VM supervisor — a paused room has no
live VM, and the file is its disk. Nothing is committed: the worktree and the checkpoint are not
touched by a pause.

`room resume` checks the file against the recorded `sha256` **before** the room is ready, then
builds a fresh VM from it: the snapshot is a root-filesystem `lowers` entry, the supervisor
starts with `--snapshot`, and the VM's own database directory is a new `vm-<generation>/` so
the files it reads come from the snapshot rather than from the previous VM's overlay. A second
pause writes generation `n + 1` — its own file, never an overwrite of the one the resumed VM was
built from.

The export is bounded at 64 MiB (`snapshotMaxBytes`), and it is refused — not stored — when it
carries contents under `/workspace`: the host mount is projected again on resume, so a snapshot
that baked it in could not be restored without a second copy of the checkout. Either refusal is
recorded as `runtime.snapshotError` with the reason, and the room stays `Paused`; a pause that
kept no disk never reads as one that did.

`room use` labels the current Herdr terminal with `room=<id>`, using
`HC_TERMINAL_ID` (Herdr injects it). It refuses if the variable is absent, and
verifies the terminal through `hc get` before labeling. `room up` never stamps a
terminal: it is idempotent and may run in CI or another agent's shell.

`room run` starts a child with `hc run --label room=<id> --cwd <worktree> -- <command>`,
so the child is labeled at spawn rather than after the fact.

`room vm` runs the command in an embedded agentOS VM instead of a host shell: the room's
worktree is mounted at `/workspace` read-write, the VM's sqlite database lives in
`.room/<id>/agentos.sqlite`, and the command's own exit status becomes the exit status.

The VM belongs to a **supervisor**, not to the command. `room vm start` (and any `room vm
-- <command>` when none is running) spawns a detached process, recorded in `.room/<id>/vm.json`
and logged to `.room/<id>/vm.log`, that boots one agentOS instance and answers exec requests on
a Unix socket at `.room/<id>/vm.sock`. A second command joins that VM rather than booting a new
one, which is what makes state outside the mount — a guest `/tmp`, a running process, an
installed package — outlive the command that created it. Commands are answered one at a time:
two commands racing inside one VM would make "the second sees the first" a claim about luck.

`room vm status` reports `running`, `stale` or `absent`. A record whose pid no longer answers is
**stale**, never live: nothing is behind the socket file, and a start takes both. `room vm stop`
signals the supervisor's process group (the agentOS sidecar is its child) and releases the
socket; `room down` does the same before it stops the room's command, because a room whose VM
still answers is not stopped.

Once a room has a VM the placement is recorded in `room.json` as `runtime: { kind: "agentos" }`,
and `room status` names it. The field is optional: a room file without it is a local git
worktree room, which is still what `room new` creates — nothing about the local provider moved.

`--executor-lease` still works through the supervisor. The lease is read and expiry-checked
_before_ anything starts, so an expired lease refuses the command without a VM boot, and its
environment is passed per request: the host environment is never forwarded.

`room vm serve` starts a long-lived command in the guest and records its port and the guest pid
the VM's own process table named it by, as `runtime: { kind: "agentos", previewPort, servicePid }`.
`room status` and `/presence` then report the service from that table: a process that exited is
`stopped` with the exit code the VM kept, a live one still has to answer its health path to be
`healthy`, and `room vm stop` / `room down` kill it before the VM is disposed. `room vm preview`
asks that guest service for one HTTP response over the supervisor socket; no host port is bound. The board preview route uses
the same path when the room has an agentOS runtime, so `/preview/<workstream>/` reaches the VM
service without publishing its port. A service that is not listening is a 502, never an empty
success.

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

A paused room reports no service: its VM is stopped, and the guest process table that would
answer for the service went with it.

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

## Mailbox

The room owns the canonical turn log and the thin `mailbox` command in `src/Mailbox/`:
`export`, `render`, `append`, and `verify`. The wire decisions themselves live in
`@autotelic/protocol`; the board owns the relay and HTTP surface. The log is a projection
of the same turns the wire carries, not a second mailbox.
