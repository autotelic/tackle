/* oxlint-disable plumb/prefer-property-tests -- this suite is the rendered document for each panel state; the input is a fixed presence fixture by design. */
import { Option, Result, Schema } from "effect"
import * as Scene from "foldkit/scene"
import { describe, expect, it } from "vitest"
import { type Message, type Model, update, view } from "../src/main.ts"
import { Presence } from "../src/presence.ts"
import { OBSERVED_AT, presenceFixture, workstreams } from "./fixtures.ts"

const modelOf = (route: string): Model => ({
  presence: presenceFixture(),
  error: null,
  loading: false,
  notice: null,
  route,
})

/** Render the real view through Foldkit's scene harness, then read it as one string. */
const rendered = (route: string): string => {
  let text = ""
  Scene.scene(
    { update, view },
    Scene.given(modelOf(route)),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      text = Scene.textContent(simulation.html)
      return simulation
    },
  )
  return text
}

const hasLink = (route: string, selector: string): boolean => {
  let found = false
  Scene.scene(
    { update, view },
    Scene.given(modelOf(route)),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      found = Option.isSome(Scene.find(simulation.html, selector))
      return simulation
    },
  )
  return found
}

const perms = workstreams[0]
const search = workstreams[1]
const orphan = workstreams[2]
if (perms === undefined || search === undefined || orphan === undefined)
  throw new Error("fixtures are missing")

describe("the workstream panel", () => {
  it("is reached from the overview by a link to the shared path", () => {
    expect(hasLink("/factory", 'a[href="/factory/workstream/perms-1862"]')).toBe(true)
    expect(rendered("/factory")).toContain("permissions-overhaul")
  })

  it("renders only the selected workstream, with a way back", () => {
    const text = rendered("/factory/workstream/perms-1862")
    expect(text).toContain("permissions-overhaul")
    expect(text).toContain("All workstreams")
    expect(text).not.toContain("search-overhaul")
    expect(text).not.toContain("orphan-work")
  })

  it("renders phase, checkpoint age, freshness, budget and blockedBy ids", () => {
    const text = rendered("/factory/workstream/perms-1862")
    expect(text).toContain("phase")
    expect(text).toContain("done")
    expect(text).toContain("checkpoint 9f1c2ab8 · 12m ago")
    expect(text).toContain("stale")
    expect(text).toContain("github fresh · linear stale · reports unobserved")
    expect(text).toContain("observed 1m ago")
    expect(text).toContain("3/5 passes")
    expect(text).toContain("blocked by integrations-1860")
  })

  it("renders a cap stop with its reason and denominator", () => {
    const text = rendered("/factory/workstream/search-1877")
    expect(text).toContain("cap stop: passes 5/5")
    expect(text).toContain("not blocked by another workstream")
  })

  it("renders no checkpoint yet, not 0m ago, and says unknown for missing fields", () => {
    const text = rendered("/factory/workstream/orphan-1901")
    expect(text).toContain("no checkpoint yet")
    expect(text).toContain("sources unknown")
    expect(text).toContain("budget unknown")
    expect(text).toContain("blockedBy unknown")
    expect(text).toContain("observed: unknown")
    expect(text).not.toMatch(/0m/u)
    expect(text).not.toContain("0/0")
  })

  it("renders the three closed flags separately and warns on disagreement", () => {
    const text = rendered("/factory/workstream/perms-1862")
    expect(text).toContain("phase done · PR 1862 open · project started")
    expect(text).toContain("phase done · PR 1862 open — ready for a person, not finished")
    const other = rendered("/factory/workstream/search-1877")
    expect(other).toContain("phase open · PR 1877 merged · project completed")
    expect(other).toContain("PR 1877 merged · phase build")
    expect(other).toContain("project completed · phase build")
  })

  it("links out to the PR, the Linear project and the session", () => {
    expect(
      hasLink("/factory/workstream/perms-1862", 'a[href="https://github.com/acme/web/pull/1862"]'),
    ).toBe(true)
    expect(
      hasLink(
        "/factory/workstream/perms-1862",
        'a[href="https://linear.app/project/949a7b9e-cd6d-48e7-a6f7-893cee61a1ef"]',
      ),
    ).toBe(true)
    const text = rendered("/factory/workstream/perms-1862")
    expect(text).toContain("herdr t1d")
    expect(text).toContain("Merge?")
  })

  it("keeps the overview's other panels and reports after adding the detail route", () => {
    const text = rendered("/factory")
    expect(text).toContain("State machine")
    expect(text).toContain("Desk")
    expect(text).toContain("Reports")
    expect(text).toContain("Sessions not joined to a workstream")
  })

  it("names a panel the document does not carry instead of inventing one", () => {
    const text = rendered("/factory/workstream/not-there")
    expect(text).toContain("Workstream not in /presence")
    expect(text).toContain("not-there")
  })
})

describe("the wire contract", () => {
  it("decodes the computed fields, including the three source flags", () => {
    const raw = {
      observedAt: OBSERVED_AT,
      factory: {
        workstreams: [
          {
            id: "perms-1862",
            project: "P-AUT-128",
            label: "permissions-overhaul",
            phase: "done",
            path: "/work/perms",
            checkpoint: null,
            observed: { github: OBSERVED_AT, linear: null, reports: null },
            freshness: "fresh",
            freshnessBySource: { github: "fresh", linear: "unobserved", reports: "unobserved" },
            budget: { passes: { used: 3, of: 5 }, capStop: null },
            blockedBy: ["integrations-1860"],
            prState: "open",
            projectState: "started",
          },
        ],
        desk: [],
        reports: [],
      },
      sessions: {
        herdr: { available: false, sessions: [] },
        rex: { available: false, sessions: [] },
      },
    }
    const decoded = Schema.decodeUnknownResult(Presence)(raw)
    if (Result.isFailure(decoded)) throw new Error(String(decoded.failure))
    const workstream = decoded.success.factory.workstreams[0]
    expect(workstream?.checkpoint).toBeNull()
    expect(workstream?.budget?.passes.used).toBe(3)
    expect(workstream?.freshnessBySource?.linear).toBe("unobserved")
    expect(workstream?.prState).toBe("open")
  })
})
