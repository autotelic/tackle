import { Option } from "effect"
import { resolve } from "node:path"
import type { ServiceObservation } from "@autotelic/room/Service"
import { previewOf, previewRoute } from "./preview.ts"
import type { Session } from "./sessions.ts"
import type { Tailnet } from "./tailnet.ts"

/*
 * Where a workstream runs, as much as /presence can honestly say today.
 *
 * Slice 1 of docs/environment-plan.md: a machine from the tailnet document the board already
 * serves, the worktree the record points at, and the session that is working it. Slice 2a adds
 * the room's leased port, slice 2b the one service a room may declare, with the status a
 * probe observed rather than a status anybody assumed, and slice 2c the stable route to that
 * service when the probe found it answering. The field that will hold a container is served with
 * its empty value instead of being omitted, so a renderer shows "not recorded" rather than a
 * fact a neighbour suggested.
 */

/** The machine a workstream runs on, named the way the tailnet document names it. */
export interface EnvironmentMachine {
  readonly host: string
  readonly dnsName: string | undefined
}

/** How the workstream's code is held: a host worktree or an agentOS VM over one. */
export interface EnvironmentRuntime {
  readonly kind: "worktree" | "agentos"
  readonly path: string
}

/**
 * A declared service on the workstream's runtime.
 *
 * The shape is the room's, not a second one: `room` owns the declaration and runs the probe, so
 * the board serves what it observed instead of re-deriving a health state from a port being set.
 */
export type EnvironmentService = ServiceObservation

/**
 * The port lease a room holds for the workstream that runs in it.
 *
 * It is the room's lease, not a service declaration: a workstream gets one port before it has a
 * service to put on it. `room` is served so a reader can check the claim in that room's file.
 */
export interface EnvironmentPort {
  readonly room: string
  readonly number: number
  readonly leasedAt: string
}

/** One leased port, named by the worktree the room owns. */
export interface RoomPortLease extends EnvironmentPort {
  readonly worktree: string
}

/** One observed service, named by the worktree the room owns. */
export interface RoomServiceObservation extends EnvironmentService {
  readonly worktree: string
}

/** A room whose service answers inside an agentOS VM; the board asks the supervisor. */
export interface RoomVmPreview {
  readonly worktree: string
  readonly room: string
  readonly port: number
}

/** The session working this workstream: the projection's own match, not a guess. */
export interface EnvironmentAgent {
  readonly session: string
  readonly status: string
}

/** One workstream's placement, as /presence serves it under `factory.environments`. */
export interface Environment {
  readonly workstream: string
  readonly machine: EnvironmentMachine | null
  readonly runtime: EnvironmentRuntime
  readonly port: EnvironmentPort | null
  /** The guest port a VM service answers on; null for a local room. */
  readonly vmPort: number | null
  readonly services: ReadonlyArray<EnvironmentService>
  readonly agent: EnvironmentAgent | null
  /**
   * The board's preview route for the workstream's service, as a same-origin path.
   *
   * Null until a probe observed the service healthy: the route names a place a request can go,
   * and there is no place until something answered. A renderer resolves it against its own origin.
   */
  readonly preview: string | null
  readonly observedAt: string
}

/**
 * The machine from the tailnet's own self entry.
 *
 * An unavailable daemon has no self, and a hostname from somewhere else would be a second
 * source of truth for which machine this is: the served field is null and the renderer draws
 * nothing.
 *
 * @param tailnet - the tailnet view /presence already carries.
 * @returns the machine, or none when the tailnet has no self.
 */
const machineOf = (tailnet: Tailnet): Option.Option<EnvironmentMachine> =>
  tailnet.self === undefined
    ? Option.none()
    : Option.some({ host: tailnet.self.host, dnsName: tailnet.self.dnsName })

/**
 * The first session the board tagged with this workstream.
 *
 * `tagWorkstreams` joins a session by its own evidence (label, cwd, tab words), so this reads
 * the join rather than repeating it.
 *
 * @param sessions - the already-tagged sessions.
 * @param workstream - the workstream id.
 * @returns the agent, or none when no session claimed the workstream.
 */
const agentOf = (
  sessions: ReadonlyArray<Session>,
  workstream: string,
): Option.Option<EnvironmentAgent> =>
  Option.map(
    Option.fromIterable(
      sessions.filter((session) => session.workstream === workstream).slice(0, 1),
    ),
    (matched) => ({ session: matched.address, status: matched.status }),
  )

/** What the room facts say about one directory, whichever record names it. */
interface Placement {
  readonly port: EnvironmentPort | null
  readonly vmPort: number | null
  readonly services: ReadonlyArray<EnvironmentService>
  readonly preview: string | null
}

/**
 * Join one directory to the room facts that name it.
 *
 * The path is the join, because both documents observe a directory rather than an id: a workstream
 * id and a room id are different names for the same place, and comparing them would be an
 * assumption. `route` is the id the preview route is addressed by, so a candidate's route names
 * the candidate rather than the workstream whose head it started from.
 *
 * @param input - the directory, the route's id, and the room facts.
 * @returns the placement, with nulls where nothing observed the field.
 */
const placementOf = (input: {
  readonly path: string
  readonly route: string
  readonly leases: ReadonlyArray<RoomPortLease>
  readonly services: ReadonlyArray<RoomServiceObservation>
  readonly vmPreviews: ReadonlyArray<RoomVmPreview>
  readonly pathKey: (path: string) => string
}): Placement => {
  const key = input.pathKey(input.path)
  const lease = input.leases.find((entry) => input.pathKey(entry.worktree) === key)
  const observed = input.services.filter((entry) => input.pathKey(entry.worktree) === key)
  const vm = input.vmPreviews.find((entry) => input.pathKey(entry.worktree) === key)
  return {
    port:
      lease === undefined
        ? null
        : { room: lease.room, number: lease.number, leasedAt: lease.leasedAt },
    vmPort: vm?.port ?? null,
    // A room that declares no service contributes no element, and an observed service keeps
    // the status the probe earned. The worktree is the join's evidence, not a served field.
    services: observed.map(({ worktree: _worktree, ...service }) => service),
    // The rule lives with the route: a preview is advertised only for a service a probe found
    // answering, never for one that merely declared itself. A VM service has no host lease to
    // probe here yet; the route is advertised from the recorded guest port, and a service that
    // is down answers 502 at the route.
    preview:
      vm === undefined
        ? Option.getOrNull(previewOf({ workstream: input.route, services: observed }))
        : previewRoute(input.route),
  }
}

/**
 * Project one environment per workstream from facts the board already observes.
 *
 * @param input - the workstream records, the tagged sessions, the tailnet view, and the scan time.
 * @returns one environment per record, in record order.
 */
export const environmentsOf = (input: {
  readonly workstreams: ReadonlyArray<{ readonly id: string; readonly path: string }>
  readonly sessions: ReadonlyArray<Session>
  readonly tailnet: Tailnet
  readonly leases?: ReadonlyArray<RoomPortLease> | undefined
  readonly services?: ReadonlyArray<RoomServiceObservation> | undefined
  readonly vmPreviews?: ReadonlyArray<RoomVmPreview> | undefined
  /**
   * How two names for the same directory are compared; a plain resolve by default.
   *
   * The board passes a realpath-backed key: a room's worktree and a factory record can name
   * one directory through different symlinks, and a lease must not be lost to that.
   */
  readonly pathKey?: ((path: string) => string) | undefined
  readonly observedAt: string
}): ReadonlyArray<Environment> => {
  const machine = Option.getOrNull(machineOf(input.tailnet))
  const leases = input.leases ?? []
  const services = input.services ?? []
  const vmPreviews = input.vmPreviews ?? []
  const pathKey = input.pathKey ?? resolve
  return input.workstreams.map((record) => ({
    workstream: record.id,
    machine,
    runtime: { kind: "worktree" as const, path: record.path },
    ...placementOf({
      path: record.path,
      route: record.id,
      leases,
      services,
      vmPreviews,
      pathKey,
    }),
    agent: Option.getOrNull(agentOf(input.sessions, record.id)),
    observedAt: input.observedAt,
  }))
}

/**
 * One candidate checkout, as /presence serves it under `factory.candidates`.
 *
 * A candidate is a room of its own, so its port, service and preview are joined by its own
 * worktree path: a neighbour's lease must not fill a candidate's field. There is no `agent` and no
 * `machine`: the projection knows no session claimed the lane, and a candidate runs where the
 * board runs — naming that machine here would repeat the workstream's line, not observe a new
 * fact.
 */
export interface CandidateEnvironmentView {
  readonly workstream: string
  readonly id: string
  readonly room: string
  readonly path: string
  readonly branch: string
  readonly head: string
  readonly label: string
  readonly state: string
  readonly runtime: EnvironmentRuntime
  readonly port: EnvironmentPort | null
  readonly vmPort: number | null
  readonly services: ReadonlyArray<EnvironmentService>
  readonly preview: string | null
  readonly observedAt: string
}

/**
 * Project every recorded candidate, in record order.
 *
 * The state travels unchanged: a dropped candidate is still served, because the floor folds it
 * rather than the projection hiding it. Two open candidates for one workstream are two elements,
 * and nothing here merges them.
 *
 * @param input - the candidate records and the same room facts the workstream projection uses.
 * @returns one view per candidate, in record order.
 */
export const candidateEnvironmentsOf = (input: {
  readonly candidates: ReadonlyArray<{
    readonly workstream: string
    readonly id: string
    readonly room: string
    readonly path: string
    readonly branch: string
    readonly head: string
    readonly label: string
    readonly state: string
  }>
  readonly leases?: ReadonlyArray<RoomPortLease> | undefined
  readonly services?: ReadonlyArray<RoomServiceObservation> | undefined
  readonly vmPreviews?: ReadonlyArray<RoomVmPreview> | undefined
  readonly pathKey?: ((path: string) => string) | undefined
  readonly observedAt: string
}): ReadonlyArray<CandidateEnvironmentView> => {
  const pathKey = input.pathKey ?? resolve
  return input.candidates.map((candidate) => ({
    workstream: candidate.workstream,
    id: candidate.id,
    room: candidate.room,
    path: candidate.path,
    branch: candidate.branch,
    head: candidate.head,
    label: candidate.label,
    state: candidate.state,
    runtime: (input.vmPreviews ?? []).some(
      (preview) => pathKey(preview.worktree) === pathKey(candidate.path),
    )
      ? { kind: "agentos" as const, path: candidate.path }
      : { kind: "worktree" as const, path: candidate.path },
    ...placementOf({
      path: candidate.path,
      route: candidate.id,
      leases: input.leases ?? [],
      services: input.services ?? [],
      vmPreviews: input.vmPreviews ?? [],
      pathKey,
    }),
    observedAt: input.observedAt,
  }))
}
