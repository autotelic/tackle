import { Result, Schema } from "effect"
import fc from "fast-check"
import * as Scene from "foldkit/scene"
import { describe, expect, it } from "vitest"
import { type Message, type Model, update, view } from "../src/main.ts"
import { Presence, type Presence as PresenceOf, type Workstream } from "../src/presence.ts"
import { repoOf } from "../src/repos.ts"
import {
  OBSERVED_AT,
  presenceFixture,
  presenceOf,
  workstreamDraft,
  workstreamOf,
} from "./fixtures.ts"

const modelOf = (presence: PresenceOf): Model => ({
  presence,
  error: null,
  loading: false,
  notice: null,
})

/** Render the real view through Foldkit's scene harness, then read it as one string. */
const rendered = (presence: PresenceOf = presenceFixture()): string => {
  let text = ""
  Scene.scene(
    { update, view },
    Scene.given(modelOf(presence)),
    (simulation: Scene.SceneSimulation<Model, Message>) => {
      text = Scene.textContent(simulation.html)
      return simulation
    },
  )
  return text
}

describe("the repo panel", () => {
  it("renders one section per repo, in name order, plus unfiled for the unnamed row", () => {
    const text = rendered()
    const ledger = text.indexOf("acme/ledger")
    const web = text.indexOf("acme/web")
    const unfiled = text.indexOf("unfiled")
    expect(ledger).toBeGreaterThanOrEqual(0)
    expect(web).toBeGreaterThan(ledger)
    expect(unfiled).toBeGreaterThan(web)
    // The row with no repo is on the page, not silently absent.
    expect(text).toContain("orphan-1901")
  })

  it("puts the unobserved count in the header sentence, not behind a hover or a drill-in", () => {
    const text = rendered()
    expect(text).toContain("acme/web · 3 workstreams (1 live, 1 unobserved since Tue) · 3 PRs")
    expect(text).toContain("acme/ledger · 1 workstream (0 live, 1 unobserved since Fri) · 0 PRs")
    expect(text).toContain("unfiled · 1 workstream (0 live, 1 unobserved since Tue) · 0 PRs")
  })

  it("names the gate it cannot show instead of inventing one", () => {
    const text = rendered()
    expect(text).toContain(
      "gate: not in /presence · missing baseline identity count, error and warning counts, " +
        "newest accepted identity",
    )
    expect(text).toContain("PR state: not in /presence")
  })

  it("ages each workstream from the document's own observation instant", () => {
    const text = rendered()
    expect(text).toContain("checkpoint 9f1c2ab8 · 12m ago")
    expect(text).toContain("observed 5m ago")
    expect(text).toContain("checkpoint 3d7e9010 · 2h ago")
  })

  it("renders a workstream with no checkpoint as no checkpoint, and never as 0m", () => {
    const text = rendered()
    expect(text).toContain("no checkpoint yet")
    // A zero-unit age would read as "nothing happened"; "10m ago" is still a real age.
    expect(text).not.toMatch(/\b0[mhdw] /)
  })

  it("marks the workstream nobody has looked at, and keeps the unmatched session visible", () => {
    const text = rendered()
    expect(text).toContain("not observed — no cursor advanced")
    expect(text).toContain("live now — no source read yet")
    expect(text).toContain("herdr t1d")
    expect(text).toContain("herdr t9z")
  })

  it("keeps every workstream of any generated document on the page", () => {
    fc.assert(
      fc.property(fc.array(workstreamDraft, { maxLength: 6 }), (drafts) => {
        const text = rendered(presenceOf(drafts.map(workstreamOf)))
        return drafts.every((draft) => {
          const workstream: Workstream = workstreamOf(draft)
          return text.includes(workstream.id) && text.includes(repoOf(workstream))
        })
      }),
      { numRuns: 20 },
    )
  })
})

describe("the wire contract", () => {
  it("decodes a workstream as the board serves it: store fields and cursors included", () => {
    const raw = {
      observedAt: OBSERVED_AT,
      factory: {
        workstreams: [
          {
            id: "perms-1862",
            project: "permissions",
            label: "Permissions 1862",
            phase: "build",
            path: "/work/acme-web/perms-1862",
            repo: "acme/web",
            pr: 1862,
            createdAt: "2026-11-17T09:00:00.000Z",
            updatedAt: "2026-11-21T22:47:00.000Z",
            cursors: { github: "2026-11-21T22:47:00.000Z", linear: "" },
            checkpoint: {
              sha: "9f1c2ab8",
              ref: "refs/heads/perms-1862",
              at: "2026-11-21T22:38:00.000Z",
              pushed: false,
            },
            budgets: { passesPerPhase: 5 },
          },
        ],
        desk: [],
        reports: [],
      },
      sessions: {
        herdr: { available: true, sessions: [] },
        rex: { available: false, sessions: [] },
      },
    }
    const decoded = Schema.decodeResult(Presence)(raw)
    if (Result.isFailure(decoded)) throw new Error(String(decoded.failure))
    const workstream = decoded.success.factory.workstreams[0]
    // The cursor survives decode: it is what makes a workstream observed at all.
    expect(workstream?.cursors?.github).toBe("2026-11-21T22:47:00.000Z")
    expect(workstream?.checkpoint?.at).toBe("2026-11-21T22:38:00.000Z")
  })
})
