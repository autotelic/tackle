import type { Presence, Session } from "../src/main.ts"

/** The commit the fixture workstream stopped at; the view names it, not a clock. */
export const CHECKPOINT_AT = "2026-11-21T22:38:00.000Z"

/** A live Herdr terminal whose cwd is inside the worktree. */
export const herdrLive: Session = {
  source: "herdr",
  address: "t1d",
  agent: "pi",
  cwd: "/work/tackle/packages/factory-view",
  state: "live",
  status: "working",
  where: "factory view / sessions",
  workstream: "tackle-3",
  joinedBy: "cwd",
}

/** A Herdr pane that finished a turn: `done` is verbatim, idle is our word. */
export const herdrDone: Session = {
  source: "herdr",
  address: "t9z",
  agent: "pi",
  cwd: "/Users/t/scratch",
  state: "live",
  status: "done",
  where: "scratch",
}

/** A blocked Herdr pane, joined by its explicit workstream label. */
export const herdrBlocked: Session = {
  source: "herdr",
  address: "t2b",
  agent: "pi",
  cwd: "/work/tackle",
  state: "live",
  status: "blocked",
  where: "factory view",
  workstream: "tackle-3",
  joinedBy: "label",
}

/** Rex reports blocks, not terminals; the session label is the focus argument. */
export const rexBlocked: Session = {
  source: "rex",
  address: "block:1",
  agent: "com.superlogical.terminal",
  state: "placed",
  status: "com.superlogical.terminal.shell",
  where: "tackle",
  workstream: "tackle-3",
  joinedBy: "title",
}

/**
 * One document covering the session shapes the view must render: a cwd join, a
 * label join, a title join, a blocked pane, a finished pane, and a Rex block
 * with no cwd at all. The unmatched pane must still render under `unjoined`.
 */
export const presenceFixture = (): Presence => ({
  factory: {
    workstreams: [
      {
        id: "tackle-3",
        project: "P-AUT-3",
        label: "factory-view",
        phase: "build",
        path: "/work/tackle",
        repo: "autotelic/tackle",
        branch: "loop/3",
        pr: 3,
        checkpoint: { sha: "9f1c2ab812345", at: CHECKPOINT_AT },
      },
    ],
    desk: [],
    reports: [],
  },
  sessions: {
    herdr: { available: true, sessions: [herdrLive, herdrDone, herdrBlocked] },
    rex: { available: true, sessions: [rexBlocked] },
  },
})
