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
  linearUrl: Schema.optional(Schema.String),
  worker: Schema.optional(Schema.String),
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
  commit: Schema.optional(Schema.String),
  commitAt: Schema.optional(Schema.String),
  pushed: Schema.optional(Schema.Boolean),
  pushedAt: Schema.optional(Schema.String),
  exit: Schema.optional(Schema.Finite),
  // The card draws one number from the gate — the newest pass's error count — so that is all
  // this decodes. Re-declaring the receipt's whole quality record would be a second copy of a
  // shape board already owns; a decoder ignores the fields it does not name.
  quality: Schema.optional(
    Schema.Struct({
      after: Schema.Struct({
        errors: Schema.Finite,
        available: Schema.optional(Schema.Boolean),
        complete: Schema.optional(Schema.Boolean),
        unjudged: Schema.optional(Schema.Finite),
        scope: Schema.optional(Schema.String),
      }),
    }),
  ),
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
  progress: Schema.optional(
    Schema.Struct({
      consecutive: Schema.Finite,
      stalled: Schema.Boolean,
      signature: Schema.NullOr(Schema.String),
    }),
  ),
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
/** The room's one port lease for this workstream, once a room leases it. */
const EnvironmentPort = Schema.Struct({
  room: Schema.String,
  number: Schema.Finite,
  leasedAt: Schema.String,
})
/**
 * A service a room declared, with the status a probe observed for it.
 *
 * `status` is a word the board observed; this view draws it and never upgrades it. The rest is
 * optional so a board that serves a smaller declaration still renders a card.
 */
const EnvironmentService = Schema.Struct({
  name: Schema.String,
  command: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Finite),
  healthPath: Schema.optional(Schema.String),
  status: Schema.String,
  detail: Schema.optional(Schema.NullOr(Schema.String)),
  checkedAt: Schema.optional(Schema.String),
})
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
  // A room's lease is a fact the board may not have served yet; absent and null both mean no
  // port to draw, never a port guessed from a neighbour.
  port: Schema.optional(Schema.NullOr(EnvironmentPort)),
  vmPort: Schema.optional(Schema.NullOr(Schema.Finite)),
  // A room's declared services, each with the status the board observed. Absent means no
  // declaration, which draws no service at all.
  services: Schema.optional(Schema.Array(EnvironmentService)),
  agent: Schema.optional(Schema.NullOr(EnvironmentAgent)),
  // The board's same-origin preview route, served only after a probe found the service healthy.
  // Absent or null draws no link: this view never composes a route for a service it did not see.
  preview: Schema.optional(Schema.NullOr(Schema.String)),
  observedAt: Schema.optional(Schema.String),
})
export type Environment = typeof Environment.Type

/**
 * One candidate checkout served under `factory.candidates`.
 *
 * Every field but the id and the state is optional: a board that serves fewer facts draws fewer
 * of them, and a card with no candidate key at all draws no list.
 */
export const Candidate = Schema.Struct({
  workstream: Schema.String,
  id: Schema.String,
  room: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
  branch: Schema.optional(Schema.String),
  head: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
  state: Schema.String,
  runtime: Schema.optional(EnvironmentRuntime),
  port: Schema.optional(Schema.NullOr(EnvironmentPort)),
  vmPort: Schema.optional(Schema.NullOr(Schema.Finite)),
  services: Schema.optional(Schema.Array(EnvironmentService)),
  preview: Schema.optional(Schema.NullOr(Schema.String)),
  observedAt: Schema.optional(Schema.String),
})
export type Candidate = typeof Candidate.Type

/**
 * One peer's environment, as `/fleet` serves it.
 *
 * The board's fleet merge flattens a peer's own `factory.environments` under a host label, so
 * these are the fields a floor section draws: where the peer's workstream runs, what answers
 * there, and the route to it. Everything but the two names is optional, because a peer that
 * answered with less draws less.
 */
export const PeerEnvironment = Schema.Struct({
  host: Schema.String,
  workstream: Schema.String,
  runtime: Schema.optional(EnvironmentRuntime),
  vmPort: Schema.optional(Schema.NullOr(Schema.Finite)),
  services: Schema.optional(Schema.Array(EnvironmentService)),
  preview: Schema.optional(Schema.NullOr(Schema.String)),
})
export type PeerEnvironment = typeof PeerEnvironment.Type

/** One machine the fleet asked, with its reason when the answer was nothing. */
export const FleetHost = Schema.Struct({
  host: Schema.String,
  dnsName: Schema.optional(Schema.String),
  online: Schema.Boolean,
  self: Schema.optional(Schema.Boolean),
  ok: Schema.Boolean,
  url: Schema.optional(Schema.String),
  error: Schema.optional(Schema.NullOr(Schema.String)),
  environments: Schema.optional(Schema.Finite),
})
export type FleetHost = typeof FleetHost.Type

/**
 * `/fleet`: the peers' environments, merged by the board.
 *
 * It is a document of its own rather than a field on `/presence`: fleet asks each peer for its
 * presence, so a presence that carried peers would ask itself. `hosts` stays a list — an offline
 * peer is a fact with a reason, not an absence.
 */
export const Fleet = Schema.Struct({
  observedAt: Schema.optional(Schema.String),
  hosts: Schema.Array(FleetHost),
  environments: Schema.Array(PeerEnvironment),
})
export type Fleet = typeof Fleet.Type

const TailnetPeer = Schema.Struct({
  host: Schema.String,
  dnsName: Schema.optional(Schema.String),
  online: Schema.Boolean,
  os: Schema.optional(Schema.String),
})

export const Tailnet = Schema.Struct({
  available: Schema.Boolean,
  state: Schema.optional(Schema.String),
  self: Schema.optional(TailnetPeer),
  peers: Schema.Array(TailnetPeer),
})
export type Tailnet = typeof Tailnet.Type

/** One room record the board serves: its aggregate state and the process it owns, if any. */
export const Room = Schema.Struct({
  id: Schema.String,
  state: Schema.String,
  process: Schema.NullOr(
    Schema.Struct({
      pid: Schema.Finite,
      alive: Schema.Boolean,
      exec: Schema.optional(Schema.String),
    }),
  ),
})
export type Room = typeof Room.Type

export const Presence = Schema.Struct({
  // The board's room inventory. Optional so a board that predates this field still decodes.
  rooms: Schema.optional(Schema.Array(Room)),
  factory: Schema.Struct({
    workstreams: Schema.Array(Workstream),
    workstreamIssues: Schema.optional(
      Schema.Array(
        Schema.Struct({
          id: Schema.String,
          path: Schema.String,
          detail: Schema.String,
        }),
      ),
    ),
    // Absent on a board that does not serve it yet: the card then draws no Environment line.
    environments: Schema.optional(Schema.Array(Environment)),
    /**
     * The workstream's candidate lanes, absent on a board that does not serve them yet.
     *
     * A list rather than an object because two candidates for one workstream are the case this
     * field exists for, and a map keyed by workstream would have to drop one.
     */
    candidates: Schema.optional(Schema.Array(Candidate)),
    activity: Schema.Array(Activity),
    desk: Schema.Array(Desk),
    reports: Schema.Array(Report),
  }),
  sessions: Schema.Struct({ herdr: SessionSourceView, rex: SessionSourceView }),
  network: Schema.optional(Schema.Struct({ tailscale: Tailnet })),
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

/**
 * The served candidates, grouped under the workstream each one isolates.
 *
 * A workstream with no candidate is an absent key rather than an empty list, so the card can tell
 * "nothing to draw" from "one lane, folded".
 *
 * @param candidates - `factory.candidates`, absent when the board did not serve it.
 * @returns every served candidate, keyed by workstream id, in record order.
 */
export const candidatesByWorkstream = (
  candidates: ReadonlyArray<Candidate> | undefined,
): Readonly<Record<string, ReadonlyArray<Candidate>>> => {
  const grouped: Record<string, Array<Candidate>> = {}
  for (const candidate of candidates ?? []) (grouped[candidate.workstream] ??= []).push(candidate)
  return grouped
}
