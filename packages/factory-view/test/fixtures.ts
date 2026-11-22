import fc from "fast-check"
import type { Presence, Workstream } from "../src/presence.ts"

/** The instant the board read every source; ages in the view are measured from it. */
export const OBSERVED_AT = "2026-11-21T22:50:00.000Z"

/** A Tuesday: the day the unobserved clause dates itself against. */
export const ADOPTED_TUESDAY = "2026-11-17T09:00:00.000Z"

/** A session is attached and no source has been read yet: live, but not observed. */
const perms: Workstream = {
  id: "perms-1862",
  project: "permissions",
  label: "Permissions 1862",
  phase: "build",
  path: "/work/acme-web/perms-1862",
  repo: "acme/web",
  branch: "perms-1862",
  pr: 1862,
  createdAt: ADOPTED_TUESDAY,
  cursors: { github: "", linear: "" },
  checkpoint: { sha: "9f1c2ab812345", at: "2026-11-21T22:38:00.000Z" },
}

/** Adopted on the Tuesday and never looked at: no cursor advanced. */
const enterprise: Workstream = {
  id: "enterprise-1854",
  project: "enterprise",
  label: "Enterprise 1854",
  phase: "blocked",
  path: "/work/acme-web/enterprise-1854",
  repo: "acme/web",
  pr: 1854,
  createdAt: ADOPTED_TUESDAY,
  cursors: { github: "", linear: "" },
  checkpoint: { sha: "3d7e9010fedcb", at: "2026-11-21T20:50:00.000Z" },
}

/** Read 5m before the document was read, and nobody is attached to it. */
const search: Workstream = {
  id: "search-1877",
  project: "search",
  label: "Search 1877",
  phase: "land",
  path: "/work/acme-web/search-1877",
  repo: "acme/web",
  pr: 1877,
  createdAt: ADOPTED_TUESDAY,
  cursors: { github: "2026-11-21T22:45:00.000Z", linear: "" },
  checkpoint: { sha: "c4f0e12b9a8", at: "2026-11-21T22:40:00.000Z" },
}

/** A repo of its own, unobserved since Friday, and no PR on the wire. */
const billing: Workstream = {
  id: "billing-1900",
  project: "billing",
  label: "Billing 1900",
  phase: "land",
  path: "/work/acme-ledger/billing-1900",
  repo: "acme/ledger",
  createdAt: "2026-11-20T09:00:00.000Z",
  checkpoint: { sha: "b7d1e33c0a1", at: "2026-11-20T10:00:00.000Z" },
}

/** No repo at all, and no checkpoint: the row the panel must not drop. */
const orphan: Workstream = {
  id: "orphan-1901",
  project: "orphan",
  label: "Orphan 1901",
  phase: "reconcile",
  path: "/work/scratch/orphan-1901",
  createdAt: ADOPTED_TUESDAY,
  checkpoint: null,
}

/** The same sessions and cards for any set of workstreams, so a generated document is a real one. */
export const presenceOf = (workstreams: ReadonlyArray<Workstream>): Presence => ({
  observedAt: OBSERVED_AT,
  factory: {
    workstreams,
    desk: [{ id: "desk-1", workstream: "perms-1862", title: "Merge?", route: "live" }],
    reports: [
      {
        id: "report-1",
        workstream: "enterprise-1854",
        kind: "blocker",
        actual: "gate data is not in /presence",
        at: OBSERVED_AT,
        blocked: true,
      },
    ],
  },
  sessions: {
    herdr: {
      available: true,
      sessions: [
        { source: "herdr", address: "t1d", where: "perms-1862", workstream: "perms-1862" },
        { source: "herdr", address: "t9z", where: "~/scratch" },
      ],
    },
    rex: { available: false, sessions: [] },
  },
})

/**
 * One document covering every shape the panel has to answer for: two repos, an
 * unfiled row, a live workstream, an observed one, one with no cursors object, and
 * a null checkpoint.
 */
export const presenceFixture = (): Presence =>
  presenceOf([perms, enterprise, search, billing, orphan])

/**
 * The awkward shapes a real board serves: an unnamed repo, a blank one, no PR and no
 * checkpoint. Generated so the panel's partition is asserted over documents, not examples.
 */
export const workstreamDraft = fc.record({
  id: fc.uuid(),
  phase: fc.constantFrom("reconcile", "build", "land", "blocked", "done"),
  repo: fc.option(fc.constantFrom("acme/web", "acme/ledger", " "), { nil: undefined }),
  pr: fc.option(fc.nat({ max: 5000 }), { nil: undefined }),
})

export type WorkstreamDraft = {
  readonly id: string
  readonly phase: string
  readonly repo: string | undefined
  readonly pr: number | undefined
}

/** A decodable workstream from a generated draft; absence stays absent, never `undefined`. */
export const workstreamOf = (input: WorkstreamDraft): Workstream => ({
  id: input.id,
  project: "acme",
  label: input.id,
  phase: input.phase,
  path: "/work/" + input.id,
  createdAt: ADOPTED_TUESDAY,
  cursors: { github: "", linear: "" },
  checkpoint: null,
  repo: input.repo,
  pr: input.pr,
})
