# board

The shop: one owner per root, the queue, the presence endpoint, and the factory kernel.

## Commands

```sh
board up [--root .room] [--host 127.0.0.1] [--port 4780] [--detach]
board presence [--root .room] [--json]
board fleet [--root .room] [--port 4780] [--json]
board down [--root .room]
board status [--root .room] [--json]
board queue [--root .room] [--json]
board adopt --path <worktree> --project <linear> --label <label> [factory options]
board event --id <id> --kind <kind> [--payload <json>] [--at <iso>]
board daemon start|run|stop --worker <command> [--interval <ms>]
board run|watch|report|phase|cursor|budget|desk …
```

The factory commands live in this package under `src/factory/`. The `factory` binary is a
compatibility shim: it forwards to the same command surface, so an existing daemon or
script does not need to change on the day the package moved.

`up` claims `.room/shop.lock` with `wx` (a stale pid is replaced only after its
process is gone) and serves:

- `GET /health` — pid, shop, since
- `GET /presence` — shop, observedAt, rooms, service address
- `GET /atlas` — the workspace's packages, README summaries, and internal dependency edges
- `GET /tackle` — the package atlas page (the same built view as `/factory`)
- `GET /vision` — the static map of what the factory can do and what is still missing
- `GET /preview/<workstream>/` — the room's leased service
- `GET /queue` — paused room ids

`--detach` starts the same process detached and waits for the lock. `down` sends
`SIGTERM`, waits, then removes the lock.

`presence` is the same document one-shot, without running the shop. It also carries the factory's
workstreams and reports under `factory`, so the board is the read surface for both places. Each
served workstream carries `gate`: `baseline` counts the identities in the committed baseline named
by `gate.baseline` in `jig.config.json` (read through `@autotelic/protocol`'s decoder, the package
that owns the format) and `quality` carries the newest receipt's jig counts. Absence is named rather
than zeroed: `baseline.state` is `absent` or `unreadable` with `identities: null`, and
`quality.state` is `unmeasured` when no pass recorded counts. `baseline.newestAccepted` is always
`null` — the baseline is an unordered identity set with no timestamps, so the newest accepted
identity is not in the file, and the field and its note say so instead of being omitted. It includes
local Herdr terminals via `hc ls --json`, and Rex sessions/blocks via the
server binary bundled with the Rex app (`REX_BIN`, then PATH, then the app
support path). A missing source is `available: false`, never "nothing is
running".

Each served workstream also carries an environment under `factory.environments`: the
`machine` from `network.tailscale.self` (null when the daemon is unavailable — no hostname is
guessed from anywhere else), `runtime` as `{kind: "worktree", path}` from the record's own
checkout, `port` as the room lease `{room, number, leasedAt}` whose worktree resolves to that
same path (null when no room leases one), `agent` as the tagged session's address and status
(null when no session claimed the workstream), and the scan's `observedAt`.

`services` carries one entry per room that declares the one service it may run
(`room up --exec <command> --health <path>`): `{name, command, port, healthPath, status,
detail, checkedAt}`. The board does not derive the status — it asks `@autotelic/room`'s
`observeService` while it builds the document, once per declaration and in parallel against the
room's leased port. `healthy` is only the health path's own 2xx answer; `unhealthy` carries the
evidence in `detail` (`HTTP 503`, `ECONNREFUSED`, a timeout); `stopped` is a declared service
whose room has no live supervisor, decided before any socket is opened. A workstream whose room
declares nothing serves `services: []` rather than a service with an unknown health.

`preview` is the board's one stable route for that service — `/preview/<workstream>/` — and it
is served only when the probe observed a 2xx answer. Unhealthy and stopped services keep a null
preview: a route that cannot be opened is not a route. The value is a same-origin path, not an
absolute URL, because the one-shot `board presence` has no bind to name; a renderer resolves it
against the origin that served the document. While the shop is up, that path forwards a GET to the
room's leased port, resolving the workstream's worktree to the room at request time so a room
recreated on another port keeps the URL. An unknown workstream or a room with no service is a
404, an unreachable service is 502, and the service's own status and bytes pass through. There is
one service and one route per workstream in this slice — no container, no database and no
multi-service routing, which remain later slices of `docs/environment-plan.md`.

A session joins a room only by the explicit Herdr label `room=<id>`, set with
`hc label <terminal> room=<id>`; `joinedBy: "label"` records the join. The
terminal's `cwd` is the shell's directory, not the agent's, so it is never used
as a room identity. The one-shot command keeps `cwd` and labels as evidence; the
served `/presence` drops both and keeps `roomId`/`joinedBy`.

Rex blocks carry a session label, block id, creator, flavor, host and placement;
they have no cwd, so they never join by path either.

`network.tailscale` is the address book: self and peers from
`tailscale status --json`, resolved from `TAILSCALE_BIN`, PATH, or the app
bundle. It says which machines exist, not which sessions run on them. The
served document omits peer IPs.

`board fleet` pulls each online peer's `/.well-known/presence.json` (then
`/presence`) on `--port`, merges rooms and sessions under the host label, and
keeps offline or unreachable hosts with their reason. It is one-shot; it does not
require a local shop.

`status` prints the rooms and the lock state: no lock, held by pid, stale, or
unreadable. It never claims a lock it does not hold.

Every five seconds the shop checks each room. A room that is not paused, is
`desired`, and has a saved `exec` is started when it has no live supervisor — so
`room down` (which clears `desired`) stays down, while a wanted room comes back
after a reboot. `/presence` reports each room's process.

The supervisor library in `src/Supervisor.ts` is a separate, tested tree for
future multi-child specs.
