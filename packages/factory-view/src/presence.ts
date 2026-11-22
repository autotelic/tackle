import { Schema } from "effect"

/*
 * The wire contract for `/presence`, one module because both the renderer and the
 * repo grouping read it. The board serves full workstream records, so the fields the
 * panel needs (cursors, createdAt, checkpoint) are already on the wire; anything not
 * below is not in the document, and the view says so rather than inventing it.
 */

/** The commit a pass stopped at. `at` is what the view ages, `sha` is what it names. */
export const Checkpoint = Schema.Struct({ sha: Schema.String, at: Schema.String })
export type Checkpoint = typeof Checkpoint.Type

/**
 * How far each source has been read. An empty string is the store's "never advanced"
 * — the one value that makes a workstream unobserved without making it look stale.
 */
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
  /** The instant the board read every source. Ages are measured from it, never a clock. */
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
