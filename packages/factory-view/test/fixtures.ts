import type { Presence, Workstream } from "../src/presence.ts"

/** The instant the board read every source; ages in the view are measured from it. */
export const OBSERVED_AT = "2026-11-21T22:50:00.000Z"

/**
 * A done workstream with a still-open PR. This is the disagreement the panel exists
 * to make obvious: the kernel stopped, GitHub did not.
 */
const perms: Workstream = {
  id: "perms-1862",
  project: "P-AUT-128",
  label: "permissions-overhaul",
  phase: "done",
  path: "/work/acme-web/perms-1862",
  repo: "acme/web",
  branch: "feature/permissions-overhaul",
  pr: 1862,
  delivery: "pr",
  linearProjectId: "949a7b9e-cd6d-48e7-a6f7-893cee61a1ef",
  createdAt: "2026-11-17T09:00:00.000Z",
  cursors: { github: "2026-11-21T22:49:00.000Z", linear: "2026-11-21T22:20:00.000Z" },
  checkpoint: { sha: "9f1c2ab812345", at: "2026-11-21T22:38:00.000Z" },
  observed: {
    github: "2026-11-21T22:49:00.000Z",
    linear: "2026-11-21T22:20:00.000Z",
    reports: null,
  },
  freshness: "stale",
  freshnessBySource: { github: "fresh", linear: "stale", reports: "unobserved" },
  budget: { passes: { used: 3, of: 5 }, capStop: null },
  blockedBy: ["integrations-1860"],
  prState: "open",
  projectState: "started",
}

/** The opposite disagreement: GitHub and Linear say closed while the kernel still builds. */
const search: Workstream = {
  id: "search-1877",
  project: "P-AUT-130",
  label: "search-overhaul",
  phase: "build",
  path: "/work/acme-web/search-1877",
  repo: "acme/web",
  branch: "search-overhaul",
  pr: 1877,
  delivery: "pr",
  linearProjectId: "ef7349c2-bd45-402e-b21e-b8c68b83169a",
  createdAt: "2026-11-17T09:00:00.000Z",
  cursors: { github: "2026-11-21T22:48:00.000Z", linear: "2026-11-21T22:47:00.000Z" },
  checkpoint: { sha: "c4f0e12b9a8", at: "2026-11-21T22:40:00.000Z" },
  observed: {
    github: "2026-11-21T22:48:00.000Z",
    linear: "2026-11-21T22:47:00.000Z",
    reports: null,
  },
  freshness: "fresh",
  freshnessBySource: { github: "fresh", linear: "fresh", reports: "unobserved" },
  budget: { passes: { used: 5, of: 5 }, capStop: "passes" },
  blockedBy: [],
  prState: "merged",
  projectState: "completed",
}

/** Nobody has looked and there is no checkpoint: both absences must have their own word. */
const orphan: Workstream = {
  id: "orphan-1901",
  project: "P-AUT-131",
  label: "orphan-work",
  phase: "reconcile",
  path: "/work/scratch/orphan-1901",
  createdAt: "2026-11-17T09:00:00.000Z",
  checkpoint: null,
}

export const workstreams: ReadonlyArray<Workstream> = [perms, search, orphan]

/**
 * One document covering the panel's shapes: a done/PR-open disagreement, a merged PR
 * with a still-open kernel, and a row with no checkpoint, budget, sources or blockers.
 *
 * @returns a decodable `/presence` document.
 */
export const presenceFixture = (): Presence => ({
  observedAt: OBSERVED_AT,
  factory: {
    workstreams,
    desk: [{ id: "desk-1", workstream: "perms-1862", title: "Merge?", route: "live" }],
    reports: [
      {
        id: "report-1",
        workstream: "search-1877",
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
