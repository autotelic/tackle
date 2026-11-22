/* oxlint-disable plumb/prefer-property-tests -- this suite renders one fixed presence document per claim. */
import { Option } from "effect"
import * as Scene from "foldkit/scene"
import { describe, expect, it } from "vitest"
import { Message, type Model, update, view } from "../src/main.ts"
import type { Presence, Workstream } from "../src/presence.ts"

const NOW = Date.now()
const ago = (milliseconds: number): string => new Date(NOW - milliseconds).toISOString()

const base = {
  project: "P-AUT",
  path: "/work/tackle",
  branch: "loop/4",
  delivery: "pr",
  createdAt: ago(86_400_000),
  updatedAt: ago(60_000),
} as const

const fresh: Workstream = {
  ...base,
  id: "fresh-workstream",
  label: "fresh-workstream",
  phase: "build",
  repo: "acme/web",
  cursors: {
    github: ago(4_000),
    linear: ago(8_000),
    reports: ago(12_000),
  },
  checkpoint: { sha: "9f1c2ab812345", at: ago(4_000) },
}

const stale: Workstream = {
  ...base,
  id: "stale-workstream",
  label: "stale-workstream",
  phase: "land",
  repo: "acme/web",
  cursors: {
    github: ago(20 * 60_000),
    linear: ago(4_000),
    reports: ago(4_000),
  },
  checkpoint: { sha: "c4f0e12b9a8", at: ago(20 * 60_000) },
}

const unobserved: Workstream = {
  ...base,
  id: "unobserved-workstream",
  label: "unobserved-workstream",
  phase: "reconcile",
  repo: "acme/web",
  checkpoint: null,
}

const presenceOf = (): Presence => ({
  observedAt: ago(0),
  factory: {
    workstreams: [fresh, stale, unobserved],
    desk: [{ id: "desk-1", workstream: "fresh-workstream", title: "Merge?", route: "live" }],
    reports: [
      {
        id: "report-1",
        workstream: "stale-workstream",
        kind: "blocker",
        actual: "the gate is stale",
        at: ago(12 * 60_000),
        blocked: true,
      },
    ],
  },
  sessions: {
    herdr: {
      available: true,
      sessions: [
        {
          source: "herdr",
          address: "t1d",
          where: "fresh-workstream",
          workstream: "fresh-workstream",
        },
        { source: "herdr", address: "t9z", where: "scratch" },
      ],
    },
    rex: { available: false, sessions: [], note: "rex is not installed" },
  },
})

const modelOf = (overrides: Partial<Model> = {}): Model => ({
  presence: presenceOf(),
  error: null,
  loading: false,
  notice: null,
  lastPolledAt: NOW,
  lastSuccessAt: NOW,
  ...overrides,
})

const rendered = (model: Model): string => {
  let text = ""
  Scene.scene(
    { update, view },
    Scene.given(model),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      text = Scene.textContent(simulation.html)
      return simulation
    },
  )
  return text
}

const has = (model: Model, selector: string): boolean => {
  let found = false
  Scene.scene(
    { update, view },
    Scene.given(model),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      found = Option.isSome(Scene.find(simulation.html, selector))
      return simulation
    },
  )
  return found
}

describe("freshness on the factory view", () => {
  it("renders fresh, stale and unobserved as three visually distinct values", () => {
    expect(has(modelOf(), '[data-freshness="fresh"]')).toBe(true)
    expect(has(modelOf(), '[data-freshness="stale"]')).toBe(true)
    expect(has(modelOf(), '[data-freshness="unobserved"]')).toBe(true)
  })

  it("puts an observed age on the page and on every panel", () => {
    const text = rendered(modelOf())
    expect(text).toMatch(/polled \d+s ago/u)
    expect(text).toMatch(/observed \d+s ago/u)
    expect(text).toMatch(/checkpoint 9f1c2ab8 · \d+s ago/u)
    expect(text).toContain("checkpoint c4f0e12b · 20m ago")
  })

  it("renders a null checkpoint as no checkpoint yet, never as 0m ago", () => {
    const text = rendered(modelOf())
    expect(text).toContain("no checkpoint yet")
    expect(text).not.toMatch(/(?:^|\s)0m ago/u)
  })

  it("shows each source's own freshness", () => {
    const text = rendered(modelOf())
    expect(text).toContain("github")
    expect(text).toContain("linear")
    expect(text).toContain("reports")
    expect(has(modelOf(), '[data-source="github"][data-freshness="stale"]')).toBe(true)
  })

  it("turns a failed poll into a visible lost-feed state, not the last good frame", () => {
    const text = rendered(
      modelOf({
        presence: null,
        error: "TypeError: Failed to fetch",
        lastPolledAt: NOW,
        lastSuccessAt: NOW - 30_000,
      }),
    )
    expect(text).toContain("Could not read /presence: TypeError: Failed to fetch")
    expect(text).toMatch(/poll failed \d+s ago/u)
    expect(text).toContain("nothing on this page is current")
    expect(text).not.toContain("fresh-workstream")
  })

  it("clears the last good frame when the poll itself fails", () => {
    const settled = update(
      modelOf(),
      Message.Settled({
        value: null,
        error: "TypeError: Failed to fetch",
        at: NOW + 1_000,
      }),
    )
    expect(settled.model.presence).toBeNull()
    expect(settled.model.lastPolledAt).toBe(NOW + 1_000)
    const text = rendered(settled.model)
    expect(text).toContain("Could not read /presence: TypeError: Failed to fetch")
    expect(text).not.toContain("fresh-workstream")
  })
})
