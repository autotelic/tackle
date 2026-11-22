import { Option } from "effect"
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import type { Workstream } from "../src/presence.ts"
import { sessionsOf } from "../src/presence.ts"
import {
  UNFILED,
  ageLabel,
  checkpointAge,
  groupByRepo,
  isUnobserved,
  observationLabel,
  repoLine,
  unobservedClause,
} from "../src/repos.ts"
import {
  ADOPTED_TUESDAY,
  OBSERVED_AT,
  presenceFixture,
  workstreamDraft,
  workstreamOf,
} from "./fixtures.ts"

const NOW = Date.parse(OBSERVED_AT)

const panels = () => {
  const presence = presenceFixture()
  return groupByRepo(presence.factory.workstreams, sessionsOf(presence))
}

const panelOf = (repo: string) => {
  const panel = panels().find((candidate) => candidate.repo === repo)
  if (panel === undefined) throw new Error("no panel for " + repo)
  return panel
}

const workstreamOfId = (id: string): Workstream => {
  const found = presenceFixture().factory.workstreams.find((ws) => ws.id === id)
  if (found === undefined) throw new Error("no workstream " + id)
  return found
}

describe("grouping is a projection of the document", () => {
  it("keeps a workstream with no repo in an unfiled section instead of dropping it", () => {
    const grouped = panels()
    const kept = grouped.flatMap((panel) => panel.workstreams.map((ws) => ws.id))
    expect(kept).toEqual([
      "billing-1900",
      "perms-1862",
      "enterprise-1854",
      "search-1877",
      "orphan-1901",
    ])
    expect(panelOf(UNFILED).workstreams.map((ws) => ws.id)).toEqual(["orphan-1901"])
  })

  it("sorts repositories by name and puts unfiled last", () => {
    expect(panels().map((panel) => panel.repo)).toEqual(["acme/ledger", "acme/web", UNFILED])
  })

  it("counts live sessions, PRs and unobserved workstreams per repo", () => {
    const web = panelOf("acme/web")
    expect(web.workstreams).toHaveLength(3)
    expect(web.live).toBe(1)
    expect(web.unobserved).toBe(1)
    expect(web.pullRequests).toBe(3)
    const ledger = panelOf("acme/ledger")
    expect(ledger.live).toBe(0)
    expect(ledger.unobserved).toBe(1)
    expect(ledger.pullRequests).toBe(0)
  })

  it("partitions any document: every workstream lands in exactly one panel", () => {
    // The acceptance criterion is about a document, not three examples: generate the
    // awkward shapes (no repo, blank repo, no PR, no checkpoint) and assert the partition.
    fc.assert(
      fc.property(fc.array(workstreamDraft, { maxLength: 12 }), (drafts) => {
        const grouped = groupByRepo(drafts.map(workstreamOf), [])
        const ids = grouped.flatMap((panel) => panel.workstreams.map((ws) => ws.id))
        return ids.length === drafts.length && new Set(ids).size === ids.length
      }),
    )
  })
})

describe("unobserved is 'nobody looked', not 'nothing happened'", () => {
  it("reads the newest cursor, and an empty cursor is no observation at all", () => {
    // A live session is being looked at now, whatever the cursors say.
    expect(
      observationLabel({
        workstream: workstreamOfId("perms-1862"),
        observedAt: OBSERVED_AT,
        live: true,
      }),
    ).toBe("live now — no source read yet")
    // search-1877 was read 5m before the document was; nobody is attached to it.
    expect(
      observationLabel({
        workstream: workstreamOfId("search-1877"),
        observedAt: OBSERVED_AT,
        live: false,
      }),
    ).toBe("observed 5m ago")
    for (const id of ["enterprise-1854", "billing-1900", "orphan-1901"]) {
      expect(isUnobserved(workstreamOfId(id))).toBe(true)
      expect(
        observationLabel({ workstream: workstreamOfId(id), observedAt: OBSERVED_AT, live: false }),
      ).toBe("not observed — no cursor advanced")
    }
    expect(isUnobserved(workstreamOfId("search-1877"))).toBe(false)
  })

  it("keeps the live and unobserved counts of a panel disjoint", () => {
    // The two counts are read in one sentence; perms-1862 must not be in both.
    const web = panelOf("acme/web")
    expect(web.live).toBe(1)
    expect(web.unobserved).toBe(1)
    expect(web.workstreams.map((ws) => ws.id)).toEqual([
      "perms-1862",
      "enterprise-1854",
      "search-1877",
    ])
  })

  it("treats an unparseable cursor as no observation, not as the epoch", () => {
    const garbled: Workstream = {
      ...workstreamOfId("perms-1862"),
      cursors: { github: "last Tuesday", linear: "" },
    }
    expect(observationLabel({ workstream: garbled, observedAt: OBSERVED_AT, live: false })).toBe(
      "not observed — no cursor advanced",
    )
  })

  it("dates the bucket from the latest adoption nobody looked past", () => {
    const since = panelOf(UNFILED).unobservedSince
    expect(Option.isSome(since)).toBe(true)
    expect(Option.getOrThrow(since)).toBe(Date.parse(ADOPTED_TUESDAY))
  })

  it("says all observed rather than dropping the count when nothing is unobserved", () => {
    const web = panelOf("acme/web")
    expect(unobservedClause({ panel: { ...web, unobserved: 0 }, observedAt: OBSERVED_AT })).toBe(
      "all observed",
    )
  })

  it("keeps the count when the document cannot date the adoption", () => {
    const web = panelOf("acme/web")
    expect(
      unobservedClause({
        panel: { ...web, unobservedSince: Option.none() },
        observedAt: OBSERVED_AT,
      }),
    ).toBe("1 unobserved, adoption instant unknown")
    // An observation instant the view cannot parse still leaves a countable fact.
    expect(unobservedClause({ panel: web, observedAt: "" })).toBe("1 unobserved")
    expect(
      observationLabel({ workstream: workstreamOfId("search-1877"), observedAt: "", live: false }),
    ).toBe("observed")
  })
})

describe("ages carry their unit and never read as zero", () => {
  it("says just now below a minute, then m, h, d, w", () => {
    expect(ageLabel({ at: NOW - 45_000, now: NOW })).toBe("just now")
    expect(ageLabel({ at: NOW - 12 * 60_000, now: NOW })).toBe("12m ago")
    expect(ageLabel({ at: NOW - 2 * 3_600_000, now: NOW })).toBe("2h ago")
    expect(ageLabel({ at: NOW - 3 * 86_400_000, now: NOW })).toBe("3d ago")
    expect(ageLabel({ at: NOW - 16 * 86_400_000, now: NOW })).toBe("2w ago")
  })

  it("never renders a zero unit, whatever the gap", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), (gap) => {
        const label = ageLabel({ at: NOW - gap, now: NOW })
        // A zero unit ("0m ago") reads as "nothing happened"; "10m ago" must still pass.
        return !/\b0[mhdw] /.test(label)
      }),
    )
  })

  it("leaves the age off a checkpoint whose instant it cannot parse", () => {
    expect(checkpointAge({ at: "2026-11-21T22:38:00.000Z", observedAt: OBSERVED_AT })).toBe(
      " · 12m ago",
    )
    expect(checkpointAge({ at: "not-a-date", observedAt: OBSERVED_AT })).toBe("")
    expect(checkpointAge({ at: "2026-11-21T22:38:00.000Z", observedAt: "" })).toBe("")
  })
})

describe("the repo header is a sentence", () => {
  it("reads the counts, the live sessions and the unobserved bucket in one line", () => {
    expect(repoLine({ panel: panelOf("acme/web"), observedAt: OBSERVED_AT })).toBe(
      "acme/web · 3 workstreams (1 live, 1 unobserved since Tue) · 3 PRs",
    )
    expect(repoLine({ panel: panelOf("acme/ledger"), observedAt: OBSERVED_AT })).toBe(
      "acme/ledger · 1 workstream (0 live, 1 unobserved since Fri) · 0 PRs",
    )
    expect(repoLine({ panel: panelOf(UNFILED), observedAt: OBSERVED_AT })).toBe(
      "unfiled · 1 workstream (0 live, 1 unobserved since Tue) · 0 PRs",
    )
  })

  it("ages a bucket adopted within the day instead of naming a weekday", () => {
    const ledger = panelOf("acme/ledger")
    const threeHoursAfterAdoption = new Date(
      Option.getOrThrow(ledger.unobservedSince) + 3 * 3_600_000,
    ).toISOString()
    expect(unobservedClause({ panel: ledger, observedAt: threeHoursAfterAdoption })).toBe(
      "1 unobserved, last looked 3h ago",
    )
  })
})
