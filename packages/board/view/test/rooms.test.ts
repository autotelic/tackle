/* oxlint-disable plumb/prefer-property-tests -- two fixed served documents; the rendered row, not a generated claim, is what these pin. */
import { Locator, Scene } from "@effect/ui/testing"
import { assert, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { BoardView, type Model } from "../src/main.ts"
import { Presence } from "../src/presence.ts"

const served = (rooms?: string): string =>
  JSON.stringify({
    ...(rooms === undefined ? {} : { rooms: JSON.parse(rooms) }),
    factory: { workstreams: [], activity: [], desk: [], reports: [] },
    sessions: {
      herdr: { available: false, sessions: [] },
      rex: { available: false, sessions: [] },
    },
  })

const model = (rooms?: string): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Presence))(served(rooms))
  if (Result.isFailure(decoded))
    throw new Error("presence did not decode: " + String(decoded.failure))
  return {
    route: "factory",
    presence: decoded.success,
    atlas: null,
    error: null,
    loading: false,
    notice: null,
  }
}

const draw = (rooms?: string) =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    const drawn = s.given(model(rooms))
    return { scene: drawn, text: Locator.textOf(drawn.root) }
  })

it.effect("the room inventory draws the record and the process it owns", () =>
  Effect.gen(function* () {
    const { text } = yield* draw(
      JSON.stringify([
        {
          id: "alpha",
          state: "Ready",
          runtime: "agentos",
          process: { pid: 4242, alive: true, exec: "pnpm dev" },
          vm: { state: "running", pid: 9001 },
        },
        { id: "beta", state: "Paused", process: null },
      ]),
    )
    assert.include(text, "Room inventory")
    assert.include(text, "alpha")
    assert.include(text, "Ready")
    assert.include(text, "vm running · pid 9001")
    assert.include(text, "process 4242 · alive · pnpm dev")
    assert.include(text, "1 supervisor running")
    assert.include(text, "beta")
    assert.include(text, "no process")
  }),
)

it.effect("a board that serves no rooms draws no inventory section", () =>
  Effect.gen(function* () {
    const { text } = yield* draw()
    assert.notInclude(text, "Room inventory")
  }),
)
