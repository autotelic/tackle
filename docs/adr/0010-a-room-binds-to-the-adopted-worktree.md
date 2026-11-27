# ADR 0010 — a room binds to the adopted worktree, and the binding may not move it

Status: accepted
Date: 2026-11-27

## Context

A workstream record knows one worktree: `path`, captured by `factory adopt` and, by
`docs/workstream.md:19`, "adopted, never moved or rewritten". Invariant 2 repeats it: "Adoption
is a state transition: the worktree path never changes" (`docs/workstream.md` §2). The
collision lookup compares paths by realpath, not string equality
(`packages/board/src/factory/store.ts`, `ownerOfPath`/`canonicalPath`), so two records cannot
name one checkout through different spellings.

A room has a worktree of its own: `<root>/<id>/worktree` (`packages/room/src/store.ts`,
`roomDir`; the same join was written by hand in `packages/room/src/cli.ts` for `new`, `vm`
and `resume` before `roomWorktree`). When a room is created over an existing checkout,
`room new --worktree` symlinks that directory rather than moving it. So a room's worktree
path and a workstream's adopted path can be the same directory, two names for it, or two
different checkouts — and nothing in either record said which.

`factory adopt --room <id> --room-root <path>` was asked to add the binding. The one failure
worth refusing to guess at is a binding that resolves somewhere other than `record.path`: use
the room's directory and `path` becomes decorative; silently keep `path` and the binding
becomes decorative. There is no third option that keeps one source of truth.

## Decision

1. A workstream gains an optional `room: { id, root }` (`packages/board/src/factory/store.ts`,
   `RoomBinding`). A record without the field decodes unchanged, and unbound workstreams keep
   the behaviour they had.
2. `path` stays the single source of the worktree. The binding is a **reference that must
   resolve to it**. `resolveRoom` (`packages/board/src/factory/room-binding.ts`) compares
   `roomWorktree({ root, id })` against the adopted path by realpath and refuses
   `RoomMismatch` naming both, rather than choosing one.
3. `adopt` resolves the binding while the operator is present and refuses `RoomMissing`,
   `RoomWorktreeMissing` and `RoomMismatch` as its own `room` step.
4. A pass resolves it again, before the receipt is written, so a room removed or renamed after
   adoption refuses the pass (`RoomMissing`) and charges nothing — the events stay pending for
   whoever fixes the room. There is no fallback to `record.path`.
5. The worker's cwd is the resolved room worktree, and its environment carries
   `TACKLE_ROOM_ROOT`, `TACKLE_ROOM_ID` and `TACKLE_ROOM_SESSION` from the room module
   (`roomSessionEnvironment` + `roomSessionEnv` in `packages/room/src/RoomSession.ts`), not a
   hand-written copy. A worker therefore opens the journal the control plane checkpoints with
   `openRoomSessionFromEnvironment()`.
6. A Herdr terminal started for the pass carries `room=<id>` beside `workstream=<id>`, so the
   station (`room use`) and the pass join on the same label.
7. The kernel stays the scheduler. It starts no VM and no room service in this cut; the pass is
   the room's occupant, not its supervisor.

## Consequences

- A workstream adopted with no room is exactly what it was; the field is optional in the
  schema and absent from its file.
- Rebinding a bound workstream to a different room is refused unless that room's worktree is
  the same directory, which is the invariant working as written. Moving a room to another root
  is a room `move` (not implemented — `room move` refuses) plus a rebind; until then the old
  root is the one the record names, and a pass under the old path refuses rather than guessing.
- `writeWorkstream` treats `room` as an operator control beside `budgets` and `desk`: a pass
  that started before a rebind merges the current binding back instead of clobbering it.
- The room package now exports `roomWorktree`, and its own three joins call it; a consumer
  outside the package cannot spell the worktree differently from the package that creates it.
