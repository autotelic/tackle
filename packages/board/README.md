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
unreadable. It never claims a lock it does not hold. The supervisor library in
`src/Supervisor.ts` is tested but not yet wired to room children; `up` is the
shop's lock and presence service, not a process tree.
