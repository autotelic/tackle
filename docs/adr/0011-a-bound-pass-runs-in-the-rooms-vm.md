# ADR 0011 — a bound pass runs in its room's VM, and the gaps are named

Status: accepted
Date: 2026-11-27

## Context

ADR 0010 bound a workstream to a room: a pass resolves the binding, takes the room's worktree
as its cwd, and is handed the room's journal contract. The worker was still a **host** process.
The room diagram says Agent pass, Worktree, VM and session under one station, and the pass was
the one member of that list not in the VM.

What exists to build on, read at this HEAD:

- One VM per room, behind one supervisor. `ensureVmSupervisor`
  (`packages/room/src/VmSupervisor.ts:446`) returns the live supervisor or starts one, records
  it in `.room/<id>/vm.json`, and answers exec requests on `.room/<id>/vm.sock`. A second
  supervisor over one room is refused by the supervisor itself
  (`packages/room/src/vm-supervise.ts`, the `existing.pid !== process.pid` branch).
- The room's checkout is projected into the guest at `/workspace`, read-write
  (`packages/room/src/AgentOs.ts`, `hostDirMount("/workspace", worktree, { readOnly: false })`).
  Everything else the guest runs is its own root filesystem.
- The VM's state directory is the room's own directory: `room vm start` passes
  `roomDir({ root, id })` (`packages/room/src/cli.ts:355`), so `agentos.sqlite` outlives the
  process that booted it.
- The supervisor answers one request at a time (`vm-supervise.ts`, the `pending` chain).

## Decision

1. A pass that resolves a room boot or joins that room's VM **before the receipt is written**
   (`packages/board/src/factory/kernel.ts`, `runPassInner`). A missing or unstartable VM is
   `RoomVmUnavailable`; the pass is not charged and its events stay pending. There is no host
   fallback: a pass that could not enter the room did not run.
2. The room's own supervisor is the guest a pass uses (`supervisorGuest` in
   `packages/board/src/factory/room-vm.ts`): `ensureVmSupervisor` with `roomDir` as the state
   directory, then one `exec` request over the room's socket. No second VM, no second
   supervisor, no CLI verb.
3. The worker crosses as **one command**: the factory's workers are shell commands
   (`scripts/factory-pi-worker.sh`), so the guest runs `sh -c <worker>` with `/workspace` as its
   cwd — the room's checkout — and the worker environment, including the room contract
   (`TACKLE_ROOM_ROOT`, `TACKLE_ROOM_ID`, `TACKLE_ROOM_SESSION`) and `FACTORY_WORKSTREAM`.
4. The guest's exit code is the pass's exit code, so exit `2` still means blocked-on-human and
   the receipt, the budget and the desk item read the same for a pass in a room as for one on
   the host.
5. The receipt records the VM (`vm: { room, socket, pid, started }`). `started` is the fact an
   operator needs: the room owns the VM's lifetime, so a pass that booted one says so and does
   not stop it afterwards.
6. The kernel stays outside the room. What crosses is one command and its answer; the queue,
   the phase, the budget and the landing are still the host's.
7. A bound pass starts no Herdr terminal. The `room=<id>` terminal label belonged to a host
   process the pass no longer is; the room label is on the station's terminal (`room use`), on
   the receipt, and in the worker's own environment. An `intercom:<session>` worker is refused
   in a bound room (`RoomVmHostWorker`) rather than quietly run on the host.

## The two gaps this cut does not close

Both are reported, never approximated. Neither is a reason to fall back to the host.

- **The Pi worker is a host binary.** `scripts/factory-pi-worker.sh` execs `pi`, which is an npm
  install on the host; the guest has Core's vendored bundle, its declared packages, and the
  sidecar's own `node` (ADR 0006), and `pi` is in none of them. A guest shell answers
  `127` (`command not found`) and the pass fails with `RoomVmWorkerGap`, naming the room, its
  declared software and the shell's own message. Closing it needs the Pi runtime published as a
  guest software or template, which is a Core-side declaration this package cannot make up.
- **The room's journal is outside the mount.** `TACKLE_ROOM_SESSION` is
  `<root>/<id>/session.sqlite` (`packages/room/src/RoomSession.ts`), a sibling of the mounted
  worktree, so a worker inside the guest resolves that path in the guest's own filesystem. The
  contract is passed unchanged — the room module writes it, and one contract with two spellings
  would be the second source of truth ADR 0010 refused — so the gap is recorded here until the
  room projects its own directory into the guest (a second `hostDirMount`, plus the snapshot
  guard's answer for it).

## Consequences

- An unbound workstream is exactly what it was: the host worker, the host terminal, its
  `workstream=<id>` label, no VM.
- A bound workstream whose room has no VM boots one with the pass's start; `room vm status`
  then names it as live after the pass ends, which is the room owning it.
- A guest command that outlives `wallMinutesPerPass` fails the pass with `RoomVmTimeout` and
  **may still be running**: the supervisor answers one request at a time, so a stop request
  would queue behind the command it means to stop. The reason says so instead of implying a kill.
- While a pass occupies the room, the supervisor answers nothing else — a `room vm preview` or
  `/presence` probe waits. The room is occupied; that is what the pass is.
- The board's tests replace the guest (`packages/board/test/room-vm.test.ts`) so the kernel's
  routing is asserted without a boot; the room package's own supervisor tests are what prove a
  command really runs in the guest.
