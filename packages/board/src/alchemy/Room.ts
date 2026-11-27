import * as Alchemy from "alchemy"
import * as Provider from "alchemy/Provider"
import * as Data from "effect/Data"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { join, resolve } from "node:path"
import { createRoom, readRoom, roomDir, roomFile } from "@autotelic/room/store"
import type { RoomSoftware } from "@autotelic/room/VmSoftware"
import {
  ensureVmSupervisor,
  readVmStatus,
  stopVmSupervisor,
  type VmState,
} from "@autotelic/room/VmSupervisor"
import { Worktree } from "@autotelic/room/Worktree"

/*
 * The room inventory, as a stack declares it.
 *
 * The seam is ownership, not convenience. Alchemy owns the *declaration* — that a room exists,
 * where its checkout lives, which supervisor is running for it — and the room's own store owns
 * the *record*: `room.json`, its aggregate state, its port lease, its software declaration and
 * its snapshot. Every lifecycle operation here is a call into `@autotelic/room`; not one of them
 * re-implements a room. That is what keeps a stack and `room new` from becoming two answers to
 * one question.
 *
 * Deliberately not owned: guest pids, guest service health, preview ports and the factory. A pid
 * belongs to the VM's process table (see `observeVmService`), and a factory is a workstream, not
 * a machine — see docs/adr/0008-alchemy-controls-the-inventory.md.
 */

/** One resource's own failure; `message` is what a plan or an apply prints. */
export class RoomResourceError extends Data.TaggedError("RoomResourceError")<{
  readonly message: string
}> {}

/** Both resources fail the same way: the room package answered a refusal, not an exception. */
const attempt = <A>(thunk: () => Promise<A>) =>
  Effect.tryPromise({
    try: thunk,
    catch: (cause) => new RoomResourceError({ message: String(cause) }),
  })

/** Where a room's declaration and worktree live: its own directory under the host root. */
const roomPaths = (input: { readonly root: string; readonly id: string }) => {
  const dir = resolve(roomDir({ root: input.root, id: input.id }))
  return {
    root: input.root,
    id: input.id,
    dir,
    // The checkout is the room directory's child, not the room directory itself: the record
    // (room.json, agentos.sqlite) and the worktree share a parent and must not overwrite each
    // other. `room new` places it here; the provider follows the same convention.
    worktree: join(dir, "worktree"),
    file: roomFile({ root: input.root, id: input.id }),
  }
}

export interface RoomProps {
  readonly id: string
  /** The directory every room on this host lives under; this room's own directory is `root/id`. */
  readonly root: string
  /** The git repository the room's checkout is added from. */
  readonly repo: string
  /** The branch the checkout starts at. A room on an existing branch starts here too. */
  readonly base: string
  readonly scope: string
  /** The guest software the room declares; absent writes the store's default declaration. */
  readonly software?: RoomSoftware
  /**
   * A running board's control URL. When present, this provider composes through board's room
   * lifecycle instead of calling the store and worktree in-process.
   */
  readonly board?: string
}

interface BoardRoom {
  readonly id: string
  readonly state: string
  readonly runtime?: string
  readonly socket?: string
  readonly vm?: { readonly state: string; readonly pid?: number }
}

const controlUrl = (base: string, path: string): string =>
  new URL(path, base.endsWith("/") ? base : base + "/").toString()

const boardRooms = async (base: string): Promise<ReadonlyArray<BoardRoom>> => {
  const response = await fetch(controlUrl(base, "rooms"))
  if (!response.ok) throw new Error("board GET /rooms answered " + response.status)
  const body = (await response.json()) as { readonly rooms?: ReadonlyArray<BoardRoom> }
  return body.rooms ?? []
}

const boardRoom = async (base: string, id: string): Promise<BoardRoom | undefined> =>
  (await boardRooms(base)).find((entry) => entry.id === id)

export interface RoomAttributes {
  readonly id: string
  readonly root: string
  readonly roomFile: string
  readonly worktree: string
}

export type RoomResource = Alchemy.Resource<"Tackle.Room", RoomProps, RoomAttributes>

/**
 * One room: its record in the store and its git worktree.
 *
 * Retained by default. A room's bytes are the room — an uncommitted edit in its worktree has no
 * copy anywhere else — so a stack destroy must not take one with it. `delete` is therefore a
 * no-op that says so, and retiring a room stays an operator's command.
 */
export const Room = Alchemy.Resource<RoomResource>("Tackle.Room", {
  defaultRemovalPolicy: "retain",
})

export interface RoomMachineProps {
  /** The room whose VM this is: the id the room package addresses it by. */
  readonly room: string
  /** The room root the supervisor resolves the room's directory under. */
  readonly root: string
  /** Where the VM's own disk (`agentos.sqlite`) lives; the room's directory by convention. */
  readonly stateDir: string
  /** A running board's control URL; when present, start/stop through it. */
  readonly board?: string
}

export interface RoomMachineAttributes {
  readonly room: string
  readonly socket: string
  readonly state: VmState
}

export type RoomMachineResource = Alchemy.Resource<
  "Tackle.RoomMachine",
  RoomMachineProps,
  RoomMachineAttributes
>

/**
 * One room's VM supervisor: the detached process that owns an agentOS instance.
 *
 * The resource is the *process*, not the guest. It starts and stops a supervisor and reports the
 * state the room package read from the record; it does not own guest service pids, health paths
 * or a preview port, because the VM's own process table is the authority for those.
 */
export const RoomMachine = Alchemy.Resource<RoomMachineResource>("Tackle.RoomMachine")

/** A room's attributes, derived from its props: the record is the room package's to write. */
const roomAttributes = (props: RoomProps): RoomAttributes => {
  const paths = roomPaths({ root: props.root, id: props.id })
  return { id: props.id, root: props.root, roomFile: paths.file, worktree: paths.worktree }
}

/**
 * The Room provider.
 *
 * `reconcile` observes first: an existing room file is the room, so a second deploy adds no
 * second record. A room file that names a different base is a refusal rather than an update —
 * the store has no operation that moves a room to another branch, and claiming one here would
 * be the provider pretending to do work the room package does not offer.
 */
export const RoomProvider = () =>
  Provider.effect(
    Room,
    Effect.gen(function* () {
      const worktree = yield* Worktree
      return {
        list: () => Effect.succeed([]),
        // A plan calls `read` only when the declared props are resolved, and it passes those
        // props as `olds`: there is no row yet, so nothing else could be observed.
        read: Effect.fn(function* ({ olds }: { readonly olds: RoomProps }) {
          if (olds.board !== undefined) {
            const found = yield* attempt(() => boardRoom(olds.board!, olds.id))
            return found === undefined ? undefined : roomAttributes(olds)
          }
          const observed = yield* attempt(() => readRoom({ root: olds.root, id: olds.id }))
          return observed === undefined ? undefined : roomAttributes(olds)
        }),
        reconcile: Effect.fn(function* ({ news }: { readonly news: RoomProps }) {
          if (news.board !== undefined) {
            const found = yield* attempt(() => boardRoom(news.board!, news.id))
            if (found === undefined) {
              const response = yield* attempt(() =>
                fetch(controlUrl(news.board!, "rooms"), {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    id: news.id,
                    repo: news.repo,
                    scope: news.scope,
                    base: news.base,
                  }),
                }),
              )
              if (!response.ok) {
                const text = yield* attempt(() => response.text())
                return yield* Effect.fail(
                  new RoomResourceError({
                    message: "board POST /rooms answered " + response.status + ": " + text,
                  }),
                )
              }
            }
            return roomAttributes(news)
          }
          const paths = roomPaths({ root: news.root, id: news.id })
          const observed = yield* attempt(() => readRoom({ root: news.root, id: news.id }))
          // The worktree comes first, exactly as the CLI does: git refuses a worktree whose
          // target exists, and `createRoom` writes the room directory. Reversing these two
          // makes every new room fail with "already exists".
          const checkout = yield* worktree.ensure({
            root: paths.worktree,
            repo: news.repo,
            base: news.base,
          })
          if (observed === undefined) {
            const created = yield* attempt(() =>
              createRoom({
                root: news.root,
                id: news.id,
                repo: news.repo,
                scope: news.scope,
                base: news.base,
                at: Date.now(),
                software: news.software,
              }),
            )
            // `RoomAlreadyExists` is the store's answer to the one race this reconcile has: a
            // writer created the room between the read and the create. That is the state this
            // operation wanted, so the refusal is the success.
            if (!created.ok && created.error !== "RoomAlreadyExists")
              return yield* Effect.fail(
                new RoomResourceError({
                  message: `room ${news.id} was not created: ${created.error}`,
                }),
              )
          } else if (observed.base !== news.base) {
            return yield* Effect.fail(
              new RoomResourceError({
                message:
                  `room ${news.id} is on ${observed.base}, not ${news.base}` +
                  "; a room's base branch is fixed when it is created",
              }),
            )
          }
          return { id: news.id, root: news.root, roomFile: paths.file, worktree: checkout }
        }),
        delete: Effect.fn(function* ({
          id,
          output,
        }: {
          readonly id: string
          readonly output: RoomAttributes
        }) {
          yield* Effect.logInfo(
            `Tackle.Room ${id}: retained at ${output.worktree}; delete is a no-op`,
          )
        }),
      }
    }),
  )

/**
 * The RoomMachine provider.
 *
 * `read` is the only operation that runs before an apply, and it only looks: `readVmStatus`
 * reads a record and checks whether its pid answers. A machine with no record is absent, so the
 * plan creates one; a live or stale record is the machine, so the plan leaves it alone.
 */
export const RoomMachineProvider = () =>
  Provider.effect(
    RoomMachine,
    Effect.succeed({
      list: () => Effect.succeed([]),
      read: Effect.fn(function* ({ olds }: { readonly olds: RoomMachineProps }) {
        if (olds.board !== undefined) {
          const found = yield* attempt(() => boardRoom(olds.board!, olds.room))
          if (found?.vm === undefined || found.vm.state === "absent") return undefined
          return { room: olds.room, socket: found.socket ?? "", state: found.vm.state as VmState }
        }
        const status = yield* attempt(() => readVmStatus({ root: olds.root, id: olds.room }))
        if (status.run === undefined) return undefined
        return { room: olds.room, socket: status.run.socket, state: status.state }
      }),
      reconcile: Effect.fn(function* ({ news }: { readonly news: RoomMachineProps }) {
        if (news.board !== undefined) {
          const response = yield* attempt(() =>
            fetch(controlUrl(news.board!, "rooms/" + encodeURIComponent(news.room) + "/up"), {
              method: "POST",
            }),
          )
          if (!response.ok) {
            const text = yield* attempt(() => response.text())
            return yield* Effect.fail(
              new RoomResourceError({
                message: "board room up answered " + response.status + ": " + text,
              }),
            )
          }
          const found = yield* attempt(() => boardRoom(news.board!, news.room))
          return {
            room: news.room,
            socket: found?.socket ?? "",
            state: (found?.vm?.state ?? "absent") as VmState,
          }
        }
        const paths = roomPaths({ root: news.root, id: news.room })
        const started = yield* attempt(() =>
          ensureVmSupervisor({
            root: news.root,
            id: news.room,
            worktree: paths.worktree,
            stateDir: news.stateDir,
          }),
        )
        if (!started.ok)
          return yield* Effect.fail(
            new RoomResourceError({
              message: `room ${news.room} has no vm: ${started.reason}`,
            }),
          )
        return { room: news.room, socket: started.run.socket, state: "running" as const }
      }),
      // `delete` receives the previous props as `olds`, not the reconcile's `news`.
      delete: Effect.fn(function* ({ olds }: { readonly olds: RoomMachineProps }) {
        if (olds.board !== undefined) {
          const response = yield* attempt(() =>
            fetch(controlUrl(olds.board!, "rooms/" + encodeURIComponent(olds.room) + "/down"), {
              method: "POST",
            }),
          )
          if (!response.ok) {
            const text = yield* attempt(() => response.text())
            return yield* Effect.fail(
              new RoomResourceError({
                message: "board room down answered " + response.status + ": " + text,
              }),
            )
          }
          return
        }
        const stopped = yield* attempt(() => stopVmSupervisor({ root: olds.root, id: olds.room }))
        yield* Effect.logInfo(
          `Tackle.RoomMachine ${olds.room}: ${stopped.detail} (pid ${String(stopped.pid ?? "none")})`,
        )
      }),
    }),
  )

/**
 * Both room providers, for a stack that composes rooms.
 *
 * The worktree service is a requirement rather than an argument so a stack decides what a checkout
 * is: `WorktreeLive` here, and nothing else in the provider knows how git is invoked.
 */
export const roomProviders = () => Layer.mergeAll(RoomProvider(), RoomMachineProvider())
