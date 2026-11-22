import { Schema } from "effect"

/*
 * The /presence document, as the view decodes it.
 *
 * Its own module because a shape is not a rendering: the card can be tested against a served
 * document, and the fields this view does not draw yet stay decoded rather than dropped.
 */

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
  checkpoint: Schema.Struct({ sha: Schema.String, at: Schema.String }),
})
export const Desk = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  title: Schema.String,
  body: Schema.String,
  choices: Schema.Array(Schema.String),
  route: Schema.String,
})
export const Report = Schema.Struct({
  id: Schema.String,
  workstream: Schema.String,
  kind: Schema.String,
  actual: Schema.String,
  at: Schema.String,
  blocked: Schema.Boolean,
})
export const ActivityPass = Schema.Struct({
  pass: Schema.Finite,
  at: Schema.String,
  status: Schema.String,
  phase: Schema.String,
  events: Schema.Array(Schema.String),
  checkpoint: Schema.optional(Schema.String),
  exit: Schema.optional(Schema.Finite),
  // The card draws one number from the gate — the newest pass's error count — so that is all
  // this decodes. Re-declaring the receipt's whole quality record would be a second copy of a
  // shape @autotelic/factory already owns; a decoder ignores the fields it does not name.
  quality: Schema.optional(Schema.Struct({ after: Schema.Struct({ errors: Schema.Finite }) })),
})
export const Activity = Schema.Struct({
  workstream: Schema.String,
  lastPass: Schema.NullOr(ActivityPass),
  pending: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      at: Schema.String,
      summary: Schema.optional(Schema.String),
    }),
  ),
  lastEvent: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      at: Schema.String,
      summary: Schema.optional(Schema.String),
    }),
  ),
  ageMinutes: Schema.NullOr(Schema.Finite),
  budget: Schema.Struct({ used: Schema.Finite, passesPerPhase: Schema.Finite }),
  phase: Schema.String,
  state: Schema.Literals(["working", "queued", "blocked", "idle", "done"]),
  blockedBy: Schema.Array(Schema.String),
})
export const SessionSource = Schema.Union([Schema.Literal("herdr"), Schema.Literal("rex")])
export const Session = Schema.Struct({
  source: SessionSource,
  address: Schema.String,
  agent: Schema.optional(Schema.String),
  roomId: Schema.optional(Schema.String),
  where: Schema.optional(Schema.String),
  workstream: Schema.optional(Schema.String),
})
export const SessionSourceView = Schema.Struct({
  available: Schema.Boolean,
  sessions: Schema.Array(Session),
})
/** A machine, named the way the tailnet document names it. */
const EnvironmentMachine = Schema.Struct({
  host: Schema.String,
  dnsName: Schema.optional(Schema.String),
})
/** How the workstream's code is held. Slice 1 can only say worktree. */
const EnvironmentRuntime = Schema.Struct({ kind: Schema.String, path: Schema.String })
/** The session the board matched to the workstream, when one claimed it. */
const EnvironmentAgent = Schema.Struct({ session: Schema.String, status: Schema.String })
/**
 * One workstream's environment.
 *
 * Every field but the id is optional on purpose: a missing field is a fact the projection did
 * not send, so the card draws nothing for it instead of failing the whole document — or worse,
 * naming a machine, a runtime, a service or a preview nobody observed.
 */
export const Environment = Schema.Struct({
  workstream: Schema.String,
  machine: Schema.optional(Schema.NullOr(EnvironmentMachine)),
  runtime: Schema.optional(EnvironmentRuntime),
  // No service has a declared shape yet (docs/environment-plan.md, slice 2), so the list
  // decodes without claiming what a member holds.
  services: Schema.optional(Schema.Array(Schema.Unknown)),
  agent: Schema.optional(Schema.NullOr(EnvironmentAgent)),
  preview: Schema.optional(Schema.NullOr(Schema.String)),
  observedAt: Schema.optional(Schema.String),
})
export type Environment = typeof Environment.Type

export const Presence = Schema.Struct({
  factory: Schema.Struct({
    workstreams: Schema.Array(Workstream),
    // Absent on a board that does not serve it yet: the card then draws no Environment line.
    environments: Schema.optional(Schema.Array(Environment)),
    activity: Schema.Array(Activity),
    desk: Schema.Array(Desk),
    reports: Schema.Array(Report),
  }),
  sessions: Schema.Struct({ herdr: SessionSourceView, rex: SessionSourceView }),
})
type Presence = typeof Presence.Type

/**
 * The served environments, keyed by the workstream each one names.
 *
 * A card reads its own entry, so a missing field stays missing: a workstream with no
 * environment is an absent key, never an empty one, and the card draws no line for it.
 *
 * @param environments - `factory.environments`, absent when the board did not serve it.
 * @returns every served environment, keyed by workstream id.
 */
export const environmentsByWorkstream = (
  environments: ReadonlyArray<Environment> | undefined,
): Readonly<Record<string, Environment>> =>
  Object.fromEntries(
    (environments ?? []).map((environment) => [environment.workstream, environment]),
  )
