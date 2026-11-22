# board

The shop: one owner per root, the queue, and a presence endpoint.

## Commands

```sh
board up [--root .room] [--host 127.0.0.1] [--port 4780] [--detach]
board presence [--root .room] [--json]
board fleet [--root .room] [--port 4780] [--json]
board down [--root .room]
board status [--root .room] [--json]
board queue [--root .room] [--json]
```

`up` claims `.room/shop.lock` with `wx` (a stale pid is replaced only after its
process is gone) and serves:

- `GET /health` — pid, shop, since
- `GET /presence` — shop, observedAt, rooms, service address
- `GET /queue` — paused room ids

`--detach` starts the same process detached and waits for the lock. `down` sends
`SIGTERM`, waits, then removes the lock.

`presence` is the same document one-shot, without running the shop. It also carries the factory's
workstreams and reports under `factory`, so the board is the read surface for both places. It includes
local Herdr terminals via `hc ls --json`, and Rex sessions/blocks via the
server binary bundled with the Rex app (`REX_BIN`, then PATH, then the app
support path). A missing source is `available: false`, never "nothing is
running".

A session joins a room only by the explicit Herdr label `room=<id>`, set with
`hc label <terminal> room=<id>`; `joinedBy: "label"` records the join. The
terminal's `cwd` is the shell's directory, not the agent's, so it is never used
as a room identity. A workstream join is `label`, `factory`, `cwd`, or `title`,
and the same `joinedBy` field records which evidence matched. The served
`/presence` keeps `cwd` (the view renders it) and the join result, and drops the
raw label map.

Rex blocks carry a session label, block id, creator, flavor, host and placement;
they have no cwd, so they never join by path either.

There is no POST endpoint that runs a command. The view renders a copyable
`hc attach …` / `rex block focus -s …` command instead: a browser cannot attach
a TTY, and an exec endpoint behind the tailnet would be a shell with a web front
end.

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
