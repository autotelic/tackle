/* oxlint-disable plumb/prefer-property-tests -- fixed served documents; the rendered row and the issued command, not a generated claim, are what these pin. */
import { Locator, Scene } from "@effect/ui/testing"
import { assert, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { BoardView, CreateRoom, type Model, RoomLifecycle } from "../src/main.ts"
import { RoomList } from "../src/rooms.ts"

/**
 * The /rooms document as the board serves it.
 *
 * The room front door reads this one seam: a room the board did not send is not a room the page
 * can draw, and a lifecycle button can only send a verb the board exposed.
 */
const model = (rooms: string): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(RoomList))(
    JSON.stringify({ rooms: JSON.parse(rooms) }),
  )
  if (Result.isFailure(decoded))
    throw new Error("/rooms did not decode: " + String(decoded.failure))
  return {
    route: "rooms",
    presence: null,
    atlas: null,
    error: null,
    loading: false,
    notice: null,
    rooms: decoded.success,
    roomForm: { id: "", repo: "/src/repo", scope: "alpha", base: "main", software: "" },
    roomPending: null,
    roomError: null,
    roomNotice: null,
  }
}

const draw = (rooms: string) =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    const drawn = s.given(model(rooms))
    return { scene: drawn, text: Locator.textOf(drawn.root) }
  })

const alpha = {
  id: "alpha",
  state: "Ready",
  runtime: "agentos",
  branch: "room/alpha-main",
  worktree: "/Users/togmund/.room/alpha/worktree",
  port: 4400,
  socket: "/Users/togmund/.room/alpha/vm.sock",
  session: { path: "/Users/togmund/.room/alpha/session.sqlite", state: "durable" },
  vm: { state: "running", pid: 9001 },
  preview: "/preview/alpha/",
}

it.effect("the room list draws the branch, journal, vm and socket the board served", () =>
  Effect.gen(function* () {
    const { text } = yield* draw(JSON.stringify([alpha]))
    assert.include(text, "alpha")
    assert.include(text, "Ready")
    assert.include(text, "agentos")
    assert.include(text, "branch room/alpha-main")
    assert.include(text, "worktree /Users/togmund/.room/alpha/worktree")
    assert.include(text, "journal durable · /Users/togmund/.room/alpha/session.sqlite")
    assert.include(text, "vm running · pid 9001")
    assert.include(text, "socket /Users/togmund/.room/alpha/vm.sock")
    assert.include(text, "port 4400")
    assert.include(text, "preview /preview/alpha/")
  }),
)

it.effect("a room the board served without a vm or journal says so instead of guessing", () =>
  Effect.gen(function* () {
    const { text } = yield* draw(
      JSON.stringify([{ id: "beta", state: "Paused", session: null, vm: null }]),
    )
    assert.include(text, "beta")
    assert.include(text, "Paused")
    assert.include(text, "no journal")
    assert.include(text, "no vm")
    // No preview route was served, so no link is drawn for one the board cannot answer.
    assert.notInclude(text, "preview ")
  }),
)

it.effect("the nav reaches /rooms and the form offers the five fields", () =>
  Effect.gen(function* () {
    const { scene } = yield* draw(JSON.stringify([alpha]))
    assert.isAbove(scene.all(Locator.attr("href", "/rooms")).length, 0)
    for (const field of ["id", "repo", "scope", "base", "software"])
      assert.isAbove(scene.all(Locator.attr("name", field)).length, 0)
  }),
)

it.effect("a typed field is what the create command posts", () =>
  Effect.gen(function* () {
    const base = model(JSON.stringify([alpha]))
    const s = yield* Scene.make(BoardView, {})
    s.given({ ...base, roomForm: { ...base.roomForm!, id: "" } })
      .fire(Locator.attr("name", "id"), "input", {
        value: "gamma",
        composing: false,
        checked: false,
        files: [],
      })
      .fire(Locator.tag("form"), "submit", { fields: {}, entries: [] })
      .expectExact(
        CreateRoom.make({
          id: "gamma",
          repo: "/src/repo",
          scope: "alpha",
          base: "main",
          software: "",
        }),
      )
  }),
)

it.effect("an empty id is refused before the board is called", () =>
  Effect.gen(function* () {
    const { scene, text } = yield* draw(JSON.stringify([alpha]))
    scene.fire(Locator.tag("form"), "submit", { fields: {}, entries: [] })
    assert.include(Locator.textOf(scene.root), "A new room needs id.")
    // The list is unchanged: a refused form is not a room the page invents.
    assert.notInclude(text, "gamma")
  }),
)

it.effect("a lifecycle button issues that room's verb and shows the wait", () =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    s.given(model(JSON.stringify([alpha])))
      .click("Pause")
      .expectExact(RoomLifecycle.make({ id: "alpha", action: "pause" }))
    assert.include(Locator.textOf(s.root), "pause alpha…")
  }),
)

it.effect("a board that answers with a refusal draws the reason", () =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    const drawn = s.given({
      ...model(JSON.stringify([alpha])),
      rooms: null,
      roomError: "room control is loopback only",
    })
    assert.include(Locator.textOf(drawn.root), "room control is loopback only")
    assert.include(Locator.textOf(drawn.root), "No /rooms document.")
  }),
)
