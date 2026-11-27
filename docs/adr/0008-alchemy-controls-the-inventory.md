# ADR 0008 — Alchemy controls the inventory, the room keeps its record

Status: accepted
Date: 2026-11-30

## Context

`docs/tech-seams.md` §2 records the seam this ADR closes: `packages/board/alchemy.run.ts`
declares the board Worker and, through its Room model, the Durable Object classes that host it —
but no stack declared a _room_. A room exists only because `room new` ran
(`packages/room/src/store.ts:createRoom`), which means the inventory of rooms on a host is
whatever the filesystem says, and a stack cannot plan, place or retire one.

The prior cut of this work (the factory state machine) is deliberately not repeated here. The
factory has exactly one writer (`packages/board/src/factory/kernel.ts`); a room has one record and
a supervisor, not a phase machine. What the inventory needs is that shape, not a port.

## Decision

Two resources live in `packages/board/src/alchemy/Room.ts`, and each maps one-to-one onto an
operation the room package already offers.

1. **`Tackle.Room`** — props `{ id, root, repo, base, scope, software? }`, attributes
   `{ id, root, roomFile, worktree }`.
   - `reconcile` observes first: `readRoom` (`packages/room/src/store.ts`) is the existence
     check, `createRoom` writes the record, and `Worktree.ensure`
     (`packages/room/src/Worktree.ts`) adds the checkout. Returning the attributes is the last
     step, never the whole operation.
   - `read` returns those attributes only when `room.json` decodes, so a room made by
     `room new` is adopted into the stack's state instead of duplicated by it.
   - `delete` is a no-op that logs the retained path, and the resource's
     `defaultRemovalPolicy` is `"retain"`. A room's worktree holds uncommitted work that has no
     copy anywhere else; destroying a stack must not be a way to lose it.
   - A room that exists on a different `base` is a failure, not an update: the store has no
     operation that moves a room to another branch, and a provider that reported success would be
     claiming work it did not do.
2. **`Tackle.RoomMachine`** — props `{ room, root, stateDir }`, attributes
   `{ room, socket, state }`.
   - `reconcile` calls `ensureVmSupervisor`, which starts a supervisor only when none is live
     (`packages/room/src/VmSupervisor.ts`).
   - `read` is `readVmStatus`: a record whose pid answers is the machine, and no record is
     absence, so a plan creates one.
   - `delete` is `stopVmSupervisor` — the supervisor process, with the agentOS sidecar in its
     process group.

**Where the ownership line is.**

| Concern                                                                        | Owner                                       | Evidence                                                               |
| ------------------------------------------------------------------------------ | ------------------------------------------- | ---------------------------------------------------------------------- |
| That a room exists, and which checkout it edits                                | Alchemy (`Tackle.Room`)                     | `packages/board/src/alchemy/Room.ts`                                   |
| The room's record: aggregate state, port lease, software declaration, snapshot | `@autotelic/room`                           | `packages/room/src/store.ts`, `RoomFileSchema`                         |
| The VM supervisor process                                                      | Alchemy (`Tackle.RoomMachine`)              | `startVmSupervisor` / `stopVmSupervisor`                               |
| Guest pids, guest service health, the preview port                             | agentOS, through the VM's own process table | `observeVmService` (`VmSupervisor.ts`), `room.json:runtime.servicePid` |
| Workstreams, candidates, previews, the factory                                 | the factory                                 | `packages/board/src/factory/*`                                         |

**The API is sufficient.** `Resource(type, { defaultRemovalPolicy })` plus `Provider.effect`
(`alchemy@2.0.0-beta.87`, `src/Resource.ts`, `src/Provider.ts`) express this provider without a
fake: the lifecycle methods take props and return attributes, and every one of them calls the
store or the supervisor package. Nothing in the provider invents state — the attributes it returns
are the record the room package wrote. The one requirement it adds is the `Worktree` service,
so a stack decides what a checkout is rather than the provider hard-coding git.

**Deliberately not implemented.**

- **No demo room in `alchemy.run.ts`.** This is a library first. A stack composes
  `Room("alpha", …)` and `RoomMachine(…)`; the board's own stack still declares only the Worker
  and its Durable Objects, so no deploy of this repository mints a room.
- **No room retirement.** `delete` is a no-op by policy. Retiring a room stays `room`'s command.
- **No guest service, preview port or health resource.** Those are observations of the VM, and a
  resource that owned them would be a second authority beside the guest's process table.
- **No port lease, snapshot or move resource.** `leaseRoomPort`, `snapshotRoomVm` and
  `moveRoom` remain room-package operations on the room's own record; they are not inventory.
- **No factory resource.** The six phases in `packages/board/src/factory/store.ts` have one
  writer, so they are a state machine to keep, not an inventory to plan.

## Consequences

- `packages/board/test/alchemy-room-plan.test.ts` builds a two-resource stack and asserts the plan
  names both types and plans the machine after the room.
- `packages/board/test/alchemy-room-apply.test.ts` applies the same providers against a scratch
  git repository: `Room` creates `room.json` and `alpha/worktree`, and `RoomMachine` starts the
  supervisor and reports `running`. The test stops the supervisor and removes the scratch root.
  The worktree is created before the room record, which is the order git requires.
- A stack destroy leaves every room and every worktree where it was, and says so once per room.
- `Tackle.RoomMachine` reads a file on every plan. That is intentional — a cached "running" is the
  one answer a supervisor can silently falsify.
- If a later cut wants a room's VM disk or its preview port as a resource, it declares a new type
  and a new provider; it does not widen these two.
