/* oxlint-disable plumb/prefer-property-tests -- fixed boundary instants, one per claim. */
import { describe, expect, it } from "vitest"
import {
  axisOf,
  marksWithin,
  timelineLabel,
  WINDOW_HOURS,
  type TimelineEvent,
} from "../src/timeline.ts"
import { HOUR, MINUTE, NOW, ago } from "./fixtures.ts"

const event = (kind: TimelineEvent["kind"], at: string): TimelineEvent =>
  kind === "pass" ? { kind, at, status: "done", pass: 1 } : { kind, at, sha: "9f1c2ab8" }

describe("marksWithin", () => {
  it("places the events inside the window and drops the rest", () => {
    const marks = marksWithin({
      events: [
        event("pass", ago(HOUR)),
        event("checkpoint", ago(6 * HOUR)),
        event("ship", ago(30 * HOUR)),
        { kind: "pass", at: "not an instant" },
      ],
      end: NOW,
    })
    expect(marks.map((mark) => mark.event.kind)).toEqual(["pass", "checkpoint"])
    expect(marks[0]?.offset).toBeCloseTo(23 / 24, 5)
    expect(marks[1]?.offset).toBeCloseTo(18 / 24, 5)
  })

  it("keeps both edges of the window and drops what is just outside it", () => {
    const marks = marksWithin({
      events: [
        event("pass", ago(WINDOW_HOURS * HOUR + 1)),
        event("checkpoint", ago(WINDOW_HOURS * HOUR)),
        event("ship", ago(0)),
      ],
      end: NOW,
    })
    expect(marks.map((mark) => mark.event.kind)).toEqual(["checkpoint", "ship"])
    expect(marks[0]?.offset).toBe(0)
    expect(marks[1]?.offset).toBe(1)
  })

  it("degrades to nothing without timestamps", () => {
    expect(marksWithin({ events: [], end: NOW })).toEqual([])
    expect(marksWithin({ events: [{ kind: "pass", at: "" }], end: NOW })).toEqual([])
  })
})

describe("timelineLabel", () => {
  it("counts each lane with its plural", () => {
    const marks = marksWithin({
      events: [
        event("pass", ago(MINUTE)),
        event("pass", ago(2 * MINUTE)),
        event("checkpoint", ago(3 * MINUTE)),
      ],
      end: NOW,
    })
    expect(timelineLabel(marks)).toBe("Last 24 hours: 2 passes, 1 checkpoint")
  })

  it("says nothing happened rather than naming an empty set", () => {
    expect(timelineLabel([])).toBe("No activity in the last 24 hours")
  })
})

describe("axisOf", () => {
  it("reads the observation and refuses everything else", () => {
    expect(axisOf(ago(0))).toEqual({ _tag: "Observed", at: NOW })
    expect(axisOf(null)).toEqual({ _tag: "Unobserved" })
    expect(axisOf(undefined)).toEqual({ _tag: "Unobserved" })
    expect(axisOf("not an instant")).toEqual({ _tag: "Unobserved" })
  })
})
