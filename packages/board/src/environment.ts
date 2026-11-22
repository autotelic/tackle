import { Option } from "effect"
import type { Session } from "./sessions.ts"
import type { Tailnet } from "./tailnet.ts"

/*
 * Where a workstream runs, as much as /presence can honestly say today.
 *
 * Slice 1 of docs/environment-plan.md: a machine from the tailnet document the board already
 * serves, the worktree the record points at, and the session that is working it. Nothing else
 * exists to report yet, so the fields that will hold a container, a port, a health state or a
 * preview are served with their empty value instead of being omitted. A renderer can then show
 * "not recorded" — or nothing — rather than a fact a neighbour suggested.
 */

/** The machine a workstream runs on, named the way the tailnet document names it. */
export interface EnvironmentMachine {
  readonly host: string
  readonly dnsName: string | undefined
}

/** How the workstream's code is held. A workstream is a git worktree today, and only that. */
export interface EnvironmentRuntime {
  readonly kind: "worktree"
  readonly path: string
}

/**
 * A declared service on the workstream's runtime.
 *
 * Slice 2 gives a service a name, a command, a port and a health check; until a declaration
 * exists there is no element to describe, and `never` says that rather than guessing a shape
 * a renderer would then draw.
 */
export type EnvironmentService = never

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
  readonly services: ReadonlyArray<EnvironmentService>
  readonly agent: EnvironmentAgent | null
  readonly preview: null
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
  readonly observedAt: string
}): ReadonlyArray<Environment> => {
  const machine = Option.getOrNull(machineOf(input.tailnet))
  return input.workstreams.map((record) => ({
    workstream: record.id,
    machine,
    runtime: { kind: "worktree", path: record.path },
    // Slice 2 owns service declarations; until then there is nothing to declare, not a
    // service with an unknown health.
    services: [],
    agent: Option.getOrNull(agentOf(input.sessions, record.id)),
    // Slice 2 owns routes to a workstream's web service; there is no route to name yet.
    preview: null,
    observedAt: input.observedAt,
  }))
}
