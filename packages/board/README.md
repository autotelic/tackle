# board

The shop: one owner per root, the queue, and a presence endpoint.

## Commands

```sh
board up [--root .room] [--host 127.0.0.1] [--port 4780] [--detach]
board presence [--root .room] [--json]
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

`presence` is the same document one-shot, without running the shop. It includes
local Herdr terminals via `hc ls --json`, and Rex sessions/blocks via the
server binary bundled with the Rex app (`REX_BIN`, then PATH, then the app
support path). A missing source is `available: false`, never "nothing is
running".

A session joins a room only by the explicit Herdr label `room=<id>`, set with
`hc label <terminal> room=<id>`; `joinedBy: "label"` records the join. The
terminal's `cwd` is the shell's directory, not the agent's, so it is never used
as a room identity. The one-shot command keeps `cwd` and labels as evidence; the
served `/presence` drops both and keeps `roomId`/`joinedBy`.

Rex blocks carry a session label, block id, creator, flavor, host and placement;
they have no cwd, so they never join by path either.

`status` prints the rooms and the lock state: no lock, held by pid, stale, or
unreadable. It never claims a lock it does not hold.

Every five seconds the shop checks each room. A room that is not paused, is
`desired`, and has a saved `exec` is started when it has no live supervisor — so
`room down` (which clears `desired`) stays down, while a wanted room comes back
after a reboot. `/presence` reports each room's process.

The supervisor library in `src/Supervisor.ts` is a separate, tested tree for
future multi-child specs.
