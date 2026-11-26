/* oxlint-disable plumb/prefer-property-tests -- four fixed served documents; the rendered line, not a generated claim, is what these pin. */
import { Locator, Scene } from "@effect/ui/testing"
import { assert, it } from "@effect/vitest"
import { Effect, Result, Schema } from "effect"
import { BoardView, type Model } from "../src/main.ts"
import { Fleet, Presence } from "../src/presence.ts"

/**
 * The served document as text.
 *
 * The seam is bytes: the board writes JSON and the view decodes it, so these cases start from
 * the document the board serves and read the card the view renders from it.
 */
const served = (environments?: string, candidates?: string): string => {
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
    (candidates === undefined ? "" : ',"candidates":' + candidates) +
    "}"
  return (
    '{"factory":' +
    factory +
    ',"sessions":{"herdr":{"available":false,"sessions":[]},"rex":{"available":false,"sessions":[]}}}'
  )
}

const model = (environments?: string, candidates?: string): Model => {
  const decoded = Schema.decodeResult(Schema.fromJsonString(Presence))(
    served(environments, candidates),
  )
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
const draw = (environments?: string, candidates?: string) =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    const drawn = s.given(model(environments, candidates))
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
    // The route is drawn on the workstream card and again in the floor summary; both are the
    // same stable board path, so the assertion is that it is present, not that it is unique.
    assert.isAbove(scene.all(Locator.attr("href", "/preview/shakti-perms/")).length, 0)
  }),
)

it.effect("a null preview draws no link", () =>
  Effect.gen(function* () {
    const { text } = yield* draw("[" + environment + "]")
    assert.notInclude(text, "preview ")
  }),
)

/** One candidate lane as the board serves it, with the fields the card draws. */
const lane = {
  workstream: "shakti-perms",
  id: "shakti-perms-spike",
  room: "shakti-perms-spike",
  path: "/Users/togmund/autotelic/.room/shakti-perms-spike/worktree",
  branch: "candidate/shakti-perms/spike",
  head: "1".repeat(40),
  label: "spike",
  state: "open",
  runtime: { kind: "worktree", path: "/Users/togmund/autotelic/.room/shakti-perms-spike/worktree" },
  port: null,
  vmPort: null,
  services: [],
  preview: null,
  observedAt: "2026-11-22T12:00:00.000Z",
}

/**
 * Render the factory floor for one served /fleet document.
 *
 * /fleet is its own document because fleet asks peers for their presence, so these cases start
 * from the bytes the board's fleet merge writes and never from a folded model.
 */
const drawFleet = (fleet: string) =>
  Effect.gen(function* () {
    const s = yield* Scene.make(BoardView, {})
    const decoded = Schema.decodeResult(Schema.fromJsonString(Fleet))(fleet)
    if (Result.isFailure(decoded))
      throw new Error("fleet did not decode: " + String(decoded.failure))
    const drawn = s.given({ ...model(), fleet: decoded.success })
    return { scene: drawn, text: Locator.textOf(drawn.root) }
  })

it.effect("a peer's environment is drawn with its own service and preview", () =>
  Effect.gen(function* () {
    const { text } = yield* drawFleet(
      JSON.stringify({
        observedAt: "2026-11-22T12:00:00.000Z",
        hosts: [{ host: "studio-mac", online: true, self: false, ok: true }],
        environments: [
          {
            host: "studio-mac",
            workstream: "shakti-perms",
            runtime: { kind: "worktree", path: "/Users/togmund/autotelic/shakti-perms" },
            services: [{ name: "web", status: "healthy" }],
            preview: "/preview/shakti-perms/",
          },
        ],
      }),
    )
    assert.include(text, "Peers")
    assert.include(text, "studio-mac · shakti-perms")
    assert.include(text, "service web healthy")
    assert.include(text, "preview /preview/shakti-perms/")
  }),
)

it.effect("a peer that did not answer is drawn with its reason, never an empty machine", () =>
  Effect.gen(function* () {
    const { text } = yield* drawFleet(
      JSON.stringify({
        hosts: [{ host: "studio-mac", online: true, self: false, ok: false, error: "offline" }],
        environments: [],
      }),
    )
    assert.include(text, "studio-mac")
    assert.include(text, "offline")
  }),
)

it.effect("a board that serves no fleet draws no Peers section", () =>
  Effect.gen(function* () {
    const { text } = yield* draw()
    assert.notInclude(text, "Peers")
  }),
)

it.effect("two open candidates are two separate rows on the card", () =>
  Effect.gen(function* () {
    const second = { ...lane, id: "shakti-perms-probe", label: "probe", room: "shakti-perms-probe" }
    const { text } = yield* draw(
      undefined,
      "[" + JSON.stringify(lane) + "," + JSON.stringify(second) + "]",
    )
    assert.include(text, "Candidates")
    assert.include(text, "spike")
    assert.include(text, "probe")
    // Two lanes, two state words: the card never folds them into one count.
    assert.isAtLeast(text.split("open").length - 1, 2)
  }),
)

it.effect("a dropped candidate folds into one line and offers no route", () =>
  Effect.gen(function* () {
    const dropped = {
      ...lane,
      id: "shakti-perms-old",
      label: "old",
      state: "dropped",
      preview: "/preview/shakti-perms-old/",
    }
    const { text } = yield* draw(undefined, "[" + JSON.stringify(dropped) + "]")
    assert.include(text, "dropped lane")
    assert.include(text, "old")
    // A dropped lane is folded, so its route is not drawn even if the board sent one.
    assert.notInclude(text, "preview")
  }),
)

it.effect("a board that serves no candidates draws no Candidates line", () =>
  Effect.gen(function* () {
    const { text } = yield* draw("[" + environment + "]")
    assert.notInclude(text, "Candidates")
  }),
)

it.effect("a half-served candidate draws its state and invents nothing", () =>
  Effect.gen(function* () {
    const { text } = yield* draw(
      undefined,
      '[{"workstream":"shakti-perms","id":"shakti-perms-spike","state":"open"}]',
    )
    assert.include(text, "Candidates")
    assert.include(text, "open")
    assert.notInclude(text, "preview")
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
