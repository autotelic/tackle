import { Schema } from "effect"

/*
 * The wire contract for `/presence`. Both the overview and the workstream panel read
 * the same document; a value the panel shows that is not here is a bug, because the
 * view has no source of truth of its own. Fields the board can compute from the
 * workstream record are optional so an older board still decodes: absence renders as
 * `unknown`, never as a zero.
 */

/** The commit a pass stopped at. `at` is what the view ages; `sha` is what it names. */
export const Checkpoint = Schema.Struct({ sha: Schema.String, at: Schema.String })
export type Checkpoint = typeof Checkpoint.Type

/** The three freshness values. `unobserved` means nobody looked, not that nothing happened. */
export const Freshness = Schema.Literals(["fresh", "stale", "unobserved"])
export type Freshness = typeof Freshness.Type

export const SourceFreshness = Schema.Struct({
  github: Freshness,
  linear: Freshness,
  reports: Freshness,
})
export type SourceFreshness = typeof SourceFreshness.Type

export const Observed = Schema.Struct({
  github: Schema.NullOr(Schema.String),
  linear: Schema.NullOr(Schema.String),
  reports: Schema.NullOr(Schema.String),
})
export type Observed = typeof Observed.Type

export const CapStop = Schema.Literals(["passes", "wallMinutes", "tokens", "rounds"])
export type CapStop = typeof CapStop.Type

export const Budget = Schema.Struct({
  passes: Schema.Struct({ used: Schema.Finite, of: Schema.Finite }),
  capStop: Schema.NullOr(CapStop),
})
export type Budget = typeof Budget.Type

/** GitHub's closed flag. Kept separate from `phase` and Linear's project state. */
export const PrState = Schema.Literals(["open", "merged", "closed"])
export type PrState = typeof PrState.Type

/** Linear's closed flag. Kept separate from `phase` and GitHub's PR state. */
export const ProjectState = Schema.Literals(["planned", "started", "completed", "canceled"])
export type ProjectState = typeof ProjectState.Type

export const Cursors = Schema.Struct({
  github: Schema.optional(Schema.String),
  linear: Schema.optional(Schema.String),
  reports: Schema.optional(Schema.String),
})
export type Cursors = typeof Cursors.Type

export const Workstream = Schema.Struct({
  id: Schema.String,
  project: Schema.String,
  label: Schema.String,
  phase: Schema.String,
  path: Schema.String,
  repo: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  pr: Schema.optional(Schema.Finite),
  delivery: Schema.optional(Schema.String),
  linearProjectId: Schema.optional(Schema.String),
  createdAt: Schema.optional(Schema.String),
  updatedAt: Schema.optional(Schema.String),
  cursors: Schema.optional(Cursors),
  checkpoint: Schema.NullOr(Checkpoint),
  // Computed by the board from the workstream record and its receipts.
  observed: Schema.optional(Observed),
  freshness: Schema.optional(Freshness),
  sources: Schema.optional(Schema.Array(Schema.Unknown)),
  freshnessBySource: Schema.optional(SourceFreshness),
  budget: Schema.optional(Budget),
  blockedBy: Schema.optional(Schema.Array(Schema.String)),
  // Source-owned closed flags; the board passes them through when the record carries them.
  prState: Schema.optional(Schema.NullOr(PrState)),
  projectState: Schema.optional(Schema.NullOr(ProjectState)),
  projectUrl: Schema.optional(Schema.String),
})
export type Workstream = typeof Workstream.Type

export const Desk = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  title: Schema.String,
  route: Schema.String,
})
export type Desk = typeof Desk.Type

export const Report = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  kind: Schema.String,
  actual: Schema.String,
  at: Schema.String,
  blocked: Schema.Boolean,
})
export type Report = typeof Report.Type

export const SessionSource = Schema.Union([Schema.Literal("herdr"), Schema.Literal("rex")])
export type SessionSource = typeof SessionSource.Type

export const Session = Schema.Struct({
  source: SessionSource,
  address: Schema.String,
  agent: Schema.optional(Schema.String),
  roomId: Schema.optional(Schema.String),
  where: Schema.optional(Schema.String),
  workstream: Schema.optional(Schema.String),
})
export type Session = typeof Session.Type

export const SessionSourceView = Schema.Struct({
  available: Schema.Boolean,
  sessions: Schema.Array(Session),
})
export type SessionSourceView = typeof SessionSourceView.Type

export const Presence = Schema.Struct({
  /** The instant the board read every source. Ages are measured from it, never a browser clock. */
  observedAt: Schema.String,
  factory: Schema.Struct({
    workstreams: Schema.Array(Workstream),
    desk: Schema.Array(Desk),
    reports: Schema.Array(Report),
  }),
  sessions: Schema.Struct({ herdr: SessionSourceView, rex: SessionSourceView }),
})
export type Presence = typeof Presence.Type

/** The sessions the view can jump to, in source order. */
export const sessionsOf = (presence: Presence): ReadonlyArray<Session> => [
  ...presence.sessions.herdr.sessions,
  ...presence.sessions.rex.sessions,
]
