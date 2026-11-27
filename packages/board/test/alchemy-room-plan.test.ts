import { WorktreeLive } from "@autotelic/room/Worktree"
import * as Alchemy from "alchemy"
import * as Alchemist from "alchemy/Alchemist"
import * as Effect from "effect/Effect"
import * as Layer from "effect/Layer"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect, test } from "vitest"
import { Room, RoomMachine, roomProviders } from "../src/alchemy/Room.ts"

/**
 * A room root that does not exist. A plan reads a room's record and a machine's supervisor record
 * to decide what it would create, so the paths must be real enough to read and empty enough that a
 * left-over file cannot change the answer. Nothing here writes: the test plans, it never applies.
 */
const root = join(tmpdir(), "tackle-room-inventory-plan", "rooms")

/**
 * The smallest stack that composes a room: one room, one machine for it. The machine names the
 * room's own file, so the dependency is the same one an operator's stack declares — a machine
 * cannot be planned before the room that gives it a checkout exists.
 */
const stack = Alchemy.Stack(
  "room-inventory",
  {
    providers: roomProviders().pipe(Layer.provide(WorktreeLive)),
    state: Alchemy.inMemoryState(),
  },
  Effect.gen(function* () {
    const room = yield* Room("alpha", {
      id: "alpha",
      root,
      repo: "/tmp/room-inventory-repo",
      base: "main",
      scope: "alpha",
    })
    const machine = yield* RoomMachine("alpha-vm", {
      room: room.id,
      root,
      stateDir: join(root, "alpha"),
    })
    return { room: room.roomFile, machine: machine.socket }
  }),
)

/**
 * The inventory is a claim about a plan, not about a test's mock. Both resources are read from the
 * same plan an operator would approve, and the edge between them is the plan's own downstream
 * list — the engine's answer, not a second derivation of the source.
 */
test("the plan names the room and its machine, and plans the machine after the room", async () => {
  const plan = await Effect.runPromise(
    Effect.scoped(Alchemist.plan({ stack, operation: "deploy", stage: "test" })).pipe(
      Effect.provide(Alchemist.layer()),
    ),
  )

  const nodes = Object.values(plan.native.resources)
  const room = nodes.find((node) => node.resource.Type === "Tackle.Room")
  const machine = nodes.find((node) => node.resource.Type === "Tackle.RoomMachine")

  expect(room, "the plan names the room").toBeDefined()
  expect(machine, "the plan names the room's machine").toBeDefined()
  expect(machine?.downstream, "the machine is not planned before its room").not.toContain(
    room?.resource.FQN,
  )
  expect(room?.downstream, "the machine depends on the room").toContain(machine?.resource.FQN)
})
