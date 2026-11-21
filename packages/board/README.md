# board

The shop: one owner per root, the queue, and a presence endpoint.

## Commands

```sh
board up [--root .room] [--host 127.0.0.1] [--port 4780] [--detach]
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

`status` prints the rooms and the lock state: no lock, held by pid, stale, or
unreadable. It never claims a lock it does not hold.

Every five seconds the shop checks each room. A room that is not paused, is
`desired`, and has a saved `exec` is started when it has no live supervisor — so
`room down` (which clears `desired`) stays down, while a wanted room comes back
after a reboot. `/presence` reports each room's process.

The supervisor library in `src/Supervisor.ts` is a separate, tested tree for
future multi-child specs.
