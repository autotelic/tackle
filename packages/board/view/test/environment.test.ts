/* oxlint-disable plumb/prefer-property-tests -- four fixed served documents; the rendered line, not a generated claim, is what these pin. */
import { Locator, Scene } from "@effect/ui/testing"
import { assert, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { BoardView, type Model } from "../src/main.ts"
import { Presence } from "../src/presence.ts"

/**
 * The served document as text.
 *
 * The seam is bytes: the board writes JSON and the view decodes it, so these cases start from
 * the document the board serves and read the card the view renders from it.
 */
const served = (environments?: string): string => {
  const workstream = JSON.stringify({
    id: "shakti-perms",
    project: "factory",
    label: "shakti-perms",
    phase: "build",
    path: "/Users/togmund/autotelic/shakti-perms",
    checkpoint: { sha: "0".repeat(40), at: "2026-11-22T10:00:00.000Z" },
  })
  const factory =
    '{"workstreams":[' +
    workstream +
    '],"activity":[],"desk":[],"reports":[]' +
    (environments === undefined ? "" : ',"environments":' + environments) +
    "}"
  return (
    '{"factory":' +
    factory +
    ',"sessions":{"herdr":{"available":false,"sessions":[]},"rex":{"available":false,"sessions":[]}}}'
  )
}

const model = (environments?: string): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Presence))(served(environments))
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

const environment = JSON.stringify({
  workstream: "shakti-perms",
  machine: { host: "macbook-pro", dnsName: "macbook-pro.tailbd1623.ts.net" },
  runtime: { kind: "worktree", path: "/Users/togmund/autotelic/shakti-perms" },
  port: { room: "shakti-perms-dev", number: 4400, leasedAt: "2026-11-22T11:00:00.000Z" },
  services: [],
  agent: { session: "t19", status: "working" },
  preview: null,
  observedAt: "2026-11-22T12:00:00.000Z",
})

/**
 * Render the card for one served document and return it.
 *
 * The bytes are the assertion surface: a line the projection did not send has to be absent from
 * the page, not merely null in a model the view could have filled in.
 */
const draw = (environments?: string) =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    const drawn = s.given(model(environments))
    return { scene: drawn, text: Locator.textOf(drawn.root) }
  })

it.effect("the card draws the served machine, runtime and agent", () =>
  Effect.gen(function* () {
    const { text } = yield* draw("[" + environment + "]")
    assert.include(text, "Environment")
    assert.include(text, "machine macbook-pro")
    assert.include(text, "worktree /Users/togmund/autotelic/shakti-perms")
    assert.include(text, "port 4400")
    assert.include(text, "agent t19 · working")
  }),
)

it.effect("an environment with no leased port draws no port", () =>
  Effect.gen(function* () {
    const nullPort = JSON.stringify({ ...JSON.parse(environment), port: null })
    const { port: _port, ...withoutPort } = JSON.parse(environment)
    for (const served of ["[" + nullPort + "]", "[" + JSON.stringify(withoutPort) + "]"]) {
      const { text } = yield* draw(served)
      assert.include(text, "Environment")
      assert.notInclude(text, "port ")
    }
  }),
)

it.effect("a board that serves no environments draws no Environment line", () =>
  Effect.gen(function* () {
    const { text } = yield* draw()
    assert.notInclude(text, "Environment")
    assert.notInclude(text, "environment")
  }),
)

it.effect("a half-served environment draws no Environment line", () =>
  Effect.gen(function* () {
    const { text } = yield* draw('[{"workstream":"shakti-perms"}]')
    assert.notInclude(text, "Environment")
  }),
)

it.effect("a served service draws the status the board observed", () =>
  Effect.gen(function* () {
    const withService = JSON.stringify({
      ...JSON.parse(environment),
      services: [
        {
          name: "web",
          command: "pnpm dev",
          port: 4400,
          healthPath: "/healthz",
          status: "unhealthy",
          detail: "HTTP 503",
          checkedAt: "2026-11-22T12:00:00.000Z",
        },
      ],
    })
    const { text } = yield* draw("[" + withService + "]")
    assert.include(text, "service web unhealthy")
    // The card repeats the observed word; it never upgrades one to a health nobody saw.
    assert.notMatch(text, /service web healthy/u)
  }),
)

it.effect("an empty service list draws no service", () =>
  Effect.gen(function* () {
    const { text } = yield* draw("[" + environment + "]")
    assert.notInclude(text, "service ")
  }),
)

it.effect("a served preview draws a link to the board's route", () =>
  Effect.gen(function* () {
    const withPreview = JSON.stringify({
      ...JSON.parse(environment),
      preview: "/preview/shakti-perms/",
    })
    const { scene, text } = yield* draw("[" + withPreview + "]")
    assert.include(text, "preview /preview/shakti-perms/")
    assert.isDefined(scene.query(Locator.attr("href", "/preview/shakti-perms/")))
  }),
)

it.effect("a null preview draws no link", () =>
  Effect.gen(function* () {
    const { text } = yield* draw("[" + environment + "]")
    assert.notInclude(text, "preview ")
  }),
)

it.effect("an agent with no status names only its session", () =>
  Effect.gen(function* () {
    const statusless = JSON.stringify({
      ...JSON.parse(environment),
      agent: { session: "t19", status: "" },
    })
    const { text } = yield* draw("[" + statusless + "]")
    assert.include(text, "agent t19")
    assert.notInclude(text, "agent t19 ·")
  }),
)
