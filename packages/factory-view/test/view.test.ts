/* oxlint-disable plumb/prefer-property-tests -- this suite renders one fixed presence document per claim. */
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import type { Html } from "foldkit/html"
import { describe, expect, it } from "vitest"
import { update, view, type Message, type Model } from "../src/main.ts"
import {
  ago,
  activityFor,
  checkpoint,
  HOUR,
  MINUTE,
  modelOf,
  pass,
  ship,
  workstreamOf,
} from "./fixtures.ts"

type Node = Exclude<Html, null>

const render = (model: Model): Node => {
  let rendered: Node | undefined
  Scene.scene(
    { update, view },
    Scene.given(model),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      rendered = simulation.html
      return simulation
    },
  )
  if (rendered === undefined) throw new Error("the view rendered nothing")
  return rendered
}

const attrOf = (node: Node, name: string): string =>
  Option.getOrElse(Scene.attr(node, name), () => "")

const offsets = (html: Node, selector: string): ReadonlyArray<number> =>
  Scene.findAll(html, selector).map((node) => {
    const match = /left:\s*([\d.]+)%/.exec(attrOf(node, "style"))
    if (match?.[1] === undefined) throw new Error("no left offset on " + selector)
    return Number(match[1])
  })

const required = (html: Node, selector: string): Node => {
  const found = Scene.find(html, selector)
  if (Option.isNone(found)) throw new Error("missing " + selector)
  return found.value
}

describe("time strip", () => {
  it("shows a healthy workstream at the right edge and a stalled one hours behind", () => {
    const healthy = workstreamOf({ id: "healthy", checkpointAt: ago(4 * MINUTE), sha: "h4" })
    const stalled = workstreamOf({ id: "stalled", checkpointAt: ago(6 * HOUR), sha: "s3" })
    const html = render(
      modelOf({
        observedAt: ago(0),
        workstreams: [healthy, stalled],
        activities: [
          activityFor({
            workstream: "healthy",
            lastPassAt: ago(5 * MINUTE),
            events: [
              pass({ at: ago(35 * MINUTE), pass: 1, status: "done", endedAt: ago(33 * MINUTE) }),
              checkpoint({ at: ago(33 * MINUTE), sha: "h1" }),
              pass({ at: ago(25 * MINUTE), pass: 2, status: "done", endedAt: ago(23 * MINUTE) }),
              checkpoint({ at: ago(23 * MINUTE), sha: "h2" }),
              pass({ at: ago(15 * MINUTE), pass: 3, status: "done", endedAt: ago(13 * MINUTE) }),
              pass({ at: ago(5 * MINUTE), pass: 4, status: "done", endedAt: ago(4 * MINUTE) }),
            ],
          }),
          activityFor({
            workstream: "stalled",
            lastPassAt: ago(6 * HOUR),
            events: [
              pass({
                at: ago(8 * HOUR),
                pass: 1,
                status: "failed",
                endedAt: ago(8 * HOUR - 2 * MINUTE),
              }),
              pass({ at: ago(7 * HOUR), pass: 2, status: "running" }),
              pass({
                at: ago(6 * HOUR),
                pass: 3,
                status: "failed",
                endedAt: ago(6 * HOUR - 2 * MINUTE),
              }),
              checkpoint({ at: ago(6 * HOUR - 2 * MINUTE), sha: "s3" }),
            ],
          }),
        ],
      }),
    )

    expect(Option.isSome(Scene.find(html, "#healthy .timeline"))).toBe(true)
    expect(Option.isSome(Scene.find(html, "#stalled .timeline"))).toBe(true)
    expect(Scene.findAll(html, "#healthy .timeline-pass.done")).toHaveLength(4)
    expect(Scene.findAll(html, "#healthy .timeline-checkpoint")).toHaveLength(2)
    expect(Scene.findAll(html, "#stalled .timeline-pass.failed")).toHaveLength(2)
    expect(Scene.findAll(html, "#stalled .timeline-pass.running")).toHaveLength(1)
    expect(Scene.findAll(html, "#stalled .timeline-pass.done")).toHaveLength(0)

    const healthyLefts = offsets(html, "#healthy .timeline-pass")
    const stalledLefts = offsets(html, "#stalled .timeline-pass")
    expect(Math.min(...healthyLefts)).toBeGreaterThan(90)
    expect(Math.max(...stalledLefts)).toBeLessThan(80)
    // The gap is the reading: half the strip or more separates moving from parked.
    expect(Math.min(...healthyLefts) - Math.max(...stalledLefts)).toBeGreaterThan(15)

    const label = attrOf(required(html, "#healthy .timeline"), "aria-label")
    expect(label).toContain("4 passes")
    expect(Scene.textContent(required(html, "#healthy .timeline-caption"))).toBe("24h")
  })

  it("puts a ship on the axis when the phase is done", () => {
    const shipped = workstreamOf({
      id: "shipped",
      phase: "done",
      checkpointAt: ago(2 * HOUR),
      sha: "s1",
    })
    const html = render(
      modelOf({
        observedAt: ago(0),
        workstreams: [shipped],
        activities: [
          activityFor({
            workstream: "shipped",
            lastPassAt: ago(3 * HOUR),
            events: [
              pass({ at: ago(3 * HOUR), pass: 1, status: "done", endedAt: ago(3 * HOUR - MINUTE) }),
              checkpoint({ at: ago(3 * HOUR - MINUTE), sha: "s1" }),
              ship({ at: ago(2 * HOUR), sha: "s1" }),
            ],
          }),
        ],
      }),
    )
    const marker = required(html, "#shipped .timeline-ship")
    expect(attrOf(marker, "data-kind")).toBe("ship")
    expect(attrOf(marker, "title")).toContain("ship s1")
    expect(offsets(html, "#shipped .timeline-ship")[0] ?? NaN).toBeCloseTo(91.7, 0)
  })

  it("renders no strip at all when the data has no timestamps", () => {
    const quiet = workstreamOf({ id: "quiet", checkpointAt: ago(30 * HOUR) })
    const silent = workstreamOf({ id: "silent", checkpointAt: ago(30 * HOUR) })
    const { timeline: _timeline, ...withoutTimeline } = activityFor({
      workstream: "quiet",
      events: [],
    })
    const html = render(
      modelOf({
        observedAt: ago(0),
        workstreams: [quiet, silent],
        activities: [
          withoutTimeline,
          activityFor({
            workstream: "silent",
            events: [{ kind: "pass", at: "not an instant", status: "done", pass: 1 }],
          }),
        ],
      }),
    )
    expect(Option.isSome(Scene.find(html, "#quiet"))).toBe(true)
    expect(Option.isSome(Scene.find(html, "#silent"))).toBe(true)
    expect(Option.isNone(Scene.find(html, "#quiet .timeline"))).toBe(true)
    expect(Option.isNone(Scene.find(html, "#silent .timeline"))).toBe(true)
  })
})
