/* oxlint-disable plumb/prefer-property-tests -- one fixed atlas document; the rendered route, not a generated claim, is what this pins. */
import { Locator, Scene } from "@effect/ui/testing"
import { assert, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { Atlas } from "../src/atlas.ts"
import { BoardView, type Model } from "../src/main.ts"

const served = JSON.stringify({
  generatedAt: "2026-11-23T01:00:00.000Z",
  workspace: ".",
  packages: [
    {
      name: "@autotelic/protocol",
      version: "0.1.1",
      path: "packages/protocol",
      description: "The seam.",
      private: false,
      scripts: ["build", "test"],
      workspaceDependencies: [],
      summary: "The formats every tool agrees on.",
    },
    {
      name: "@autotelic/board",
      version: "0.0.0",
      path: "packages/board",
      private: true,
      scripts: ["build"],
      workspaceDependencies: ["@autotelic/protocol"],
      summary: null,
    },
  ],
  edges: [{ from: "@autotelic/board", to: "@autotelic/protocol" }],
})

const model = (): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Atlas))(served)
  if (Result.isFailure(decoded)) throw new Error("atlas did not decode")
  return {
    route: "tackle",
    presence: null,
    atlas: decoded.success,
    error: null,
    loading: false,
    notice: null,
  }
}

/**
 * Start the view from a served document.
 *
 * `given` replaces what `init` produced, the route's fetch included, so a test reads the
 * rendered page without a request.
 */
const scene = (given: Model) =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    return s.given(given)
  })

it.effect("the tackle route draws every package and its workspace edges", () =>
  Effect.gen(function* () {
    const s = yield* scene(model())
    const text = Locator.textOf(s.root)
    assert.include(text, "Tackle")
    assert.include(text, "protocol")
    assert.include(text, "board")
    assert.include(text, "2 packages")
    assert.include(text, "depends on")
    assert.include(text, "used by")
  }),
)
